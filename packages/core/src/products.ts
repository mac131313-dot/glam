// Silnik produktów (sekcja 1.1.3). Produkt = zestaw reguł z ograniczonej listy klocków,
// a nie osobny typ w kodzie. Kupiony karnet przechowuje KOPIĘ reguł (wersjonowanie, C5),
// więc zmiana cennika nie zmienia tego, co klientka już ma.
import { DEFAULT_TZ, localParts, toMinutes } from './time.ts';
import { entries, plural, shortDate, weekdaysLabel } from './copy.ts';

export type Scope = string[] | 'all';

/** Kadencja na paywallu pakietu zajęć. `once` = płatność jednorazowa, bez odnowienia. */
export type Billing = 'year' | 'week' | 'once';

/** Pula wejść: N wejść na wybrane typy zajęć / strefy. */
export type Pool = {
  id: string;
  label: string;
  entries: number;
  classTypeIds: Scope;
  zoneIds?: Scope;
};

/** Dostęp czasowy: bez limitu wejść w wybranych strefach i typach. */
export type UnlimitedAccess = { zoneIds: Scope; classTypeIds: Scope };

/** Okno dostępu: dni tygodnia (1–7) i godziny. */
export type AccessWindow = { weekdays: number[]; from: string; to: string };

export type ProductRules = {
  pools?: Pool[];
  unlimited?: UnlimitedAccess;
  validityDays: number;
  validFrom?: 'purchase' | 'activation';
  window?: AccessWindow;
  dailyLimit?: number;
  weeklyLimit?: number;
  guestsPerMonth?: number;
  /** Pakiet startowy – tylko przy pierwszym zakupie w studiu. */
  introOnly?: boolean;
  /** Zawieszanie: ile razy i łącznie ile dni (ciąża, urlop, choroba – 4.2). */
  freeze?: { maxTimes: number; maxDays: number };
  /** Plan miesięczny z automatycznym odnawianiem (C9). */
  autoRenew?: boolean;
  /**
   * Miejsce produktu na paywallu pakietu zajęć.
   * `year` / `week` odnawiają się same, `once` to ten sam rodzaj zakupu bez subskrypcji.
   */
  billing?: Billing;
  /** Zniżka dla powracających (np. po 30 dniach przerwy), w procentach. */
  returningDiscountPct?: number;
  /** Dostęp do kursów online w ramach karnetu (decyzja B: kursy w karnecie). */
  courseIds?: string[] | 'all';
};

/** Karnet „od aktywacji” trzeba aktywować (pierwsze wejście) w tym czasie od zakupu. */
export const ACTIVATION_DEADLINE_DAYS = 180;

export type PassStatus = 'active' | 'frozen' | 'expired' | 'used' | 'cancelled';

export type Pass = {
  id: string;
  productName: string;
  rules: ProductRules;
  /** Pozostałe wejścia per pula (id puli → liczba). */
  balances: Record<string, number>;
  validFrom: string;
  validUntil: string;
  status: PassStatus;
  /** Karnet „od aktywacji”: kiedy było pierwsze wejście (null = jeszcze czeka). */
  activatedAt?: string | null;
  /** Wykorzystane wejścia z gościem per miesiąc (YYYY-MM → liczba). */
  guestsUsed?: Record<string, number>;
};

export type AccessContext = {
  /** null = sam wstęp do strefy (check-in na siłownię), bez typu zajęć */
  classTypeId: string | null;
  zoneId: string;
  startsAt: Date;
  tz?: string;
  /** Ile wejść tym karnetem już jest tego dnia / w tym tygodniu (dla limitów). */
  usage: { day: number; week: number };
};

export type AccessDenial =
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'outside_window'
  | 'daily_limit'
  | 'weekly_limit'
  | 'not_covered'
  | 'no_entries';

export type AccessGranted = { ok: true; pass: Pass; poolId: string | null };
export type AccessResult = AccessGranted | { ok: false; pass: Pass; reason: AccessDenial };

export const DENIAL_COPY: Record<AccessDenial, string> = {
  inactive: 'Ten karnet jest teraz nieaktywny.',
  not_started: 'Ten karnet zaczyna działać później.',
  expired: 'Ten karnet wygasł przed terminem zajęć.',
  outside_window: 'Ten karnet nie obejmuje tej godziny.',
  daily_limit: 'Wykorzystałaś dzienny limit tego karnetu.',
  weekly_limit: 'Wykorzystałaś tygodniowy limit tego karnetu.',
  not_covered: 'Ten karnet nie obejmuje tych zajęć.',
  no_entries: 'Na tym karnecie nie ma już wejść.',
};

