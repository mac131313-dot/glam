// Motywy sezonowe (7): tryb automatyczny wg harmonogramu (M1), dla segmentu (M3), ręczny (M2),
// opt-out (M4). Stałe smaczki (7.5): pora dnia, „pierwszy dzień tygodnia”, tryb „Dziś odpoczywam”.
import type { Palette } from './look.ts';
import type { DayPart } from './time.ts';

export type ThemeRow = { id: string; startsOn: string | null; endsOn: string | null; auto: boolean; isActive: boolean; segment: string | null };

/** Który motyw powinien być aktywny dziś (tryb automatyczny). Ręcznie włączony wygrywa. */
export function scheduledTheme(themes: ThemeRow[], today: string): string | null {
  const manual = themes.find((t) => t.isActive && !t.auto);
  if (manual) return manual.id;
  const due = themes
    .filter((t) => t.auto && t.startsOn && t.endsOn && t.startsOn <= today && today <= t.endsOn)
    // przy nakładaniu wygrywa krótszy (bardziej konkretny – np. Halloween w październiku)
    .sort((a, b) => span(a) - span(b));
  return due[0]?.id ?? null;
}

const span = (t: ThemeRow) => Date.parse(t.endsOn!) - Date.parse(t.startsOn!);

/** Motyw tylko dla segmentu – czy ta klientka go widzi. */
export function themeVisibleFor(segment: string | null, clientSegments: string[]): boolean {
  return !segment || clientSegments.includes(segment);
}

/** Ostatni dzień motywu – push „Ostatnia szansa na odznakę”. */
export const isLastDay = (t: Pick<ThemeRow, 'endsOn'>, today: string) => t.endsOn === today;

/**
 * Stały smaczek 7.5: poniedziałek w pastelach, weekend w nieco ciemniejszych kolorach.
 * Zwraca delikatną korektę palety (bez zmiany znaczenia przycisków i kontrastu tekstu).
 */
export function weekdayTint(weekday: number): Partial<Palette> | null {
  if (weekday === 1) return { soft: '#efe4e4' };
  if (weekday >= 6) return { soft: '#ddd5ca', line: '#d6cdc1' };
  return null;
}

export const DAYPART_COPY: Record<DayPart, string> = { morning: 'Poranek', afternoon: 'Popołudnie', evening: 'Wieczór' };

/** Kontrast WCAG (7.6): stosunek luminancji dwóch kolorów #rrggbb. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = hex.replace('#', '');
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

/** Paleta motywu musi spełniać WCAG AA (4.5:1) dla tekstu i przycisków. */
export function themeContrastErrors(p: Partial<Palette>): string[] {
  const errors: string[] = [];
  const pairs: [keyof Palette, keyof Palette, string][] = [
    ['ink', 'bg', 'tekst na tle'],
    ['ink', 'surface', 'tekst na kartach'],
    ['muted', 'bg', 'tekst pomocniczy'],
    ['accentInk', 'accent', 'napis na przycisku'],
  ];
  for (const [fg, bg, label] of pairs) {
    if (p[fg] && p[bg] && contrastRatio(p[fg]!, p[bg]!) < 4.5) errors.push(`Za mały kontrast: ${label} (min. 4,5:1).`);
  }
  return errors;
}

/** Dźwięki motywu (M8) – krótkie, generowane w aplikacji, zawsze wyciszalne. */
export const THEME_SOUNDS = [
  { id: 'none', label: 'Bez dźwięku' },
  { id: 'chime', label: 'Dzwoneczek' },
  { id: 'soft', label: 'Miękkie kliknięcie' },
  { id: 'bells', label: 'Świąteczne dzwonki' },
] as const;

/** Alternatywne ikony aplikacji (M7) – nazwy zasobów w natywnej aplikacji (iOS/Android). */
export const APP_ICONS = [
  { id: 'default', label: 'Klasyczna' },
  { id: 'autumn', label: 'Jesienna' },
  { id: 'winter', label: 'Zimowa' },
  { id: 'gold', label: 'Złoto-biała' },
] as const;

