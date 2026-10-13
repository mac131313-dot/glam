// „Dla mnie” poza oddechem (4.4, 4.6, 4.12.2): rutyny stretch z animowanym przewodnikiem,
// dziennik nastroju i energii, quiz „Mój styl dnia”, moduł cyklu (odrębna zgoda, v2), rytuały.
// Treści ogólne – nie porada medyczna.

// ——— Rutyny stretch (#24) ———

export type StretchStep = { name: string; seconds: number; cue: string; side?: 'L' | 'P' };
export type StretchRoutine = { id: string; title: string; context: 'biuro' | 'wieczór' | 'po treningu' | 'poranek'; minutes: number; steps: StretchStep[] };

const both = (name: string, seconds: number, cue: string): StretchStep[] => [
  { name: `${name} – lewa`, seconds, cue, side: 'L' },
  { name: `${name} – prawa`, seconds, cue, side: 'P' },
];

export const STRETCH: StretchRoutine[] = [
  {
    id: 'office5',
    title: 'Biuro i kręgosłup',
    context: 'biuro',
    minutes: 5,
    steps: [
      { name: 'Krążenia barków', seconds: 30, cue: 'Powoli do tyłu, łopatki zjeżdżają w dół.' },
      ...both('Skłon głowy w bok', 30, 'Ucho do ramienia, drugie ramię ciężkie.'),
      { name: 'Koci grzbiet na krześle', seconds: 40, cue: 'Wdech – klatka do przodu, wydech – plecy okrągłe.' },
      ...both('Skręt na krześle', 30, 'Dłoń na oparciu, wydłuż się przed skrętem.'),
      { name: 'Otwarcie klatki', seconds: 30, cue: 'Dłonie splecione za plecami, wzrok lekko w górę.' },
      ...both('Rozciąganie bioder siedząc', 30, 'Kostka na kolanie, plecy proste, lekki skłon.'),
      { name: 'Trzy spokojne oddechy', seconds: 30, cue: 'Długi wydech. Wracasz do pracy lżejsza.' },
    ],
  },
  {
    id: 'evening10',
    title: 'Wieczorne rozluźnienie',
    context: 'wieczór',
    minutes: 10,
    steps: [
      { name: 'Pozycja dziecka', seconds: 60, cue: 'Czoło na macie, oddech w plecy.' },
      { name: 'Koci grzbiet', seconds: 60, cue: 'Ruch z oddechem, bez pośpiechu.' },
      ...both('Niska wykroczna', 45, 'Biodro miękko w dół, ramiona luźne.'),
      ...both('Gołąb (wersja łagodna)', 60, 'Jeśli kolano protestuje – wybierz leżącą czwórkę.'),
      { name: 'Skłon w siadzie', seconds: 60, cue: 'Kolana mogą być ugięte. Liczy się oddech.' },
      ...both('Skręt leżąc', 45, 'Kolana na bok, ramiona szeroko.'),
      { name: 'Nogi na ścianie', seconds: 90, cue: 'Ciało odpoczywa. Możesz zamknąć oczy.' },
    ],
  },
  {
    id: 'after5',
    title: 'Po treningu',
    context: 'po treningu',
    minutes: 5,
    steps: [
      ...both('Czworogłowy na stojąco', 30, 'Kolana razem, biodro lekko do przodu.'),
      ...both('Tył uda', 30, 'Pięta przed Tobą, skłon z prostymi plecami.'),
      ...both('Łydka przy ścianie', 30, 'Pięta dociśnięta do podłogi.'),
      { name: 'Skłon w przód', seconds: 30, cue: 'Głowa ciężka, kolana miękkie.' },
      { name: 'Oddech na koniec', seconds: 30, cue: 'Dłoń na sercu. Dziękuję.' },
    ],
  },
  {
    id: 'morning5',
    title: 'Poranne przebudzenie',
    context: 'poranek',
    minutes: 5,
    steps: [
      { name: 'Przeciąganie w leżeniu', seconds: 30, cue: 'Ręce za głowę, palce stóp daleko.' },
      { name: 'Kolana do klatki', seconds: 30, cue: 'Lekkie kołysanie na boki.' },
      { name: 'Koci grzbiet', seconds: 45, cue: 'Budzimy kręgosłup.' },
      ...both('Skłon boczny na stojąco', 30, 'Ręka nad głową, bok się wydłuża.'),
      { name: 'Wspięcia na palce', seconds: 45, cue: 'Wdech w górę, wydech w dół.' },
      { name: 'Trzy oddechy na start', seconds: 30, cue: 'Dobrego dnia.' },
    ],
  },
];

