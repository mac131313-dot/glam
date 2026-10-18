// Model SaaS (1.2): plany abonamentowe, limity zasobów, feature flagi per studio, okres próbny,
// szablony branżowe do kreatora obiektu (C6) i ustawienia studia z bezpiecznymi domyślnymi.
import { DEFAULT_TZ, localParts, toMinutes } from './time.ts';

export type Feature =
  | 'courses'
  | 'courses_paid'
  | 'challenges'
  | 'community'
  | 'shop'
  | 'events'
  | 'music'
  | 'campaigns'
  | 'white_label'
  | 'loyalty'
  | 'health'
  | 'cycle'
  | 'catalog'
  | 'network'
  | 'split_payments'
  | 'beta_widgets';

export const FEATURE_LABEL: Record<Feature, string> = {
  courses: 'Kursy od instruktorek',
  courses_paid: 'Sprzedaż kursów cyfrowych (po weryfikacji zasad sklepów)',
  challenges: 'Wyzwania i odznaki',
  community: 'Feed i grupy',
  shop: 'Sklep i merch',
  events: 'Wydarzenia prywatne',
  music: 'Playlisty Spotify / Apple Music',
  campaigns: 'Kampanie push i e-mail z testem A/B',
  white_label: 'Pełny white-label',
  loyalty: 'Program lojalnościowy',
  health: 'Profil zdrowia i postępy',
  cycle: 'Moduł cyklu (odrębna zgoda)',
  catalog: 'Widoczność w katalogu studiów',
  network: 'Sieć obiektów',
  split_payments: 'Rozdzielenie płatności (prowizja)',
  beta_widgets: 'Widżety i zegarek (beta)',
};

export type PlanLimits = { facilities: number; activeClients: number; smsPerMonth: number; videoMb: number; staff: number };

export type Plan = { id: string; name: string; priceGrosze: number; limits: PlanLimits; features: Feature[] };

export const PLANS: Plan[] = [
  {
    id: 'start',
    name: 'Start',
    priceGrosze: 19900,
    limits: { facilities: 1, activeClients: 150, smsPerMonth: 300, videoMb: 500, staff: 5 },
    features: ['challenges', 'community', 'loyalty', 'health', 'events'],
  },
  {
    id: 'studio',
    name: 'Studio',
    priceGrosze: 39900,
    limits: { facilities: 2, activeClients: 600, smsPerMonth: 1500, videoMb: 5000, staff: 15 },
    features: ['courses', 'challenges', 'community', 'shop', 'events', 'music', 'campaigns', 'loyalty', 'health', 'catalog'],
  },
  {
    id: 'siec',
    name: 'Sieć',
    priceGrosze: 89900,
    limits: { facilities: 10, activeClients: 5000, smsPerMonth: 8000, videoMb: 50000, staff: 80 },
    features: ['courses', 'courses_paid', 'challenges', 'community', 'shop', 'events', 'music', 'campaigns', 'loyalty', 'health', 'cycle', 'catalog', 'network', 'white_label'],
  },
];

export const TRIAL_DAYS = 21;
export const planById = (id: string | null | undefined) => PLANS.find((p) => p.id === id) ?? PLANS[1];

/** Funkcja działa, gdy daje ją plan albo flaga studia ją włącza; flaga może też wyłączyć funkcję z planu. */
export function featureEnabled(planId: string | null | undefined, flags: Record<string, boolean>, f: Feature): boolean {
  if (f in flags) return flags[f];
  return planById(planId).features.includes(f);
}

/** Koszty usługowe przerzucane na studio (1.2.7). */
export const SERVICE_PRICES = { smsGrosze: 9, voiceCallGrosze: 25, emailGrosze: 0, letterGrosze: 450 };

// ——— Godziny recepcji (czat 4.9) ———

export type ReceptionSlot = { weekday: number; from: string; to: string };

/**
 * Godziny recepcji. Gdy `slots` jest niepuste, wyznacza godziny (różne w każdy dzień, kilka okien dziennie);
 * w przeciwnym razie obowiązuje jedno okno `from`–`to` w dni z `weekdays`.
 */
export type SupportHours = { from: string; to: string; weekdays: number[]; slots?: ReceptionSlot[] };