// ——— Wygląd edycji z biblioteki (7.4): emoji i paleta, żeby „Użyj” dawało gotowy motyw ———
// Te same miękkie, neutralne tony co reszta aplikacji – sezon to tylko przesunięta temperatura koloru.

const tone = (bg: string, surface: string, soft: string, brand: string, brandStrong: string, ink: string, muted: string, line: string, accent = ink, accentInk = bg): Palette =>
  ({ bg, surface, soft, brand, brandStrong, ink, muted, accent, accentInk, line }) as Palette;

export const EDITION_TONES = {
  frost: tone('#eff0ed', '#fafbf9', '#dde0da', '#9aa394', '#5d6658', '#1a1d19', '#575d54', '#dadfd7'),
  blush: tone('#f6f0ee', '#fdfaf9', '#eadbd7', '#c09a92', '#875f58', '#241c1b', '#62534f', '#e8dcd8'),
  fresh: tone('#eef1ea', '#fafbf8', '#dde5d6', '#8fa383', '#5a6e50', '#1a1f17', '#566052', '#dbe2d4'),
  sun: tone('#f6f1e7', '#fffcf6', '#ece1cb', '#c4a36a', '#8a6c36', '#221c12', '#5f5440', '#e9dfcb'),
  sea: tone('#edf1f2', '#f9fbfb', '#d8e3e6', '#7f9ea6', '#4d6b73', '#162022', '#4f5d60', '#d6e0e2'),
  autumn: tone('#f1ebe3', '#fbf8f4', '#e4d8c9', '#a8876a', '#7a5c43', '#211a15', '#5f5247', '#e2d7ca'),
  dusk: tone('#ecebe8', '#f8f7f5', '#d9d6d1', '#8a8178', '#5e5650', '#161413', '#5a5552', '#d9d5d0'),
  redwhite: tone('#faf8f7', '#ffffff', '#f1e4e3', '#b6464a', '#8e2f33', '#1d1716', '#5c5250', '#ece2e0', '#8e2f33', '#ffffff'),
  pine: tone('#f5efe6', '#fffbf5', '#e6e9df', '#b8433f', '#8f2b2e', '#1c2620', '#4d5a51', '#e4dccd', '#23412f', '#f5efe6'),
  gold: tone('#f4f1ea', '#fdfbf7', '#e8e0cc', '#b59a5b', '#7d6630', '#1c1a15', '#5b5547', '#e5dece'),
} satisfies Record<string, Palette>;

export type EditionLook = { emoji: string; tone: keyof typeof EDITION_TONES; effect?: 'snow' };

/** Klucze jak `EDITIONS[].id` w occasions.ts. Brak wpisu → neutralny „frost”. */
export const EDITION_LOOKS: Record<string, EditionLook> = {
  styczen: { emoji: '❄️', tone: 'frost' },
  walentynki: { emoji: '💗', tone: 'blush' },
  dzien_kobiet: { emoji: '🌷', tone: 'blush' },
  wiosna: { emoji: '🌱', tone: 'fresh' },
  dzien_matki: { emoji: '💐', tone: 'blush' },
  lato: { emoji: '☀️', tone: 'sun' },
  wakacje: { emoji: '🌊', tone: 'sea' },
  wrzesien: { emoji: '🍃', tone: 'fresh' },
  pazdziernik: { emoji: '🍂', tone: 'autumn' },
  halloween: { emoji: '🎃', tone: 'dusk' },
  zaduszki: { emoji: '🕯️', tone: 'dusk' },
  niepodleglosc: { emoji: '🤍', tone: 'redwhite' },
  black_friday: { emoji: '💌', tone: 'blush' },
  mikolajki: { emoji: '🎁', tone: 'pine' },
  swieta: { emoji: '🎄', tone: 'pine', effect: 'snow' },
  sylwester: { emoji: '✨', tone: 'gold' },
};

export function editionLook(id: string) {
  const look = EDITION_LOOKS[id] ?? { emoji: '✨', tone: 'frost' };
  return { emoji: look.emoji, effect: look.effect ?? null, palette: EDITION_TONES[look.tone] };
}
