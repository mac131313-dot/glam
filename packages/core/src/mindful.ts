// Oddech i medytacje prowadzone przez aplikację (decyzja 9): bez lektorki, rytm wyznacza
// animowane koło, a prowadzenie to krótkie podpowiedzi na ekranie. Sesja = dane, nie kod.
// Treści ogólne, nie porada medyczna (4.4).
import { addDays, weekStart } from './time.ts';

export type PhaseKind = 'in' | 'hold' | 'out';

export type BreathPhase = { kind: PhaseKind; seconds: number; label: string };

export type BreathPattern = { id: string; label: string; hint: string; phases: BreathPhase[] };

const IN = (s: number): BreathPhase => ({ kind: 'in', seconds: s, label: 'wdech' });
const OUT = (s: number): BreathPhase => ({ kind: 'out', seconds: s, label: 'wydech' });
const HOLD = (s: number): BreathPhase => ({ kind: 'hold', seconds: s, label: 'zatrzymaj' });

export const PATTERNS: BreathPattern[] = [
  { id: 'calm', label: 'Oddech 4–6', hint: 'Dłuższy wydech pomaga zwolnić', phases: [IN(4), OUT(6)] },
  { id: 'even', label: 'Równy rytm', hint: 'Pięć sekund wdechu, pięć wydechu', phases: [IN(5), OUT(5)] },
  { id: 'box', label: 'Box breathing', hint: 'Cztery razy po cztery – skupienie', phases: [IN(4), HOLD(4), OUT(4), HOLD(4)] },
  { id: 'night', label: 'Na dobranoc', hint: 'Rytm 4–7–8, spokojnie i bez forsowania', phases: [IN(4), HOLD(7), OUT(8)] },
];

export type Prompt = { at: number; text: string };

export type MindfulSession = {
  id: string;
  title: string;
  category: 'Oddech' | 'Poranek' | 'Przed treningiem' | 'Po treningu' | 'Na stres' | 'Mikroprzerwa' | 'Na sen' | 'Wdzięczność' | 'Sezonowe';
  /** Medytacja tematyczna z pakietu motywu (7.2) – pokazywana, gdy motyw jest aktywny. */
  edition?: string;
  pattern: string;
  /** długość w minutach; null = wybiera klientka (sesje samego oddechu) */
  minutes: number | null;
  prompts: Prompt[];
};

