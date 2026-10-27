// Kursy od instruktorek (5): dostęp (karnet / zakup / podgląd), drip content, postęp, certyfikat,
// opinie po 30% kursu, podział przychodów (decyzja B2: domyślnie 70/30), cena z promocją i zniżką.

export type CourseKind = 'workout' | 'video' | 'program' | 'mindbody' | 'live' | 'hybrid' | 'bundle';
export const COURSE_KIND_LABEL: Record<CourseKind, string> = {
  // Pojedynczy płatny trening (np. do domu): jeden film, kupowany jak kurs.
  workout: 'Trening do domu',
  video: 'Wideo on-demand',
  program: 'Program tematyczny',
  mindbody: 'Ciało i głowa',
  live: 'Live z Q&A',
  hybrid: 'Stacjonarny + online',
  bundle: 'Pakiet kursów',
};

export type CourseStatus = 'draft' | 'beta' | 'pending' | 'published' | 'suspended' | 'archived';
export const COURSE_STATUS_LABEL: Record<CourseStatus, string> = {
  draft: 'szkic',
  beta: 'beta dla testerek',
  pending: 'czeka na akceptację',
  published: 'opublikowany',
  suspended: 'zawieszony',
  archived: 'w archiwum',
};

/** Dozwolone przejścia statusu (kto: autorka / właścicielka). */
export const COURSE_TRANSITIONS: Record<CourseStatus, { to: CourseStatus; by: 'author' | 'owner' }[]> = {
  draft: [{ to: 'beta', by: 'author' }, { to: 'pending', by: 'author' }],
  beta: [{ to: 'pending', by: 'author' }, { to: 'draft', by: 'author' }],
  pending: [{ to: 'published', by: 'owner' }, { to: 'draft', by: 'owner' }],
  published: [{ to: 'suspended', by: 'owner' }, { to: 'archived', by: 'owner' }],
  suspended: [{ to: 'published', by: 'owner' }, { to: 'archived', by: 'owner' }],
  archived: [],
};

export function canTransition(from: CourseStatus, to: CourseStatus, by: 'author' | 'owner'): boolean {
  return COURSE_TRANSITIONS[from].some((t) => t.to === to && (t.by === by || by === 'owner'));
}

/** Brak obietnic medycznych (5.6): proste wykrywanie zwrotów typu „wyleczy”. */
export function medicalClaims(text: string): string[] {
  const t = text.toLowerCase();
  return ['wyleczy', 'leczy', 'gwarantuje', 'na pewno pomoże', 'zlikwiduje ból', 'schudniesz', 'spalisz'].filter((w) => t.includes(w));
}

export type Lesson = { id: string; unlockDay: number; freePreview: boolean; durationSec: number; sort: number };

/** Drip content (K7): lekcja odblokowuje się w dniu `unlockDay` od rozpoczęcia (lub co tydzień przy dripDays). */
export function lessonUnlocked(lesson: Lesson, startedAt: string | null, now: Date, dripDays: number, index: number): boolean {
  if (lesson.freePreview) return true;
  if (!startedAt) return false;
  const day = lesson.unlockDay || (dripDays > 0 ? index * dripDays : 0);
  return (now.getTime() - Date.parse(startedAt)) / 86_400_000 >= day;
}

export function unlockDate(lesson: Lesson, startedAt: string, dripDays: number, index: number): string {
  const day = lesson.unlockDay || (dripDays > 0 ? index * dripDays : 0);
  return new Date(Date.parse(startedAt) + day * 86_400_000).toISOString();
}

export function courseProgress(lessons: Lesson[], completed: Set<string>): number {
  if (!lessons.length) return 0;
  return Math.round((lessons.filter((l) => completed.has(l.id)).length / lessons.length) * 100);
}

/** Opinię można wystawić po 30% kursu (5.4). */
export const canReview = (progressPct: number) => progressPct >= 30;
export const certificateReady = (progressPct: number) => progressPct >= 100;

/** Odtwarzacz: dozwolone tempa (5.3). */
export const PLAYBACK_RATES = [0.75, 1, 1.25] as const;

export type Access =
  | { ok: true; via: 'pass' | 'purchase' | 'free' | 'beta' | 'bundle'; expiresAt: string | null }
  | { ok: false; reason: 'not_enrolled' | 'expired' | 'not_published' };