/** Okna recepcji w tygodniu, posortowane po dniu i godzinie. */
export function receptionSlots(h: SupportHours): ReceptionSlot[] {
  const slots = h.slots?.length ? h.slots : h.weekdays.map((weekday) => ({ weekday, from: h.from, to: h.to }));
  return [...slots].sort((a, b) => a.weekday - b.weekday || toMinutes(a.from) - toMinutes(b.from));
}

export function receptionOpen(h: SupportHours, at: Date, tz = DEFAULT_TZ): boolean {
  const lp = localParts(at, tz);
  return receptionSlots(h).some((s) => s.weekday === lp.weekday && lp.minutes >= toMinutes(s.from) && lp.minutes < toMinutes(s.to));
}

/** Najbliższe okno recepcji od chwili `at` (bieżące, jeśli trwa): „dziś 17:30–21:15”, „we wtorek 07:30–10:15”. */
export function nextReceptionLabel(h: SupportHours, at: Date, tz = DEFAULT_TZ): string | null {
  const slots = receptionSlots(h);
  if (!slots.length) return null;
  const lp = localParts(at, tz);
  for (let ahead = 0; ahead < 8; ahead++) {
    const weekday = ((lp.weekday - 1 + ahead) % 7) + 1;
    const slot = slots.find((s) => s.weekday === weekday && (ahead > 0 || toMinutes(s.to) > lp.minutes));
    if (!slot) continue;
    const day = ahead === 0 ? 'dziś' : ahead === 1 ? 'jutro' : `${WEEKDAY_ON[weekday]}`;
    return `${day} ${slot.from}–${slot.to}`;
  }
  return null;
}

const WEEKDAY_ON = ['', 'w poniedziałek', 'we wtorek', 'w środę', 'w czwartek', 'w piątek', 'w sobotę', 'w niedzielę'];

// ——— Ustawienia studia (to, co różni studia, jest danymi, nie kodem – 1.1) ———

export type StudioSettings = {
  loyalty: { enabled: boolean; levels: { id: string; name: string; minPoints: number }[]; points: Record<'training' | 'referral' | 'review' | 'challenge' | 'birthday', number> };
  tenClassReward: { enabled: boolean; every: number; defaultItem: string; delivery: ('pickup' | 'ship')[] };
  referral: { enabled: boolean; friendFirstClassFree: boolean; inviterBonusEntries: number; monthlyCap: number; bonusValidityDays: number };
  guestPass: { validityDays: number; variants: { id: string; label: string; priceGrosze: number; entries: number; classTypeIds: string[] | 'all'; trainerId?: string | null }[] };
  freeze: { maxTimes: number; maxDays: number };
  cards: { enabled: boolean; afterDays: number };
  fallbackWelcome: { enabled: boolean; body: string; hoursBefore: number };
  nps: { afterFirstMonth: boolean; everyNthTraining: number };
  dormant: { surveyAfterDays: number; offerAfterDays: number; offerPercent: number };
  support: { hours: SupportHours; autoReply: string; faq: { q: string; a: string }[] };
  invoice: { vatRate: number; prefix: string; sellerName: string; sellerAddress: string };
  shop: { reservationDays: number; shipping: boolean; shippingGrosze: number };
  events: { enabled: boolean; minNoticeDays: number; cancelDays: number; regulations: string };
  greetings: { birthday: boolean; nameday: boolean; anniversary: boolean; studioAnniversary: boolean; holidays: string[]; birthdayGiftPct: number; birthdayGiftDays: number };
  autoAttend: boolean;
  confirmBeforeMinutes: number;
  greetingsHour: string;
  ownerSeesTrainerNotes: boolean;
  communityPublicProfiles: boolean;
  commissionPct: number;
  /** kolor przewodni panelu studia (id z PANEL_TINTS) – wspólny dla całego zespołu */
  panelTint: string;
};