export const SESSIONS: MindfulSession[] = [
  {
    id: 'morning',
    title: 'Poranek bez pośpiechu',
    category: 'Poranek',
    pattern: 'even',
    minutes: 5,
    prompts: [
      { at: 0, text: 'Usiądź wygodnie. Nigdzie się nie spieszysz.' },
      { at: 25, text: 'Oddychaj w rytmie koła.' },
      { at: 70, text: 'Poczuj stopy na podłodze.' },
      { at: 120, text: 'Zauważ, jak unosi się klatka piersiowa.' },
      { at: 170, text: 'Pomyśl o jednej rzeczy, na którą dziś czekasz.' },
      { at: 230, text: 'Z każdym wydechem rozluźnij ramiona.' },
      { at: 280, text: 'Dziękuję za tę chwilę. Dobrego dnia.' },
    ],
  },
  {
    id: 'pre',
    title: 'Przed treningiem',
    category: 'Przed treningiem',
    pattern: 'box',
    minutes: 3,
    prompts: [
      { at: 0, text: 'Zostaw za drzwiami to, co było wcześniej.' },
      { at: 30, text: 'Wdech, zatrzymanie, wydech, zatrzymanie.' },
      { at: 80, text: 'Poczuj środek ciała – stąd zaczyna się ruch.' },
      { at: 130, text: 'Jesteś gotowa. W swoim tempie.' },
    ],
  },
  {
    id: 'post',
    title: 'Po treningu',
    category: 'Po treningu',
    pattern: 'calm',
    minutes: 5,
    prompts: [
      { at: 0, text: 'Pozwól, żeby oddech sam zwolnił.' },
      { at: 40, text: 'Wydech jest dłuższy niż wdech.' },
      { at: 100, text: 'Zauważ ciepło w mięśniach.' },
      { at: 170, text: 'Podziękuj ciału za dzisiejszy ruch.' },
      { at: 260, text: 'Jeszcze kilka spokojnych oddechów.' },
    ],
  },
  {
    id: 'stress',
    title: 'Kiedy jest za dużo',
    category: 'Na stres',
    pattern: 'calm',
    minutes: 5,
    prompts: [
      { at: 0, text: 'Na te kilka minut możesz wszystko odłożyć.' },
      { at: 35, text: 'Skup się tylko na kole.' },
      { at: 90, text: 'Rozluźnij szczękę i czoło.' },
      { at: 150, text: 'Myśli przychodzą i odchodzą. Wracaj do oddechu.' },
      { at: 230, text: 'Masz w sobie więcej spokoju, niż myślisz.' },
    ],
  },
  {
    id: 'micro',
    title: 'Mikroprzerwa w pracy',
    category: 'Mikroprzerwa',
    pattern: 'calm',
    minutes: 2,
    prompts: [
      { at: 0, text: 'Oderwij wzrok od ekranu.' },
      { at: 30, text: 'Opuść ramiona, wyprostuj plecy.' },
      { at: 75, text: 'Jeszcze trzy spokojne wydechy.' },
    ],
  },
  {
    id: 'sleep',
    title: 'Spokojny sen',
    category: 'Na sen',
    pattern: 'night',
    minutes: 10,
    prompts: [
      { at: 0, text: 'Połóż się wygodnie. Dzień się kończy.' },
      { at: 40, text: 'Wdech nosem, długi wydech ustami.' },
      { at: 120, text: 'Rozluźnij stopy, łydki, kolana.' },
      { at: 200, text: 'Biodra, brzuch, plecy robią się ciężkie.' },
      { at: 290, text: 'Ramiona i dłonie odpoczywają.' },
      { at: 380, text: 'Twarz jest miękka.' },
      { at: 480, text: 'Nie musisz już nic robić.' },
    ],
  },

  // ——— Biblioteka rozszerzona do min. 20 scenariuszy (#20, decyzja 9) ———
  s('morning-3', 'Trzy oddechy na start dnia', 'Poranek', 'even', 3, ['Zanim sięgniesz po telefon – zatrzymaj się.', 'Wdech, który budzi.', 'Wydech, który zostawia sen za Tobą.', 'Jedno słowo na dziś: jakie?']),
  s('morning-10', 'Spokojny poranek', 'Poranek', 'calm', 10, ['Usiądź z kubkiem czegoś ciepłego.', 'Poczuj ciepło w dłoniach.', 'Rozciągnij kark – powoli w prawo i w lewo.', 'Zauważ dźwięki wokół.', 'Pomyśl o kimś, kogo dziś zobaczysz.', 'Uśmiechnij się do siebie.', 'Dzień może zacząć się teraz.']),
  s('pre-5', 'Skupienie przed zajęciami', 'Przed treningiem', 'box', 5, ['Stopy mocno na ziemi.', 'Wdech do żeber, na boki.', 'Wydech – pępek miękko do kręgosłupa.', 'Ramiona daleko od uszu.', 'Gotowa? Zaczynamy w Twoim tempie.']),
  s('post-3', 'Wyciszenie po zajęciach', 'Po treningu', 'calm', 3, ['Połóż dłoń na sercu.', 'Poczuj, jak zwalnia.', 'Dziękuję ciału za ruch.']),
  s('post-10', 'Długie rozluźnienie', 'Po treningu', 'night', 10, ['Połóż się na plecach.', 'Pozwól, żeby mata Cię niosła.', 'Rozluźnij biodra.', 'Puść barki.', 'Oddychaj w rytmie koła.', 'Ciepło rozchodzi się po ciele.', 'Zostań tu tak długo, jak potrzebujesz.']),
  s('stress-3', 'SOS na stres', 'Na stres', 'box', 3, ['Zatrzymaj się. Jesteś bezpieczna.', 'Licz razem z kołem.', 'Wydech dłuższy niż myśl.', 'To minie. Oddychasz.']),
  s('stress-10', 'Odkładam to, co ciężkie', 'Na stres', 'calm', 10, ['Wyobraź sobie, że odkładasz plecak.', 'Ramiona robią się lżejsze.', 'Rozluźnij brzuch.', 'Zauważ myśl i pozwól jej odpłynąć.', 'Wracaj do koła.', 'Nie musisz dziś wszystkiego rozwiązać.', 'Masz prawo odpocząć.']),
  s('stress-15', 'Głęboki reset', 'Na stres', 'night', 15, ['Daj sobie kwadrans.', 'Wdech nosem, długi wydech.', 'Skanuj ciało od stóp.', 'Łydki, kolana, uda.', 'Biodra i brzuch.', 'Plecy i ramiona.', 'Szyja, twarz, czoło.', 'Całe ciało oddycha.', 'Jesteś tu i teraz.']),
  s('micro-1', 'Minuta przy biurku', 'Mikroprzerwa', 'even', 1, ['Zamknij oczy na chwilę.', 'Trzy powolne oddechy.']),
  s('micro-3', 'Kark i ramiona', 'Mikroprzerwa', 'calm', 3, ['Opuść brodę do mostka.', 'Ucho w stronę ramienia – oddychaj.', 'Druga strona.', 'Zakręć barkami do tyłu.']),
  s('sleep-5', 'Krótko przed snem', 'Na sen', 'night', 5, ['Zgaś światło.', 'Wydech, jakbyś zdmuchiwała świecę.', 'Ciało robi się ciężkie.', 'Dobranoc.']),
  s('sleep-15', 'Sen bez gonitwy myśli', 'Na sen', 'night', 15, ['Połóż się wygodnie.', 'Każdy wydech to krok w dół schodów.', 'Myśli mogą poczekać do rana.', 'Rozluźnij język i szczękę.', 'Dłonie są ciepłe.', 'Oddech zwalnia sam.', 'Śpij spokojnie.']),
  s('gratitude', 'Trzy rzeczy, za które dziękuję', 'Wdzięczność', 'calm', 5, ['Pomyśl o jednej małej rzeczy z dzisiaj.', 'Drugiej – związanej z kimś bliskim.', 'Trzeciej – o sobie.', 'Zatrzymaj to uczucie na kilka oddechów.']),
  s('self-love', 'Miłość do siebie', 'Wdzięczność', 'even', 5, ['Połóż dłonie na brzuchu.', 'Twoje ciało niesie Cię każdego dnia.', 'Powiedz w myślach: wystarczam.', 'Oddychaj z czułością.'], 'walentynki'),
  s('memory', 'Pamięć i wdzięczność', 'Sezonowe', 'calm', 5, ['Zapal w myślach światło.', 'Pomyśl o kimś bliskim.', 'Wdzięczność za wspólny czas.', 'Spokój zostaje z Tobą.'], 'zaduszki'),
  s('xmas', 'Spokojne święta', 'Sezonowe', 'calm', 10, ['Zanim zacznie się gwar – chwila dla Ciebie.', 'Ciepło, światła, oddech.', 'Nie wszystko musi być idealne.', 'Wystarczy, że jesteś.', 'Zabierz ten spokój do stołu.'], 'swieta'),
  s('fresh', 'Świeży start', 'Sezonowe', 'even', 5, ['Otwórz okno w myślach.', 'Wdech świeżego powietrza.', 'Co chcesz zasadzić w tym sezonie?', 'Zrób pierwszy mały krok.'], 'wiosna'),
  s('new-year', 'Co zostawiam w starym roku', 'Sezonowe', 'calm', 10, ['Pomyśl o mijającym roku.', 'Co Ci służyło?', 'Co możesz odłożyć?', 'Wydech – zostawiam.', 'Wdech – zabieram ze sobą spokój.'], 'sylwester'),
];

