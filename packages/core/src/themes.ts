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
