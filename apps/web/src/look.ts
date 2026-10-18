// Nakłada wygląd studia (core/look.ts) na aplikację: zmienne CSS + ładowanie czcionek.
import { fontById, paletteById, panelTintById, resolveLook, SOFTNESS, type Look, type Palette } from '@glam/core';

/** Ciemny wariant – ciepła czerń zamiast czystej, żeby zachować charakter palet z moodboardu. */
const DARK: Palette = {
  bg: '#171412',
  surface: '#211d1a',
  soft: '#2c2723',
  brand: '#9b8570',
  brandStrong: '#c9b49e',
  ink: '#efe9e1',
  muted: '#b4a99d',
  accent: '#efe9e1',
  accentInk: '#171412',
  line: '#332d29',
};

const VAR: Record<keyof Palette, string> = {
  bg: '--bg',
  surface: '--surface',
  soft: '--soft',
  brand: '--brand',
  brandStrong: '--brand-strong',
  ink: '--ink',
  muted: '--muted',
  accent: '--accent',
  accentInk: '--accent-ink',
  line: '--line',
};

const loaded = new Set<string>();

export function loadFonts(look: Look) {
  loadFontIds(Object.values(look.fonts));
}

export function loadFontIds(ids: string[]) {
  for (const id of ids) {
    const f = fontById(id);
    if (loaded.has(f.id) || f.pending) continue; // bez plików nie ma czego ładować
    loaded.add(f.id);
    if (f.source.type === 'google') {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${f.source.query}&display=swap`;
      document.head.appendChild(link);
    } else {
      const family = f.family.split(',')[0].replace(/'/g, '');
      const style = document.createElement('style');
      style.textContent = f.source.faces
        .map((face) => `@font-face{font-family:'${family}';src:url('${face.url}');font-weight:${face.weight};font-style:${face.style};font-display:swap}`)
        .join('\n');
      document.head.appendChild(style);
    }
  }
}

/** Tryb jasny / ciemny / jak w systemie (sekcja 10). Domyślnie jasny – zgodnie z moodboardem. */
export type Appearance = 'light' | 'dark' | 'auto';
const APPEARANCE_KEY = 'glam.appearance';

export function getAppearance(): Appearance {
  try {
    const v = localStorage.getItem(APPEARANCE_KEY);
    return v === 'dark' || v === 'auto' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function setAppearance(a: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, a);
  } catch {}
  if (last) applyLook(last.look);
}

const prefersDark = () => {
  const a = getAppearance();
  return a === 'dark' || (a === 'auto' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
};

let last: { look: Partial<Look> | null | undefined } | null = null;

/** Zmienne CSS dla danego wyglądu – używane na :root i w podglądzie w panelu. */
export function lookVars(rawLook: Partial<Look> | null | undefined, dark = false): Record<string, string> {
  const look = resolveLook(rawLook);
  const palette = dark ? DARK : paletteById(look.palette);
  const soft = SOFTNESS[look.softness];
  const vars: Record<string, string> = {
    '--font-display': fontById(look.fonts.display).family,
    '--font-head': fontById(look.fonts.head).family,
    '--font-body': fontById(look.fonts.body).family,
    '--font-label': fontById(look.fonts.label).family,
    '--radius': `${soft.radius}px`,
    '--radius-sm': `${soft.radiusSm}px`,
    '--photo-dim': String(look.photoDim),
    '--photo-blur': `${look.photoBlur}px`,
    '--photo-blur-display': look.photoBlur > 0 ? 'block' : 'none',
    '--photo-fade': look.photoBlur > 0 ? '0.5' : '0',
  };
  for (const [k, v] of Object.entries(palette)) vars[VAR[k as keyof Palette]] = v;
  return vars;
}

let applied: string[] = [];

function setRootVars(vars: Record<string, string>, theme: 'light' | 'dark') {
  const root = document.documentElement;
  for (const k of applied) root.style.removeProperty(k);
  root.dataset.theme = theme;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  applied = Object.keys(vars);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg']);
}

export function applyLook(look: Partial<Look> | null | undefined) {
  last = { look };
  const resolved = resolveLook(look);
  loadFonts(resolved);
  const dark = prefersDark();
  setRootVars(lookVars(resolved, dark), dark ? 'dark' : 'light');
}

/** Panel studia to narzędzie pracy: zawsze biały i jasny, niezależnie od marki studia i trybu ciemnego klientki.
 *  Jedyny akcent to kolor przewodni wybrany w ustawieniach (--tint / --tint-soft); bez wyboru – grafit, jak dotąd. */
export function applySystemLook(tintId?: string | null) {
  last = null;
  const sans = "'Rethink Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  const vars: Record<string, string> = {
    '--font-display': sans,
    '--font-head': sans,
    '--font-body': sans,
    '--font-label': sans,
    '--radius': '14px',
    '--radius-sm': '10px',
    '--shadow': '0 1px 2px rgb(24 24 27 / 0.04)',
  };
  for (const [k, v] of Object.entries(paletteById('biel'))) vars[VAR[k as keyof Palette]] = v;
  const tint = panelTintById(tintId);
  vars['--tint'] = tint.color;
  vars['--tint-soft'] = tint.soft;
  setRootVars(vars, 'light');
}