/** Skrót: podpowiedzi rozłożone równo w czasie sesji. */
function s(id: string, title: string, category: MindfulSession['category'], pattern: string, minutes: number, lines: string[], edition?: string): MindfulSession {
  const step = (minutes * 60) / lines.length;
  return { id, title, category, pattern, minutes, edition, prompts: lines.map((text, i) => ({ at: Math.round(i * step), text })) };
}

/** Mini-kurs „7 dni spokoju” (4.4): codziennie jedna sesja, kolejny dzień odblokowuje się następnego dnia. */
export const CALM_7 = {
  id: 'calm7',
  title: '7 dni spokoju',
  days: [
    { day: 1, title: 'Zatrzymanie', sessionId: 'micro', note: 'Dziś tylko dwie minuty. Zauważ oddech.' },
    { day: 2, title: 'Rytm', sessionId: 'morning-3', note: 'Spokojny rytm na początek dnia.' },
    { day: 3, title: 'Ciało', sessionId: 'post', note: 'Uwaga przesuwa się do ciała.' },
    { day: 4, title: 'Napięcie', sessionId: 'stress', note: 'Rozluźniamy to, co spięte.' },
    { day: 5, title: 'Wdzięczność', sessionId: 'gratitude', note: 'Trzy małe rzeczy.' },
    { day: 6, title: 'Wieczór', sessionId: 'sleep-5', note: 'Spokojne zakończenie dnia.' },
    { day: 7, title: 'Twoja chwila', sessionId: 'morning-10', note: 'Dziesięć minut tylko dla Ciebie.' },
  ],
};