const inScope = (scope: Scope | undefined, id: string | null) =>
  scope === undefined || scope === 'all' || (id !== null && scope.includes(id));

const scopeSize = (s: Scope) => (s === 'all' ? Number.POSITIVE_INFINITY : s.length);

/**
 * „Czy ten karnet pokrywa tę strefę, typ zajęć i godzinę?” (sekcja 1.1.3).
 * Zwraca też, z której puli zdjąć wejście.
 */
export function checkAccess(pass: Pass, ctx: AccessContext): AccessResult {
  const deny = (reason: AccessDenial): AccessResult => ({ ok: false, pass, reason });
  const r = pass.rules;
  const at = ctx.startsAt.getTime();

  if (pass.status !== 'active') return deny('inactive');
  if (at < Date.parse(pass.validFrom)) return deny('not_started');
  if (at > Date.parse(pass.validUntil)) return deny('expired');

  if (r.window) {
    const lp = localParts(ctx.startsAt, ctx.tz ?? DEFAULT_TZ);
    const inDay = r.window.weekdays.includes(lp.weekday);
    const inHours = lp.minutes >= toMinutes(r.window.from) && lp.minutes < toMinutes(r.window.to);
    if (!inDay || !inHours) return deny('outside_window');
  }
  if (r.dailyLimit !== undefined && ctx.usage.day >= r.dailyLimit) return deny('daily_limit');
  if (r.weeklyLimit !== undefined && ctx.usage.week >= r.weeklyLimit) return deny('weekly_limit');

  if (r.unlimited && inScope(r.unlimited.zoneIds, ctx.zoneId) && inScope(r.unlimited.classTypeIds, ctx.classTypeId)) {
    return { ok: true, pass, poolId: null };
  }

  const pools = (r.pools ?? []).filter(
    (p) => inScope(p.zoneIds, ctx.zoneId) && (ctx.classTypeId === null ? p.classTypeIds === 'all' : inScope(p.classTypeIds, ctx.classTypeId)),
  );
  if (pools.length === 0) return deny('not_covered');

  // Najpierw najbardziej szczegółowa pula („4 Reformer”), dopiero potem ogólna („dowolne zajęcia”),
  // żeby nie zużywać uniwersalnych wejść, gdy jest dedykowane.
  const usable = pools
    .filter((p) => (pass.balances[p.id] ?? 0) > 0)
    .sort((a, b) => scopeSize(a.classTypeIds) - scopeSize(b.classTypeIds));
  if (usable.length === 0) return deny('no_entries');
  return { ok: true, pass, poolId: usable[0].id };
}

/**
 * Klientka ma kilka karnetów, które pokrywają te same zajęcia. Z którego zdjąć wejście?
 * Dostaje wyłącznie kandydatów, którzy przeszli checkAccess (ok: true).
 */
export function pickPass(candidates: AccessGranted[]): AccessGranted | undefined {
  // TODO(Ty): strategia wyboru karnetu — patrz opis w README („Twój ruch”).
  return candidates[0];
}

/** Gdy żaden karnet nie pasuje — które produkty z oferty by pasowały (przycisk „Kup”). */
export function productCovers(rules: ProductRules, classTypeId: string, zoneId: string): boolean {
  if (rules.unlimited && inScope(rules.unlimited.zoneIds, zoneId) && inScope(rules.unlimited.classTypeIds, classTypeId)) return true;
  return (rules.pools ?? []).some((p) => inScope(p.zoneIds, zoneId) && inScope(p.classTypeIds, classTypeId));
}

export function initialBalances(rules: ProductRules): Record<string, number> {
  return Object.fromEntries((rules.pools ?? []).map((p) => [p.id, p.entries]));
}

export function passValidity(rules: ProductRules, start: Date): { validFrom: string; validUntil: string } {
  // Ważność od aktywacji: do pierwszego wejścia karnet „czeka” (limit na aktywację), potem liczy się od zajęć.
  const days = rules.validFrom === 'activation' ? ACTIVATION_DEADLINE_DAYS : rules.validityDays;
  return {
    validFrom: start.toISOString(),
    validUntil: new Date(start.getTime() + days * 86_400_000).toISOString(),
  };
}