export const DEFAULT_SETTINGS: StudioSettings = {
  loyalty: {
    enabled: true,
    levels: [
      { id: 'start', name: 'Start', minPoints: 0 },
      { id: 'flow', name: 'Flow', minPoints: 300 },
      { id: 'queen', name: 'Queen', minPoints: 1000 },
    ],
    points: { training: 20, referral: 50, review: 15, challenge: 40, birthday: 30 },
  },
  tenClassReward: { enabled: true, every: 10, defaultItem: 'Skarpetki antypoślizgowe', delivery: ['pickup', 'ship'] },
  referral: { enabled: true, friendFirstClassFree: true, inviterBonusEntries: 1, monthlyCap: 5, bonusValidityDays: 60 },
  guestPass: {
    validityDays: 60,
    variants: [
      { id: 'single', label: 'Jedne zajęcia', priceGrosze: 4900, entries: 1, classTypeIds: 'all' },
      { id: 'pack3', label: 'Pakiet 3 wejść', priceGrosze: 13900, entries: 3, classTypeIds: 'all' },
    ],
  },
  freeze: { maxTimes: 2, maxDays: 60 },
  cards: { enabled: true, afterDays: 30 },
  fallbackWelcome: {
    enabled: true,
    hoursBefore: 12,
    body: 'Hej {imię}, cieszymy się, że do nas dołączasz. Weź wodę, wygodny strój i skarpetki antypoślizgowe – resztą zajmiemy się na miejscu. Do zobaczenia!',
  },
  nps: { afterFirstMonth: true, everyNthTraining: 10 },
  dormant: { surveyAfterDays: 7, offerAfterDays: 21, offerPercent: 50 },
  support: {
    hours: { from: '08:00', to: '20:00', weekdays: [1, 2, 3, 4, 5, 6], slots: [] },
    autoReply: 'Dzięki za wiadomość. Recepcja odpisze, gdy tylko otworzymy studio – zwykle następnego dnia rano.',
    faq: [
      { q: 'Do kiedy mogę odwołać zajęcia?', a: 'Bezpłatnie do 2 godzin przed zajęciami. Później miejsce trafia do kolejnej osoby, a wejście przepada.' },
      { q: 'Jak zawiesić karnet?', a: 'W Profilu → Karnety wybierz „Zawieś”. Możesz to zrobić np. na urlop, w ciąży lub w chorobie.' },
      { q: 'Jakie formy płatności przyjmujecie?', a: 'BLIK, Apple Pay, Google Pay, Przelewy24 i kartę w aplikacji, a w recepcji gotówkę i terminal.' },
      { q: 'Co zabrać na pierwsze zajęcia?', a: 'Wodę, wygodny strój i skarpetki antypoślizgowe. Maty i sprzęt są na miejscu.' },
    ],
  },
  invoice: { vatRate: 8, prefix: 'FV', sellerName: '', sellerAddress: '' },
  shop: { reservationDays: 7, shipping: true, shippingGrosze: 1500 },
  events: {
    enabled: true,
    minNoticeDays: 7,
    cancelDays: 3,
    regulations: 'Wydarzenie można odwołać bezpłatnie do 3 dni przed terminem. Zdjęcia publikujemy tylko za zgodą wszystkich osób na nich.',
  },
  greetings: {
    birthday: true,
    nameday: true,
    anniversary: true,
    studioAnniversary: true,
    holidays: ['babcia', 'walentynki', 'dzien_kobiet', 'dzien_matki', 'mikolajki', 'wigilia', 'sylwester'],
    birthdayGiftPct: 20,
    birthdayGiftDays: 14,
  },
  autoAttend: true,
  confirmBeforeMinutes: 120,
  greetingsHour: '09:00',
  ownerSeesTrainerNotes: false,
  communityPublicProfiles: false,
  commissionPct: 0,
  panelTint: 'grafit',
};

/** Scala zapisane ustawienia z domyślnymi (głęboko dla obiektów, płytko dla tablic). */
export function resolveSettings(raw: unknown): StudioSettings {
  const merge = (base: any, over: any): any => {
    if (over === undefined || over === null) return base;
    if (Array.isArray(base) || typeof base !== 'object') return over;
    const out: any = { ...base };
    for (const k of Object.keys(over)) out[k] = k in base ? merge(base[k], over[k]) : over[k];
    return out;
  };
  return merge(DEFAULT_SETTINGS, raw ?? {});
}

// ——— Szablony branżowe (C6, 1.1.5) ———

export type PresetZone = { key: string; name: string; access: 'reserved' | 'open' | 'checkin' | 'mixed' };
export type PresetClass = { key: string; zone: string; name: string; level: string; description: string };
export type PresetProduct = { name: string; priceGrosze: number; description: string; rules: any };
export type Preset = { id: string; label: string; description: string; zones: PresetZone[]; classTypes: PresetClass[]; products: PresetProduct[] };

