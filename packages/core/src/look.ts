// Wygląd studia (T4: marka studia w aplikacji). Wygląd to dane, nie kod:
// paleta + trzy role czcionek + stopień miękkości. Motyw sezonowy (sekcja 7) nadpisuje tylko kolory.

export type Palette = {
  /** tło aplikacji */
  bg: string;
  /** karty, arkusze */
  surface: string;
  /** miękkie tła (kafelki, chipy, wyróżnienia) */
  soft: string;
  /** kolor marki – dekoracyjny (nie pod tekst) */
  brand: string;
  /** kolor marki pod tekst – min. 4.5:1 na tle */
  brandStrong: string;
  /** tekst główny */
  ink: string;
  /** tekst drugorzędny – min. 4.5:1 na tle */
  muted: string;
  /** przycisk główny */
  accent: string;
  /** tekst na przycisku głównym */
  accentInk: string;
  /** linie, obramowania */
  line: string;
};

export type PalettePreset = { id: string; label: string; inspiration: string; palette: Palette };

export const PALETTES: PalettePreset[] = [
  {
    id: 'biel',
    label: 'Czysta biel',
    inspiration: 'biel, grafit i jasna szarość – najczytelniej',
    palette: {
      bg: '#ffffff',
      surface: '#ffffff',
      soft: '#f3f3f4',
      brand: '#a1a1aa',
      brandStrong: '#52525b',
      ink: '#18181b',
      muted: '#5f5f66',
      accent: '#18181b',
      accentInk: '#ffffff',
      line: '#e6e6e9',
    },
  },
  {
    id: 'isola',
    label: 'Kamień i taupe',
    inspiration: 'Isola · #dad6c9 · #9b8570 · #1b1715',
    palette: {
      bg: '#f3f0ea',
      surface: '#fbfaf7',
      soft: '#e6e1d6',
      brand: '#9b8570',
      brandStrong: '#7a6553',
      ink: '#1b1715',
      muted: '#5e554c',
      accent: '#1b1715',
      accentInk: '#f3f0ea',
      line: '#e0dacf',
    },
  },
  {
    id: 'unbound',
    label: 'Mgła i grafit',
    inspiration: 'Unbound · #d7d2cd · #b1a497 · #6d6968',
    palette: {
      bg: '#efedea',
      surface: '#faf9f7',
      soft: '#e2ddd8',
      brand: '#b1a497',
      brandStrong: '#6f6458',
      ink: '#2f2b2a',
      muted: '#6d6968',
      accent: '#3a3634',
      accentInk: '#faf9f7',
      line: '#ddd8d3',
    },
  },
  {
    id: 'sand',
    label: 'Piasek i mleko',
    inspiration: 'jaśniejszy wariant, więcej powietrza',
    palette: {
      bg: '#f7f4ef',
      surface: '#fffdfa',
      soft: '#ece5da',
      brand: '#c2ad93',
      brandStrong: '#7b6853',
      ink: '#24201d',
      muted: '#655b51',
      accent: '#24201d',
      accentInk: '#f7f4ef',
      line: '#e7e0d5',
    },
  },
  {
    id: 'blush',
    label: 'Pudrowy róż',
    inspiration: 'pierwotna paleta „girl vibe” (6.5)',
    palette: {
      bg: '#faf5f3',
      surface: '#fffcfb',
      soft: '#f1e2e2',
      brand: '#d4a5a5',
      brandStrong: '#8e5a5f',
      ink: '#2e2224',
      muted: '#6b5a5d',
      accent: '#2e2224',
      accentInk: '#faf5f3',
      line: '#ecdedd',
    },
  },
];

/** Efekt dekoracyjny motywu sezonowego – czysto wizualny, wyłączany przez „Zawsze standard” i ograniczenie ruchu. */
export type SeasonalEffect = 'snow';

export type FontRole = 'display' | 'head' | 'body' | 'label';

export type FontDef = {
  id: string;
  label: string;
  /** wartość CSS font-family (z rezerwą) */
  family: string;
  roles: FontRole[];
  /** google = Google Fonts; file = pliki w apps/web/public/fonts (czcionki licencjonowane od klienta) */
  source: { type: 'google'; query: string } | { type: 'file'; faces: { url: string; weight: number; style: 'normal' | 'italic' }[] };
  /** która czcionka z moodboardu jest tu zastępowana do czasu dostarczenia plików */
  standIn?: string;
  /** czcionka zgłoszona przez klienta, ale bez plików w repo – widoczna w edytorze, niewybieralna */
  pending?: string;
};