export function courseAccess(input: {
  status: CourseStatus;
  enrollment: { source: 'pass' | 'purchase' | 'free' | 'beta' | 'bundle'; expires_at: string | null } | null;
  coveredByPass: boolean;
  isAuthorOrStaff: boolean;
  now: Date;
}): Access {
  if (input.isAuthorOrStaff) return { ok: true, via: 'free', expiresAt: null };
  if (input.status !== 'published' && !(input.status === 'beta' && input.enrollment?.source === 'beta')) return { ok: false, reason: 'not_published' };
  if (input.coveredByPass) return { ok: true, via: 'pass', expiresAt: null };
  if (!input.enrollment) return { ok: false, reason: 'not_enrolled' };
  if (input.enrollment.expires_at && Date.parse(input.enrollment.expires_at) < input.now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, via: input.enrollment.source, expiresAt: input.enrollment.expires_at };
}

/** Cena kursu: promocja zbiorcza i zniżka dla karnetowiczek (K14) – nie sumują się, wygrywa wyższa. */
export function coursePrice(priceGrosze: number, opts: { promoPct: number; passDiscountPct: number; hasActivePass: boolean }): { price: number; discountPct: number } {
  const pct = Math.max(opts.promoPct, opts.hasActivePass ? opts.passDiscountPct : 0);
  return { price: Math.round((priceGrosze * (100 - pct)) / 100), discountPct: pct };
}

/** Podział przychodów (K6): udział trenerki w %, reszta dla studia. */
export function revenueSplit(grossGrosze: number, trainerSharePct: number) {
  const trainer = Math.round((grossGrosze * trainerSharePct) / 100);
  return { trainer, studio: grossGrosze - trainer };
}

/** Dostęp czasowy: np. 90 dni od zakupu; null = dożywotni. */
export const accessUntil = (accessDays: number | null, from: Date) => (accessDays ? new Date(from.getTime() + accessDays * 86_400_000).toISOString() : null);

/** Numer certyfikatu: krótki, stały dla osoby i kursu. */
export function certificateNo(courseId: string, userId: string): string {
  let h = 0;
  for (const ch of `${courseId}|${userId}`) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return `GLAM-${Math.abs(h).toString(36).toUpperCase().padStart(7, '0')}`;
}

// ——— Strona sprzedażowa kursu (/s/:slug/kurs/:id) ———
// Wzór: audyt landingu STRETCH&GLOW. Edycja z datami w jednym miejscu, pakiety z tabelą różnic, prowadzące z bio,
// program moduł po module, kalendarz dzień po dniu. Puste pola = sekcja się chowa (żadnych list z jednym punktem „na zapas”).

/** Treści marketingowe kursu (courses.page_json). Wszystko opcjonalne. */
export type CoursePage = {
  /** Obietnica w hero, np. „Wszystko, by zbudować zdrową rutynę”. */
  promise: string;
  outcomes: string[];
  forWhom: string[];
  faq: { q: string; a: string }[];
  /** Sprzęt (do FAQ i „dla kogo”), np. „mata, dwa ręczniki”. */
  equipment: string;
};

const strList = (v: unknown, max: number, len = 240) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, len)).slice(0, max) : [];

export function parseCoursePage(raw: unknown): CoursePage {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const faq = Array.isArray(o.faq)
    ? o.faq
        .filter((f): f is { q: string; a: string } => !!f && typeof f === 'object' && typeof (f as any).q === 'string' && typeof (f as any).a === 'string')
        .map((f) => ({ q: f.q.trim().slice(0, 200), a: f.a.trim().slice(0, 1200) }))
        .filter((f) => f.q && f.a)
        .slice(0, 20)
    : [];
  return {
    promise: typeof o.promise === 'string' ? o.promise.trim().slice(0, 200) : '',
    outcomes: strList(o.outcomes, 12),
    forWhom: strList(o.forWhom, 8),
    faq,
    equipment: typeof o.equipment === 'string' ? o.equipment.trim().slice(0, 200) : '',
  };
}

export type CourseEdition = {
  id: string;
  name: string;
  /** Temat edycji, np. „fit & healthy routine”. */
  theme: string | null;
  salesFrom: string | null;
  salesUntil: string | null;
  startsAt: string | null;
  accessUntil: string | null;
  news: { title: string; body: string }[];
};

export type EditionState = 'upcoming' | 'on_sale' | 'closed';

/** Stan sprzedaży edycji. Brak dat = sprzedaż otwarta (kurs „evergreen”). */
export function editionState(e: Pick<CourseEdition, 'salesFrom' | 'salesUntil'> | null, now: Date): EditionState {
  if (!e) return 'on_sale';
  if (e.salesFrom && Date.parse(e.salesFrom) > now.getTime()) return 'upcoming';
  if (e.salesUntil && Date.parse(e.salesUntil) <= now.getTime()) return 'closed';
  return 'on_sale';
}