/** Pierwsze wejście na karnecie „od aktywacji”: ważność liczona od dnia zajęć. */
export function activationValidity(rules: ProductRules, firstUse: Date): { validFrom: string; validUntil: string } {
  const start = new Date(firstUse);
  start.setUTCHours(0, 0, 0, 0);
  return { validFrom: start.toISOString(), validUntil: new Date(start.getTime() + rules.validityDays * 86_400_000).toISOString() };
}

export function isUsedUp(pass: Pick<Pass, 'rules' | 'balances'>): boolean {
  if (pass.rules.unlimited) return false;
  return Object.values(pass.balances).every((n) => n <= 0);
}

/** Walidacja przy zapisie produktu w panelu właściciela. Zwraca listę błędów po polsku. */
export function validateRules(r: ProductRules): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(r.validityDays) || r.validityDays < 1 || r.validityDays > 730) errors.push('Ważność musi wynosić od 1 do 730 dni.');
  if (!r.unlimited && !(r.pools && r.pools.length)) errors.push('Produkt potrzebuje puli wejść albo dostępu czasowego.');
  const ids = new Set<string>();
  for (const p of r.pools ?? []) {
    if (!p.id || ids.has(p.id)) errors.push('Każda pula musi mieć unikalny identyfikator.');
    ids.add(p.id);
    if (!Number.isInteger(p.entries) || p.entries < 1 || p.entries > 500) errors.push(`Pula „${p.label}” musi mieć od 1 do 500 wejść.`);
    if (p.classTypeIds !== 'all' && p.classTypeIds.length === 0) errors.push(`Pula „${p.label}” nie obejmuje żadnych zajęć.`);
  }
  if (r.window) {
    if (r.window.weekdays.length === 0) errors.push('Okno dostępu musi obejmować co najmniej jeden dzień.');
    if (toMinutes(r.window.from) >= toMinutes(r.window.to)) errors.push('Okno dostępu: godzina „od” musi być przed „do”.');
  }
  if (r.freeze && (!Number.isInteger(r.freeze.maxTimes) || r.freeze.maxTimes < 0 || !Number.isInteger(r.freeze.maxDays) || r.freeze.maxDays < 0 || r.freeze.maxDays > 365)) {
    errors.push('Zawieszenie: podaj liczbę razy i dni (do 365).');
  }
  if (r.returningDiscountPct !== undefined && (!Number.isInteger(r.returningDiscountPct) || r.returningDiscountPct < 0 || r.returningDiscountPct > 90)) {
    errors.push('Zniżka dla powracających: od 0 do 90%.');
  }
  if (r.billing && r.billing !== 'year' && r.billing !== 'week' && r.billing !== 'once') errors.push('Nieznany sposób rozliczenia pakietu.');
  if ((r.billing === 'year' || r.billing === 'week') && !r.autoRenew) errors.push('Subskrypcja musi odnawiać się automatycznie.');
  if (r.billing === 'once' && r.autoRenew) errors.push('Zakup jednorazowy nie może odnawiać się sam.');
  if (r.guestsPerMonth !== undefined && (!Number.isInteger(r.guestsPerMonth) || r.guestsPerMonth < 0 || r.guestsPerMonth > 10)) errors.push('Wejścia z gościem: od 0 do 10 w miesiącu.');
  for (const [key, label] of [['dailyLimit', 'dzienny'], ['weeklyLimit', 'tygodniowy']] as const) {
    const v = r[key];
    if (v !== undefined && (!Number.isInteger(v) || v < 1)) errors.push(`Limit ${label} musi być dodatnią liczbą całkowitą.`);
  }
  return errors;
}

type Names = { classTypes: Record<string, string>; zones: Record<string, string> };