export const stretchById = (id: string) => STRETCH.find((r) => r.id === id);
export const routineSeconds = (r: StretchRoutine) => r.steps.reduce((a, s) => a + s.seconds, 0);

/** Krok rutyny po upływie `elapsed` sekund (null = koniec). */
export function stretchStepAt(r: StretchRoutine, elapsed: number): { index: number; step: StretchStep; left: number } | null {
  let t = elapsed;
  for (let i = 0; i < r.steps.length; i++) {
    if (t < r.steps[i].seconds) return { index: i, step: r.steps[i], left: Math.ceil(r.steps[i].seconds - t) };
    t -= r.steps[i].seconds;
  }
  return null;
}

// ——— Dziennik nastroju i energii (#23) ———

export type JournalEntry = { date: string; mood: number; energy: number; sleep: number; gratitude?: string };

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** Podsumowanie tygodnia: średnie i łagodny komentarz – bez ocen i bez wniosków o zdrowiu. */
export function journalWeek(entries: JournalEntry[]) {
  const mood = avg(entries.map((e) => e.mood));
  const energy = avg(entries.map((e) => e.energy));
  const sleep = avg(entries.map((e) => e.sleep));
  const best = [...entries].sort((a, b) => b.mood + b.energy - (a.mood + a.energy))[0];
  let note = 'Każdy wpis to chwila uważności. Dobrze, że jesteś dla siebie.';
  if (entries.length >= 5) note = 'Pięć wpisów i więcej – widzisz już swój rytm.';
  if (sleep !== null && sleep < 2.5) note = 'Sen był w tym tygodniu krótszy. Może wieczorna medytacja „Na sen”?';
  return { count: entries.length, mood, energy, sleep, bestDay: best?.date ?? null, gratitude: entries.filter((e) => e.gratitude).map((e) => ({ date: e.date, text: e.gratitude! })), note };
}

export const MOOD_LABELS = ['', 'ciężko', 'tak sobie', 'okej', 'dobrze', 'świetnie'];
export const ENERGY_LABELS = ['', 'bez sił', 'niska', 'w sam raz', 'dużo', 'pełna mocy'];
export const SLEEP_LABELS = ['', 'prawie wcale', 'słabo', 'w porządku', 'dobrze', 'wyśmienicie'];

export function validEntry(e: Partial<JournalEntry>): string | null {
  for (const k of ['mood', 'energy', 'sleep'] as const) {
    const v = e[k];
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 5) return 'Wybierz nastrój, energię i sen (1–5).';
  }
  if (e.gratitude && e.gratitude.length > 280) return 'Jedno zdanie wdzięczności – max 280 znaków.';
  return null;
}

// ——— Quiz „Mój styl dnia” (G3, 4.12.2) ———

export type QuizAnswers = {
  dayPart: 'morning' | 'afternoon' | 'evening';
  energy: 'low' | 'medium' | 'high';
  minutes: 15 | 30 | 45;
  goal: 'energy' | 'strength' | 'stretch' | 'calm' | 'recovery';
  reminders: 'none' | 'gentle' | 'daily';
};

export const QUIZ = [
  { key: 'dayPart', q: 'Kiedy najchętniej się ruszasz?', options: [['morning', 'Rano'], ['afternoon', 'Po południu'], ['evening', 'Wieczorem']] },
  { key: 'energy', q: 'Jak zwykle masz z energią?', options: [['low', 'Oszczędzam ją'], ['medium', 'Bywa różnie'], ['high', 'Mam jej sporo']] },
  { key: 'minutes', q: 'Ile czasu chcesz dla siebie?', options: [[15, '15 minut'], [30, '30 minut'], [45, '45 minut']] },
  { key: 'goal', q: 'Na czym Ci zależy?', options: [['energy', 'Energia'], ['strength', 'Siła'], ['stretch', 'Rozciąganie'], ['calm', 'Spokój'], ['recovery', 'Regeneracja']] },
  { key: 'reminders', q: 'Przypomnienia?', options: [['none', 'Bez przypomnień'], ['gentle', 'Delikatne, czasem'], ['daily', 'Codziennie rano']] },
] as const;

export const GOAL_LABEL: Record<QuizAnswers['goal'], string> = { energy: 'Energia', strength: 'Siła', stretch: 'Rozciąganie', calm: 'Spokój', recovery: 'Regeneracja' };