export const PRESETS: Preset[] = [
  {
    id: 'pilates',
    label: 'Studio pilates',
    description: 'Sala z Reformerami i mata. Karnety na wejścia.',
    zones: [{ key: 'sala', name: 'Sala Pilates', access: 'reserved' }],
    classTypes: [
      { key: 'reformer', zone: 'sala', name: 'Reformer', level: 'wszystkie poziomy', description: 'Pilates na maszynie Reformer.' },
      { key: 'mat', zone: 'sala', name: 'Mat', level: 'początkujące', description: 'Pilates na macie.' },
      { key: 'stretch', zone: 'sala', name: 'Stretch', level: 'wszystkie poziomy', description: 'Rozciąganie i oddech.' },
    ],
    products: [
      { name: 'Pierwsze 3 zajęcia', priceGrosze: 9900, description: 'Pakiet startowy.', rules: { validityDays: 30, introOnly: true, pools: [{ id: 'all', label: 'Zajęcia', entries: 3, classTypeIds: 'all' }] } },
      { name: 'Karnet 4', priceGrosze: 26000, description: 'Raz w tygodniu.', rules: { validityDays: 30, pools: [{ id: 'all', label: 'Zajęcia', entries: 4, classTypeIds: 'all' }] } },
      { name: 'Karnet 8', priceGrosze: 44000, description: 'Dwa razy w tygodniu.', rules: { validityDays: 45, freeze: { maxTimes: 1, maxDays: 30 }, pools: [{ id: 'all', label: 'Zajęcia', entries: 8, classTypeIds: 'all' }] } },
    ],
  },
  {
    id: 'gym',
    label: 'Siłownia z zajęciami grupowymi',
    description: 'Strefa siłowni z wejściem QR i sala zajęć z zapisami.',
    zones: [
      { key: 'gym', name: 'Siłownia', access: 'checkin' },
      { key: 'sala', name: 'Sala zajęć', access: 'reserved' },
    ],
    classTypes: [
      { key: 'pt', zone: 'gym', name: 'Trening z trenerką', level: 'średnie', description: 'Mała grupa, technika z obciążeniem.' },
      { key: 'zumba', zone: 'sala', name: 'Fitness', level: 'wszystkie poziomy', description: 'Energetyczne zajęcia grupowe.' },
      { key: 'stretch', zone: 'sala', name: 'Stretch', level: 'wszystkie poziomy', description: 'Rozciąganie po treningu.' },
    ],
    products: [
      { name: 'Siłownia miesięczna', priceGrosze: 14900, description: 'Wejście z QR 6–22.', rules: { validityDays: 30, autoRenew: true, unlimited: { zoneIds: ['gym'], classTypeIds: 'all' }, window: { weekdays: [1, 2, 3, 4, 5, 6, 7], from: '06:00', to: '22:00' } } },
      { name: 'Open', priceGrosze: 21900, description: 'Siłownia i zajęcia bez limitu.', rules: { validityDays: 30, autoRenew: true, unlimited: { zoneIds: 'all', classTypeIds: 'all' } } },
    ],
  },
  {
    id: 'wellness',
    label: 'Centrum wellness',
    description: 'Joga, oddech, stretching i regeneracja.',
    zones: [
      { key: 'joga', name: 'Sala jogi', access: 'reserved' },
      { key: 'relaks', name: 'Strefa relaksu', access: 'open' },
    ],
    classTypes: [
      { key: 'joga', zone: 'joga', name: 'Joga', level: 'wszystkie poziomy', description: 'Spokojna praktyka.' },
      { key: 'oddech', zone: 'joga', name: 'Oddech i medytacja', level: 'początkujące', description: 'Praca z oddechem.' },
      { key: 'stretch', zone: 'joga', name: 'Stretch', level: 'wszystkie poziomy', description: 'Mobilność i rozluźnienie.' },
    ],
    products: [
      { name: 'Karnet 5', priceGrosze: 25000, description: 'Pięć wejść.', rules: { validityDays: 45, pools: [{ id: 'all', label: 'Zajęcia', entries: 5, classTypeIds: 'all' }] } },
      { name: 'Miesiąc bez limitu', priceGrosze: 32000, description: 'Wszystkie zajęcia.', rules: { validityDays: 30, unlimited: { zoneIds: 'all', classTypeIds: 'all' } } },
    ],
  },
];