/** „Reformer”, „Reformer i Mat”, „Reformer, Mat i Stretch” */
export function listPl(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} i ${items.at(-1)}`;
}

function scopeLabel(scope: Scope, names: Record<string, string>, all: string): string {
  if (scope === 'all') return all;
  // Dwa typy o tej samej nazwie (np. Pilates Klasyczny na dwóch poziomach) klientka widzi jako jedną pozycję.
  return listPl([...new Set(scope.map((id) => names[id] ?? id))]);
}

/** Podgląd „Jak to widzi klientka” (C4) – reguły produktu w języku klientki. */
export function describeRules(r: ProductRules, names: Names): string[] {
  const lines: string[] = [];
  for (const p of r.pools ?? []) {
    lines.push(`${entries(p.entries)} na ${scopeLabel(p.classTypeIds, names.classTypes, 'dowolne zajęcia')}`);
  }
  if (r.unlimited) {
    const zones = scopeLabel(r.unlimited.zoneIds, names.zones, 'wszystkie strefy');
    lines.push(`Bez limitu wejść: ${zones}`);
  }
  lines.push(`Ważny ${r.validityDays} ${plural(r.validityDays, 'dzień', 'dni', 'dni')}${r.validFrom === 'activation' ? ' od aktywacji' : ' od zakupu'}`);
  if (r.window) lines.push(`Działa: ${weekdaysLabel(r.window.weekdays)} ${r.window.from}–${r.window.to}`);
  if (r.weeklyLimit) lines.push(`Max ${r.weeklyLimit} ${plural(r.weeklyLimit, 'wejście', 'wejścia', 'wejść')} w tygodniu`);
  if (r.dailyLimit) lines.push(`Max ${r.dailyLimit} ${plural(r.dailyLimit, 'wejście', 'wejścia', 'wejść')} dziennie`);
  if (r.guestsPerMonth) lines.push(`Wejście z gościem: ${r.guestsPerMonth} w miesiącu`);
  if (r.introOnly) lines.push('Tylko na start – przy pierwszym zakupie');
  if (r.autoRenew) lines.push('Odnawia się automatycznie – możesz wyłączyć w każdej chwili');
  if (r.billing === 'year') lines.push('Płatność raz w roku');
  if (r.billing === 'week') lines.push('Płatność co tydzień');
  if (r.billing === 'once') lines.push('Jednorazowy zakup, bez odnowienia');
  if (r.freeze?.maxTimes) lines.push(`Możesz zawiesić ${r.freeze.maxTimes} ${plural(r.freeze.maxTimes, 'raz', 'razy', 'razy')}, łącznie do ${r.freeze.maxDays} dni`);
  if (r.returningDiscountPct) lines.push(`Zniżka ${r.returningDiscountPct}% na powrót po przerwie`);
  if (r.courseIds) lines.push(r.courseIds === 'all' ? 'Dostęp do wszystkich kursów online studia' : `Dostęp do ${r.courseIds.length} ${plural(r.courseIds.length, 'kursu', 'kursów', 'kursów')} online`);
  return lines;
}

/**
 * Stan karnetu na ekranie Start (4.2):
 * „Karnet 9 wejść – pozostały 3, ważny do 30.11”.
 */
export function describePass(pass: Pass, tz = DEFAULT_TZ, classTypeNames: Record<string, string> = {}): string {
  const until = shortDate(pass.validUntil, tz);
  if (pass.status === 'frozen') return `${pass.productName} – zawieszony`;
  if (pass.status === 'expired') return `${pass.productName} – wygasł ${until}`;
  if (pass.rules.unlimited) return `${pass.productName} – bez limitu wejść, ważny do ${until}`;

  const pools = pass.rules.pools ?? [];
  if (pools.length > 1) {
    const parts = pools.map((p) => {
      const left = pass.balances[p.id] ?? 0;
      const label = p.classTypeIds === 'all' ? 'dowolne zajęcia' : p.classTypeIds.map((id) => classTypeNames[id] ?? p.label).join('/');
      return `${entries(left)} na ${label}`;
    });
    return `Masz ${parts.join(' i ')}, ważne do ${until}`;
  }
  const left = Object.values(pass.balances).reduce((a, b) => a + b, 0);
  const verb = plural(left, 'pozostało', 'pozostały', 'pozostało');
  return `${pass.productName} – ${verb} ${left}, ważny do ${until}`;
}

/** Karta karnetu: duża cyfra + jednostka + data. Null, gdy stan nie mieści się w jednej liczbie (zawieszony, wygasł, kilka pul). */
export type PassMeter = { value: string; unit: string; until: string };

export function passMeter(pass: Pass, tz = DEFAULT_TZ): PassMeter | null {
  if (pass.status !== 'active') return null;
  const until = `ważny do ${shortDate(pass.validUntil, tz)}`;
  if (pass.rules.unlimited) return { value: '∞', unit: 'bez limitu wejść', until };
  const pools = pass.rules.pools ?? [];
  if (pools.length !== 1) return null;
  const left = pass.balances[pools[0].id] ?? 0;
  const total = pools[0].entries;
  return { value: String(left), unit: `z ${total} ${total === 1 ? 'wejścia' : 'wejść'}`, until };
}