export function calmDayUnlocked(doneDays: { day: number; doneOn: string }[], day: number, today: string): boolean {
  if (day === 1) return true;
  const prev = doneDays.find((d) => d.day === day - 1);
  return !!prev && prev.doneOn < today;
}

export const sessionById = (id: string) => SESSIONS.find((s) => s.id === id);
export const patternById = (id: string) => PATTERNS.find((p) => p.id === id) ?? PATTERNS[0];

export const cycleSeconds = (p: BreathPattern) => p.phases.reduce((a, ph) => a + ph.seconds, 0);

export type BreathState = {
  index: number;
  phase: BreathPhase;
  /** 0..1 – postęp bieżącej fazy */
  progress: number;
  cycle: number;
  secondsLeft: number;
  /** 0..1 – „wypełnienie” koła (0 = po wydechu, 1 = po wdechu) */
  level: number;
};

const ease = (t: number) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2;

/** Gdzie w rytmie jesteśmy po `elapsedMs` – czysta funkcja, z niej rysuje się koło. */
export function breathAt(p: BreathPattern, elapsedMs: number): BreathState {
  const cycleMs = cycleSeconds(p) * 1000;
  const cycle = Math.floor(elapsedMs / cycleMs);
  let t = elapsedMs - cycle * cycleMs;
  let index = 0;
  while (index < p.phases.length - 1 && t >= p.phases[index].seconds * 1000) {
    t -= p.phases[index].seconds * 1000;
    index++;
  }
  const phase = p.phases[index];
  const durMs = phase.seconds * 1000;
  const progress = Math.min(1, t / durMs);
  return { index, phase, progress, cycle, secondsLeft: Math.max(1, Math.ceil((durMs - t) / 1000)), level: levelOf(p, index, progress) };
}

function levelOf(p: BreathPattern, index: number, progress: number): number {
  const phase = p.phases[index];
  if (phase.kind === 'in') return ease(progress);
  if (phase.kind === 'out') return 1 - ease(progress);
  // zatrzymanie: koło zostaje tam, gdzie zostawiła je poprzednia faza ruchu
  for (let i = 1; i <= p.phases.length; i++) {
    const prev = p.phases[(index - i + p.phases.length) % p.phases.length];
    if (prev.kind !== 'hold') return prev.kind === 'in' ? 1 : 0;
  }
  return 0;
}