/** Czcionka z plików w apps/web/public/fonts/<id>/ – konwencja nazw dla dostarczanych krojów. */
const fileFont = (id: string, label: string, family: string, roles: FontRole[], faces: [number, 'normal' | 'italic'][], pending: string): FontDef => ({
  id,
  label,
  family,
  roles,
  source: { type: 'file', faces: faces.map(([weight, style]) => ({ url: `/fonts/${id}/${id}-${weight}${style === 'italic' ? 'i' : ''}.woff2`, weight, style })) },
  pending,
});

const COMMERCIAL = 'czeka na pliki .woff2 i licencję (komercyjna odlewnia)';
const CHECK_LICENSE = 'czeka na pliki .woff2 i sprawdzenie licencji na aplikację';

export const FONTS: FontDef[] = [
  // Szeryfy do akcentów w kursywie (jak „un” w Unbound, Loretta Display w Isoli)
  { id: 'cormorant', label: 'Cormorant Garamond', family: "'Cormorant Garamond', Georgia, serif", roles: ['display'], source: { type: 'google', query: 'Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500' }, standIn: 'Loretta Display / The Seasons' },
  { id: 'playfair', label: 'Playfair Display', family: "'Playfair Display', Georgia, serif", roles: ['display'], source: { type: 'google', query: 'Playfair+Display:ital,wght@0,400;0,500;1,400' } },
  { id: 'bodoni', label: 'Bodoni Moda', family: "'Bodoni Moda', Georgia, serif", roles: ['display'], source: { type: 'google', query: 'Bodoni+Moda:ital,opsz,wght@0,6..96,400;1,6..96,400' } },
  { id: 'gilda', label: 'Gilda Display', family: "'Gilda Display', Georgia, serif", roles: ['display'], source: { type: 'google', query: 'Gilda+Display' } },
  // Geometryczne sansy do nagłówków (jak wordmark Isoli / Altone)
  { id: 'outfit', label: 'Outfit', family: "'Outfit', system-ui, sans-serif", roles: ['head', 'body', 'label'], source: { type: 'google', query: 'Outfit:wght@300;400;500;600' }, standIn: 'MDF Canno / Altone' },
  { id: 'urbanist', label: 'Urbanist', family: "'Urbanist', system-ui, sans-serif", roles: ['head', 'body', 'label'], source: { type: 'google', query: 'Urbanist:wght@400;500;600;700' } },
  { id: 'jost', label: 'Jost', family: "'Jost', system-ui, sans-serif", roles: ['head', 'body', 'label'], source: { type: 'google', query: 'Jost:wght@400;500;600' } },
  { id: 'quicksand', label: 'Quicksand', family: "'Quicksand', system-ui, sans-serif", roles: ['head'], source: { type: 'google', query: 'Quicksand:wght@500;600;700' } },
  // Tekst
  { id: 'rethink', label: 'Rethink Sans', family: "'Rethink Sans', system-ui, sans-serif", roles: ['head', 'body', 'label'], source: { type: 'google', query: 'Rethink+Sans:wght@400;500;600' } },
  { id: 'dmsans', label: 'DM Sans', family: "'DM Sans', system-ui, sans-serif", roles: ['body'], source: { type: 'google', query: 'DM+Sans:wght@400;500;600' } },
  { id: 'inter', label: 'Inter', family: "'Inter', system-ui, sans-serif", roles: ['body'], source: { type: 'google', query: 'Inter:wght@400;500;600' } },

  // ——— Kroje wskazane przez GLAM (2026-10-13) ———
  // Dostępne od razu (Google Fonts, licencja OFL – można osadzić w aplikacji mobilnej)
  { id: 'jakarta', label: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans', system-ui, sans-serif", roles: ['head', 'body', 'label'], source: { type: 'google', query: 'Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;1,400' } },
  { id: 'ballet', label: 'Ballet', family: "'Ballet', 'Cormorant Garamond', cursive", roles: ['display'], source: { type: 'google', query: 'Ballet:opsz@16..72' } },
  { id: 'dmmono', label: 'DM Mono', family: "'DM Mono', ui-monospace, monospace", roles: ['label'], source: { type: 'google', query: 'DM+Mono:wght@400;500' }, standIn: 'Apercu Mono' },
  // Wymagają plików od GLAM
  fileFont('alte-haas', 'Alte Haas Grotesk', "'Alte Haas Grotesk', 'Outfit', system-ui, sans-serif", ['head', 'body', 'label'], [[400, 'normal'], [700, 'normal']], CHECK_LICENSE),
  fileFont('louis-george', 'Louis George Café', "'Louis George Cafe', 'Outfit', system-ui, sans-serif", ['head', 'body'], [[300, 'normal'], [400, 'normal'], [700, 'normal']], CHECK_LICENSE),
  fileFont('circular', 'Circular Std', "'Circular Std', 'Outfit', system-ui, sans-serif", ['head', 'body', 'label'], [[400, 'normal'], [500, 'normal'], [700, 'normal']], COMMERCIAL),
  fileFont('jane-austen', 'Jane Austen', "'Jane Austen', 'Cormorant Garamond', cursive", ['display'], [[400, 'normal']], CHECK_LICENSE),
  fileFont('melodrame', 'Relationship of Mélodrame', "'Relationship of Melodrame', 'Cormorant Garamond', serif", ['display'], [[400, 'normal']], CHECK_LICENSE),
  fileFont('altesse', 'Altesse Std', "'Altesse Std', 'Cormorant Garamond', cursive", ['display'], [[400, 'normal']], COMMERCIAL),
  fileFont('apercu-mono', 'Apercu Mono', "'Apercu Mono', 'DM Mono', ui-monospace, monospace", ['label'], [[400, 'normal'], [500, 'normal']], COMMERCIAL),
];

export type Softness = 'soft' | 'softer' | 'softest';

export const SOFTNESS: Record<Softness, { label: string; radius: number; radiusSm: number }> = {
  soft: { label: 'Miękko', radius: 20, radiusSm: 14 },
  softer: { label: 'Bardzo miękko', radius: 28, radiusSm: 18 },
  softest: { label: 'Najmiękciej', radius: 36, radiusSm: 24 },
};

/** Jak wyświetlać wgrane logo – plik zostaje bez zmian, kształt i kadr nakładamy przy wyświetlaniu. */
export type LogoShape = 'auto' | 'circle' | 'rounded' | 'square' | 'free';
export type LogoBackground = 'none' | 'surface' | 'soft' | 'brand' | 'ink';
export type LogoStyle = {
  shape: LogoShape;
  /** wysokość w px na górnym pasku aplikacji klientki */
  size: number;
  background: LogoBackground;
  fit: 'contain' | 'cover';
  /** margines wewnętrzny w % rozmiaru */
  padding: number;
  /** przybliżenie 1–3 i przesunięcie kadru w % (−50…50) */
  zoom: number;
  x: number;
  y: number;
  /** nazwa studia obok logo: auto = ukryta przy poziomym logotypie */
  showName: 'auto' | 'yes' | 'no';
};

export const DEFAULT_LOGO_STYLE: LogoStyle = { shape: 'auto', size: 30, background: 'soft', fit: 'contain', padding: 12, zoom: 1, x: 0, y: 0, showName: 'auto' };

export const LOGO_LIMITS = { size: [20, 64], padding: [0, 30], zoom: [1, 3], offset: [-50, 50] } as const;

/** Przyciemnienie zdjęć zajęć pod nagłówkiem (płaskie, bez gradientu): 0.1 = prawie bez, 0.7 = mocno. */
export const PHOTO_DIM_LIMITS = [0.1, 0.7] as const;
export const DEFAULT_PHOTO_DIM = 0.36;

/** Rozmycie dolnej części zdjęcia pod nagłówkiem, zanikające ku górze (px): 0 = wyłączone. */
export const PHOTO_BLUR_LIMITS = [0, 32] as const;
export const DEFAULT_PHOTO_BLUR = 0;

export type Look = {
  palette: string;
  fonts: Record<FontRole, string>;
  softness: Softness;
  logo: LogoStyle;
  /** przyciemnienie zdjęć na kartach zajęć (alfa warstwy 0.1–0.7) */
  photoDim: number;
  /** stopniowe rozmycie pod nazwą zajęć – siła przy dolnej krawędzi (px, 0–32) */
  photoBlur: number;
};

export const DEFAULT_LOOK: Look = {
  palette: 'biel',
  fonts: { display: 'cormorant', head: 'outfit', body: 'rethink', label: 'outfit' },
  softness: 'softer',
  logo: DEFAULT_LOGO_STYLE,
  photoDim: DEFAULT_PHOTO_DIM,
  photoBlur: DEFAULT_PHOTO_BLUR,
};

export const paletteById = (id: string) => (PALETTES.find((p) => p.id === id) ?? PALETTES[0]).palette;
export const fontById = (id: string) => FONTS.find((f) => f.id === id) ?? FONTS[0];

/** Uzupełnia brakujące pola wartościami domyślnymi (stare rekordy, częściowe dane). */
export function resolveLook(raw: Partial<Look> | null | undefined): Look {
  return {
    palette: raw?.palette ?? DEFAULT_LOOK.palette,
    fonts: { ...DEFAULT_LOOK.fonts, ...(raw?.fonts ?? {}) },
    softness: raw?.softness ?? DEFAULT_LOOK.softness,
    logo: { ...DEFAULT_LOGO_STYLE, ...(raw?.logo ?? {}) },
    photoDim: raw?.photoDim ?? DEFAULT_PHOTO_DIM,
    photoBlur: raw?.photoBlur ?? DEFAULT_PHOTO_BLUR,
  };
}

export function validateLook(look: Look): string[] {
  const errors: string[] = [];
  if (!PALETTES.some((p) => p.id === look.palette)) errors.push('Nieznana paleta kolorów.');
  for (const role of ['display', 'head', 'body', 'label'] as FontRole[]) {
    const f = FONTS.find((x) => x.id === look.fonts?.[role]);
    if (!f || !f.roles.includes(role)) errors.push(`Czcionka „${look.fonts?.[role]}” nie pasuje do roli ${role}.`);
    else if (f.pending) errors.push(`Czcionka „${f.label}” ${f.pending}.`);
  }
  if (!(look.softness in SOFTNESS)) errors.push('Nieznany stopień miękkości.');
  const dim = look.photoDim;
  if (typeof dim !== 'number' || !Number.isFinite(dim) || dim < PHOTO_DIM_LIMITS[0] || dim > PHOTO_DIM_LIMITS[1]) errors.push('Przyciemnienie zdjęć poza zakresem 10–70%.');
  const blur = look.photoBlur;
  if (typeof blur !== 'number' || !Number.isFinite(blur) || blur < PHOTO_BLUR_LIMITS[0] || blur > PHOTO_BLUR_LIMITS[1]) errors.push('Rozmycie zdjęć poza zakresem 0–32 px.');
  const l = look.logo;
  const inRange = (v: number, [min, max]: readonly [number, number]) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!['auto', 'circle', 'rounded', 'square', 'free'].includes(l.shape)) errors.push('Nieznany kształt logo.');
  if (!['none', 'surface', 'soft', 'brand', 'ink'].includes(l.background)) errors.push('Nieznane tło logo.');
  if (!['contain', 'cover'].includes(l.fit)) errors.push('Nieznane dopasowanie logo.');
  if (!['auto', 'yes', 'no'].includes(l.showName)) errors.push('Nieznane ustawienie nazwy przy logo.');
  if (!inRange(l.size, LOGO_LIMITS.size)) errors.push('Rozmiar logo poza zakresem 20–64 px.');
  if (!inRange(l.padding, LOGO_LIMITS.padding)) errors.push('Margines logo poza zakresem.');
  if (!inRange(l.zoom, LOGO_LIMITS.zoom)) errors.push('Przybliżenie logo poza zakresem.');
  if (!inRange(l.x, LOGO_LIMITS.offset) || !inRange(l.y, LOGO_LIMITS.offset)) errors.push('Przesunięcie logo poza zakresem.');
  return errors;
}

/**
 * Rozstrzyga ustawienia „auto” dla konkretnego pliku logo:
 * poziomy logotyp → kształt swobodny bez nazwy; znak → koło z nazwą obok.
 */
export function resolveLogoDisplay(style: LogoStyle, wide: boolean) {
  const shape: Exclude<LogoShape, 'auto'> = style.shape === 'auto' ? (wide ? 'free' : 'circle') : style.shape;
  const showName = style.showName === 'auto' ? !(wide && shape === 'free') : style.showName === 'yes';
  return { ...style, shape, showName };
}