/** Efekty quizu: pora przypomnień, rekomendacje zajęć i medytacji, motyw startowy, pierwsza sekwencja. */
export function quizResult(a: QuizAnswers) {
  const reminderTime = a.reminders === 'none' ? null : a.dayPart === 'morning' ? '07:30' : a.dayPart === 'afternoon' ? '12:30' : '19:30';
  const classKeywords: Record<QuizAnswers['goal'], string[]> = {
    energy: ['Mat', 'Fitness', 'Flow'],
    strength: ['Reformer', 'Trening', 'Power'],
    stretch: ['Stretch', 'Joga', 'mobilność'],
    calm: ['Oddech', 'Stretch', 'Joga'],
    recovery: ['Stretch', 'Oddech'],
  };
  const meditation =
    a.goal === 'calm' || a.energy === 'low' ? (a.dayPart === 'evening' ? 'sleep-5' : 'stress-3') : a.dayPart === 'morning' ? 'morning-3' : a.goal === 'energy' ? 'pre' : 'post-3';
  const stretch = a.dayPart === 'morning' ? 'morning5' : a.minutes >= 30 ? 'evening10' : 'office5';
  const palette = a.goal === 'calm' || a.goal === 'recovery' ? 'sand' : a.goal === 'energy' ? 'blush' : 'isola';
  const sequence = [
    { kind: 'breath', ref: 'calm', label: 'Trzy minuty oddechu' },
    { kind: 'stretch', ref: stretch, label: 'Rutyna stretch' },
    { kind: 'class', ref: classKeywords[a.goal][0], label: `Pierwsze zajęcia: ${classKeywords[a.goal][0]}` },
  ];
  return { reminderTime, classKeywords: classKeywords[a.goal], meditation, stretch, palette, sequence, goalLabel: GOAL_LABEL[a.goal] };
}

/** Powtórka quizu co 3 miesiące. */
export const quizDue = (lastTakenIso: string | null | undefined, now: Date) => !lastTakenIso || now.getTime() - Date.parse(lastTakenIso) > 90 * 86_400_000;

// ——— Moduł cyklu (#37, v2) – tylko z odrębną zgodą (art. 9), sugestie ogólne ———

export type CyclePhase = 'menstrual' | 'follicular' | 'ovulation' | 'luteal';

export function cyclePhase(lastStart: string, today: string, length = 28, periodDays = 5): { phase: CyclePhase; day: number } {
  const day = (Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastStart}T00:00:00Z`)) / 86_400_000) % length) + 1;
  const ovulation = length - 14;
  const phase: CyclePhase = day <= periodDays ? 'menstrual' : day < ovulation - 1 ? 'follicular' : day <= ovulation + 1 ? 'ovulation' : 'luteal';
  return { phase, day };
}

export const CYCLE_SUGGESTION: Record<CyclePhase, { label: string; hint: string; intensity: 'łagodnie' | 'średnio' | 'mocniej' }> = {
  menstrual: { label: 'Dni okresu', hint: 'Słuchaj ciała. Dobrze sprawdzają się stretch, oddech i spokojny Mat.', intensity: 'łagodnie' },
  follicular: { label: 'Faza folikularna', hint: 'Często więcej energii – możesz spróbować czegoś nowego.', intensity: 'mocniej' },
  ovulation: { label: 'Okolice owulacji', hint: 'Energia bywa wysoka. Pamiętaj o rozgrzewce i technice.', intensity: 'mocniej' },
  luteal: { label: 'Faza lutealna', hint: 'Jeśli czujesz zmęczenie – wybierz spokojniejsze zajęcia.', intensity: 'średnio' },
};

// ——— Rytuały: wiadomość dnia (afirmacja lub pytanie refleksyjne) ———

export const RITUALS = [
  'Zrób dziś coś tylko dla siebie – choćby pięć minut.',
  'Twoje ciało robi dla Ciebie tyle każdego dnia. Podziękuj mu oddechem.',
  'Nie musisz nic udowadniać. Wystarczy, że jesteś.',
  'Co dziś dało Ci energię? Zauważ to.',
  'Mały krok też jest krokiem.',
  'Za co możesz dziś podziękować sobie?',
  'Odpoczynek to też część treningu.',
  'Jaka jedna rzecz sprawi, że dzisiejszy wieczór będzie miły?',
  'Bądź dla siebie tak dobra, jak dla przyjaciółki.',
  'Twoje tempo jest w porządku.',
];

export const ritualFor = (date: string) => RITUALS[Number(date.slice(8, 10)) % RITUALS.length];