/**
 * Bieżąca edycja: ta w sprzedaży, a jeśli żadnej – najbliższa zapowiedziana, a na końcu ostatnia zamknięta
 * (strona wtedy mówi uczciwie „sprzedaż zakończona” zamiast udawać nową edycję).
 */
export function currentEdition<E extends Pick<CourseEdition, 'salesFrom' | 'salesUntil'>>(editions: E[], now: Date): E | null {
  const by = (s: EditionState) => editions.filter((e) => editionState(e, now) === s);
  const time = (d: string | null, fallback: number) => (d ? Date.parse(d) : fallback);
  const onSale = by('on_sale').sort((a, b) => time(a.salesUntil, Infinity) - time(b.salesUntil, Infinity));
  if (onSale.length) return onSale[0];
  const upcoming = by('upcoming').sort((a, b) => time(a.salesFrom, 0) - time(b.salesFrom, 0));
  if (upcoming.length) return upcoming[0];
  return by('closed').sort((a, b) => time(b.salesUntil, 0) - time(a.salesUntil, 0))[0] ?? null;
}

/** Koniec dostępu po zakupie: data końca edycji wygrywa z „N dni od zakupu” (wcześniejsza z dwóch). */
export function purchaseAccessUntil(edition: Pick<CourseEdition, 'accessUntil'> | null, accessDays: number | null, from: Date): string | null {
  const byDays = accessUntil(accessDays, from);
  const byEdition = edition?.accessUntil ?? null;
  if (byDays && byEdition) return Date.parse(byDays) < Date.parse(byEdition) ? byDays : byEdition;
  return byDays ?? byEdition;
}

export type CourseTier = { id: string; name: string; priceGrosze: number; features: string[]; highlight: boolean; seatLimit: number | null };

/**
 * Tabela porównawcza pakietów: wiersze to suma cech ze wszystkich pakietów (w kolejności pierwszego wystąpienia),
 * kolumny – pakiety. Cecha wspólna dla wszystkich ląduje na górze (to „co dostajesz zawsze”).
 */
export function tierComparison(tiers: Pick<CourseTier, 'id' | 'features'>[]): { feature: string; tiers: Record<string, boolean>; common: boolean }[] {
  const order: string[] = [];
  for (const t of tiers) for (const f of t.features) if (!order.includes(f)) order.push(f);
  const rows = order.map((feature) => {
    const has = Object.fromEntries(tiers.map((t) => [t.id, t.features.includes(feature)]));
    return { feature, tiers: has, common: tiers.every((t) => has[t.id]) };
  });
  return [...rows.filter((r) => r.common), ...rows.filter((r) => !r.common)];
}

export type CalendarLesson = { id: string; title: string; module: string; unlockDay: number; durationSec: number; sort: number };

/**
 * Kalendarz treningowy dzień po dniu z `unlock_day` (dzień 0 = start). Lekcje bez dnia i bez dripu
 * nie tworzą kalendarza – wtedy sekcja się chowa. Przy dripDays > 0 lekcja i-ta wypada w dniu i * dripDays.
 */
export function trainingCalendar(lessons: CalendarLesson[], dripDays: number): { day: number; lessons: CalendarLesson[]; minutes: number }[] {
  const sorted = [...lessons].sort((a, b) => a.sort - b.sort);
  const dayOf = (l: CalendarLesson, i: number) => l.unlockDay || (dripDays > 0 ? i * dripDays : 0);
  if (!sorted.some((l, i) => dayOf(l, i) > 0)) return [];
  const days = new Map<number, CalendarLesson[]>();
  sorted.forEach((l, i) => days.set(dayOf(l, i), [...(days.get(dayOf(l, i)) ?? []), l]));
  return [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, ls]) => ({ day: day + 1, lessons: ls, minutes: Math.round(ls.reduce((s, l) => s + l.durationSec, 0) / 60) }));
}

/** Średni trening w minutach (liczba z hero) – tylko lekcje z czasem trwania. */
export function averageMinutes(lessons: { durationSec: number }[]): number | null {
  const timed = lessons.filter((l) => l.durationSec > 0);
  if (!timed.length) return null;
  return Math.round(timed.reduce((s, l) => s + l.durationSec, 0) / timed.length / 60);
}