/** Wiatr na łące, gdy nikt nie oddycha – trawa nigdy nie zamiera całkiem. */
export const WIND_CALM = 0.12;

/** Ile podmuchu daje każda faza (0..1 ponad ciszę): wdech lekko, wydech mocniej, zatrzymanie – cisza. */
export const WIND_PEAK: Record<PhaseKind, number> = { in: 0.3, out: 1, hold: 0 };

/**
 * Siła wiatru 0..1 dla scenki z łąką. Podmuch narasta i opada w obrębie fazy po krzywej sin²,
 * która ma zerowe nachylenie na obu końcach – na granicy faz wiatr zmienia się bez szarpnięcia.
 */
export function windAt(p: BreathPattern, elapsedMs: number): number {
  const st = breathAt(p, elapsedMs);
  const swell = Math.sin(Math.PI * st.progress) ** 2;
  return WIND_CALM + (1 - WIND_CALM) * WIND_PEAK[st.phase.kind] * swell;
}

/** Aktualna podpowiedź (ostatnia, której czas już minął). */
export function promptAt(session: MindfulSession, elapsedSec: number): Prompt | undefined {
  let current: Prompt | undefined;
  for (const pr of session.prompts) if (pr.at <= elapsedSec) current = pr;
  return current;
}

/**
 * Długość wybierana raz, na początku – nazwana nastrojem, nie liczbą. W trakcie sesji
 * nie pokazujemy ani licznika, ani paska postępu, żeby chwila się nie dłużyła.
 */
export const BREATH_LENGTHS = [
  { minutes: 2, label: 'Chwilka' },
  { minutes: 3, label: 'Lekko' },
  { minutes: 5, label: 'Spokojnie' },
  { minutes: 10, label: 'Głęboko' },
];

export type BreathRitual = {
  /** czy dziś już był oddech lub medytacja */
  today: boolean;
  /** dni z rzędu; dzień, który jeszcze trwa, nie przerywa serii */
  streak: number;
  /** bieżący tydzień, poniedziałek … niedziela */
  week: boolean[];
  /** wszystkie dni z chwilą dla siebie */
  total: number;
};

/** Codzienny rytuał oddechu z listy dni (YYYY-MM-DD, w strefie studia). */
export function breathRitual(days: string[], today: string): BreathRitual {
  const set = new Set(days);
  let streak = 0;
  for (let d = set.has(today) ? today : addDays(today, -1); set.has(d); d = addDays(d, -1)) streak++;
  const monday = weekStart(today);
  return { today: set.has(today), streak, week: Array.from({ length: 7 }, (_, i) => set.has(addDays(monday, i))), total: set.size };
}

/** Myśl na dziś po sesji – jedna na dzień, ta sama przez cały dzień. */
export const AFFIRMATIONS = [
  'Jestem dla siebie łagodna.',
  'Mam prawo zwolnić.',
  'Mój oddech jest zawsze ze mną.',
  'Wystarczy, że jestem.',
  'Dbam o siebie bez pośpiechu.',
  'Moje ciało jest moim domem.',
  'Każdy wydech robi miejsce na spokój.',
  'Nie muszę być idealna, żeby być wystarczająca.',
  'Zasługuję na chwilę tylko dla siebie.',
  'Moje tempo jest dobrym tempem.',
  'Odpuszczam to, na co nie mam wpływu.',
  'Jestem wdzięczna za ten dzień.',
  'Rosnę po cichu, każdego dnia.',
  'Miękkość też jest siłą.',
];

export function affirmationFor(date: string): string {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return AFFIRMATIONS[((day % AFFIRMATIONS.length) + AFFIRMATIONS.length) % AFFIRMATIONS.length];
}
