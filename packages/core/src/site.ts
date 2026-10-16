// Strona internetowa studia jako jeden dokument JSON (kolejność sekcji, widoczność, teksty, zdjęcia, motyw).
// Edytor w panelu zmienia tylko ten dokument i zapisuje go jako szkic; publikacja kopiuje szkic do wersji publicznej.
// Pola każdej sekcji opisuje specyfikacja (SECTION_SPECS) – z niej korzysta parser (wartości domyślne, typy, limity)
// i panel edytora (formularz budowany automatycznie), więc nowy tekst albo zdjęcie na stronie = jeden wpis w specyfikacji.
// Kierunek: minimalizm na maksa – domyślnie mało tekstu, bez etykiet nad tytułami, zdjęcia niosą stronę.
import { FONTS, PALETTES, SOFTNESS, type FontRole, type Look, type Softness } from './look.ts';

/** Sekcje z danymi z systemu (grafik, zajęcia, trenerki…) – każda występuje dokładnie raz. */
export type SystemSectionType = 'about' | 'schedule' | 'classes' | 'trainers' | 'shop' | 'menu' | 'more';
/** Sekcje stałe: nagłówek na górze i stopka na dole – nie zmieniają miejsca. */
export type FixedSectionType = 'hero' | 'footer';
/** Sekcje własne – może ich być dowolnie wiele. */
export type CustomSectionType = 'article' | 'gallery';
export type SectionType = SystemSectionType | FixedSectionType | CustomSectionType;

/** Zdjęcie lub film = id pliku w bibliotece studia (media, rodzaj „site”); pusty tekst = brak. Rodzaj pliku – w SiteDoc.media. */
export type FieldValue = string | number | boolean | string[] | MenuItem[];
/** Pozycja menu baru: nazwa, cena (tekst – „14 zł”, „12 / 16”), krótki opis, kategoria i opcjonalne zdjęcie. */
export type MenuItem = { id: string; category: string; name: string; price: string; text: string; tag: string; image: string };
export const MENU_MAX = 60;
export type FieldSpec =
  | { key: string; label: string; kind: 'text'; default: string; max?: number; hint?: string; placeholder?: string }
  | { key: string; label: string; kind: 'textarea'; default: string; max?: number; hint?: string; placeholder?: string }
  | { key: string; label: string; kind: 'toggle'; default: boolean; hint?: string }
  | { key: string; label: string; kind: 'number'; default: number; min: number; max: number; hint?: string; suffix?: string }
  | { key: string; label: string; kind: 'choice'; default: string; options: [string, string][]; hint?: string }
  | { key: string; label: string; kind: 'image'; default: string; hint?: string }
  | { key: string; label: string; kind: 'images'; default: string[]; max: number; hint?: string }
  | { key: string; label: string; kind: 'menu'; default: MenuItem[]; max: number; hint?: string };

/** Grupa pól w panelu edytora (np. „Nagłówek sekcji”, „Przyciski”). */
export type FieldGroup = { label: string; fields: FieldSpec[] };
export type SectionSpec = { label: string; nav: string; groups: FieldGroup[] };

const text = (key: string, label: string, def: string, max = 120, extra: { hint?: string; placeholder?: string } = {}): FieldSpec => ({ key, label, kind: 'text', default: def, max, ...extra });
const area = (key: string, label: string, def: string, max = 1200, extra: { hint?: string; placeholder?: string } = {}): FieldSpec => ({ key, label, kind: 'textarea', default: def, max, ...extra });
const toggle = (key: string, label: string, def: boolean, hint?: string): FieldSpec => ({ key, label, kind: 'toggle', default: def, hint });
/** Pole „zdjęcie lub film” – film gra w pętli bez dźwięku, jak ruchome zdjęcie. */
const image = (key: string, label: string, hint?: string): FieldSpec => ({ key, label, kind: 'image', default: '', hint });

/** Nagłówek sekcji: tytuł i część w kursywie (jedyny ozdobnik); mała etykieta nad nim – opcjonalnie. */
const heading = (title: string, serif = '', eyebrow = ''): FieldGroup => ({
  label: 'Nagłówek',
  fields: [text('title', 'Tytuł', title, 60), text('serif', 'Dopisek w kursywie', serif, 60), text('eyebrow', 'Mała etykieta nad tytułem', eyebrow, 40, { hint: 'Zwykle pusta – minimalizm.' })],
});

/** Podstrona sekcji (/s/:slug/grafik…): duży tytuł z nagłówka sekcji, pod nim wstęp i opcjonalne szerokie zdjęcie. */
const pageGroup = (intro: string): FieldGroup => ({
  label: 'Podstrona',
  fields: [
    area('pageIntro', 'Wstęp na podstronie', intro, 300, { hint: 'Widać go tylko na podstronie tej zakładki. Jedno–dwa zdania.' }),
    image('pageImage', 'Zdjęcie na górze podstrony', 'Opcjonalne – szerokie, spokojne zdjęcie.'),
  ],
});

const photoPosition: FieldSpec = {
  key: 'imagePosition',
  label: 'Położenie',
  kind: 'choice',
  default: 'right',
  options: [
    ['right', 'Po prawej'],
    ['left', 'Po lewej'],
    ['top', 'Nad tekstem, na całą szerokość'],
  ],
};

export const SECTION_SPECS: Record<Exclude<SectionType, CustomSectionType>, SectionSpec> = {
  hero: {
    label: 'Nagłówek strony',
    nav: '',
    groups: [
      {
        label: 'Zdjęcie lub film',
        fields: [
          image('image', 'Zdjęcie lub film', 'Najlepiej poziome i jasne. Film gra w pętli, bez dźwięku.'),
          {
            key: 'imageLayout',
            label: 'Układ',
            kind: 'choice',
            default: 'full',
            options: [
              ['full', 'Zdjęcie na całą szerokość, tekst pod nim'],
              ['side', 'Tekst obok zdjęcia'],
              ['cover', 'Tekst na zdjęciu'],
              ['screen', 'Zdjęcie na cały ekran, napis na nim'],
            ],
          },
        ],
      },
      {
        label: 'Tekst',
        fields: [
          text('title', 'Tytuł', '', 60, { placeholder: 'Nazwa studia', hint: 'Puste = nazwa studia.' }),
          text('serif', 'Dopisek w kursywie', '', 90, { placeholder: 'Hasło studia', hint: 'Puste = hasło studia z ustawień.' }),
          area('text', 'Krótki wstęp', '', 300, { hint: 'Najlepiej jedno zdanie – albo nic.' }),
          text('eyebrow', 'Mała etykieta nad tytułem', '', 60, { placeholder: 'np. Studio ruchu · Kraków' }),
        ],
      },
      { label: 'Przyciski', fields: [text('button', 'Główny przycisk', 'Zapisz się', 40), text('button2', 'Drugi przycisk', '', 40, { placeholder: 'np. Grafik' })] },
      {
        label: 'Dodatki',
        fields: [toggle('showNews', 'Nowości w ofercie', true, 'Dyskretny dopisek z nowymi zajęciami – gdy są.'), toggle('showNext', 'Najbliższe zajęcia', false), text('nextLabel', 'Etykieta najbliższych zajęć', 'Najbliżej', 40)],
      },
    ],
  },
  about: {
    label: 'O studiu',
    nav: 'Studio',
    groups: [
      heading('Ruch, który', 'jest dla Ciebie'),
      { label: 'Zdjęcie lub film', fields: [image('image', 'Zdjęcie lub film studia'), photoPosition] },
      { label: 'Treść', fields: [area('text', 'Opis studia', '', 800, { hint: 'Puste = hasło studia. Dwa–trzy zdania wystarczą.' })] },
      {
        label: 'Elementy',
        fields: [toggle('showContact', 'Godziny recepcji i kontakt', true), text('contactLabel', 'Tytuł kontaktu', 'Recepcja', 40), toggle('showZones', 'Sale i liczba zajęć', false), toggle('showFaq', 'Pytania i odpowiedzi', false, 'Treść pytań: Ustawienia → Wsparcie.')],
      },
      {
        label: 'Galeria sal',
        fields: [
          { key: 'rooms', label: 'Zdjęcia sal', kind: 'images', default: [], max: 12, hint: 'Do 12 zdjęć lub filmów: sale, recepcja, szatnia. Pusta = bez galerii.' },
          text('roomsTitle', 'Tytuł galerii', 'Nasze', 40),
          text('roomsSerif', 'Dopisek w kursywie', 'sale', 40),
        ],
      },
      pageGroup('Miejsce, w którym zwalniasz. Zajrzyj do środka.'),
    ],
  },
  schedule: {
    label: 'Grafik',
    nav: 'Grafik',
    groups: [
      heading('Grafik', 'tygodnia'),
      { label: 'Przyciski i komunikaty', fields: [text('bookLabel', 'Przycisk przy zajęciach', 'Zapisz się', 24), text('button', 'Przycisk przy nagłówku', '', 40, { placeholder: 'np. Pełny grafik' }), text('emptyText', 'Gdy dzień jest pusty', 'Tego dnia odpoczywamy.', 160)] },
      { label: 'Elementy', fields: [toggle('showSpots', 'Wolne miejsca', true), toggle('showPast', 'Zajęcia, które już minęły', false)] },
      pageGroup('Wybierz dzień i zapisz się – miejsce czeka w aplikacji.'),
    ],
  },
  classes: {
    label: 'Zajęcia',
    nav: 'Zajęcia',
    groups: [
      heading('Zajęcia'),
      { label: 'Elementy', fields: [toggle('showPhotos', 'Zdjęcia zajęć', true, 'Zdjęcia ustawisz niżej – albo wgrane w „Grafik i sale”.'), toggle('showDescription', 'Opisy', true), toggle('showFilter', 'Filtr sal', false), toggle('showTrainers', 'Kto prowadzi', false)] },
      {
        label: 'Nowości',
        fields: [
          toggle('newsEnabled', 'Oznaczaj nowe zajęcia', true, 'Zajęcia dodane do oferty pojawiają się na stronie z etykietą i na początku listy.'),
          text('newsLabel', 'Etykieta', 'Nowość', 20),
          { key: 'newsDays', label: 'Jak długo to nowość', kind: 'number', default: 30, min: 7, max: 120, suffix: 'dni' },
        ],
      },
      pageGroup('Każde zajęcia w jednym miejscu. Znajdź swój rytm.'),
    ],
  },
  trainers: {
    label: 'Trenerki',
    nav: 'Trenerki',
    groups: [heading('Trenerki'), { label: 'Elementy', fields: [toggle('showClasses', 'Zajęcia trenerki', false), toggle('showBio', 'Opis trenerki', false)] }, pageGroup('Poznaj kobiety, które poprowadzą Cię na macie.')],
  },
  shop: {
    label: 'Sklep',
    nav: 'Sklep',
    groups: [
      heading('Sklep', 'studia'),
      { label: 'Przycisk', fields: [text('buyLabel', 'Przycisk przy produkcie', 'Kup teraz', 24)] },
      // Opisy produktów są na podstronie sklepu – na stronie głównej tylko zdjęcie, nazwa i cena.
      { label: 'Elementy', fields: [toggle('showSoldOut', 'Wyprzedane produkty', false)] },
    ],
  },
  menu: {
    label: 'Menu baru',
    nav: 'Menu',
    groups: [
      heading('Menu', 'po treningu'),
      { label: 'Pozycje', fields: [{ key: 'items', label: 'Pozycje menu', kind: 'menu', default: [], max: MENU_MAX, hint: 'Pusta lista = zakładki nie ma na stronie.' }] },
      {
        label: 'Treść',
        fields: [area('text', 'Krótki wstęp', '', 300, { hint: 'Np. „Smoothie, matcha i coś słodkiego – po zajęciach przy barze.”' }), text('note', 'Dopisek pod menu', '', 160, { placeholder: 'np. Mleko roślinne bez dopłaty' })],
      },
      { label: 'Zdjęcie lub film', fields: [image('image', 'Zdjęcie baru', 'Pokazuje się obok menu.')] },
      { label: 'Elementy', fields: [toggle('showPhotos', 'Zdjęcia pozycji', true), toggle('showTabs', 'Zakładki kategorii', true, 'Przy dwóch i więcej kategoriach.')] },
      pageGroup(''),
    ],
  },
  more: {
    label: 'Więcej',
    nav: '',
    groups: [
      heading('Więcej'),
      { label: 'Wydarzenia', fields: [toggle('eventsVisible', 'Pokazuj', true), text('eventsTitle', 'Tytuł', 'Wydarzenia', 40), text('eventsText', 'Opis', 'Warsztaty i wieczory w studiu.', 140)] },
      { label: 'Kursy online', fields: [toggle('coursesVisible', 'Pokazuj', true), text('coursesTitle', 'Tytuł', 'Kursy online', 40), text('coursesText', 'Opis', 'Trenuj z nami w domu.', 140)] },
      { label: 'Sklep', fields: [toggle('shopVisible', 'Pokazuj', true), text('shopTitle', 'Tytuł', 'Sklep', 40), text('shopText', 'Opis', 'Bar po treningu, akcesoria z logo i stroje.', 140)] },
      { label: 'Etykieta', fields: [text('soonLabel', 'Gdy podstrona jeszcze nie działa', 'wkrótce', 20)] },
    ],
  },
  footer: {
    label: 'Stopka',
    nav: '',
    groups: [
      { label: 'Zdjęcie lub film', fields: [image('image', 'Kadr nad stopką', 'Opcjonalny – szerokie zdjęcie albo film na pożegnanie.')] },
      { label: 'Zaproszenie', fields: [text('title', 'Tytuł', 'Do zobaczenia', 60), text('serif', 'Dopisek w kursywie', 'na macie', 60), area('text', 'Tekst', '', 300, { hint: '{kod} zamienia się w kod studia, np. „Dołącz kodem {kod}”.' }), text('button', 'Przycisk', 'Otwórz aplikację', 40)] },
      { label: 'Dół strony', fields: [toggle('showAddress', 'Adres w stopce', true), toggle('showGlam', 'Dopisek „działa na glam”', false)] },
    ],
  },
};

/** Sekcja z tekstem (np. „Pierwsza wizyta”, „Cennik”), opcjonalnie ze zdjęciem. */
export const ARTICLE_SPEC: SectionSpec = {
  label: 'Sekcja z tekstem',
  nav: '',
  groups: [
    heading('Nowa sekcja'),
    { label: 'Treść', fields: [area('text', 'Tekst', 'Kilka zdań. Pusta linia zaczyna nowy akapit.', 4000)] },
    { label: 'Zdjęcie lub film', fields: [image('image', 'Zdjęcie lub film'), photoPosition] },
    {
      label: 'Układ',
      fields: [
        { key: 'layout', label: 'Wygląd', kind: 'choice', default: 'plain', options: [['plain', 'Na tle strony'], ['card', 'Na miękkiej płaszczyźnie'], ['center', 'Wyśrodkowany']] },
        text('button', 'Przycisk (opcjonalnie)', '', 40),
        text('link', 'Adres przycisku', '/app', 200, { hint: 'Np. /app, #grafik albo pełny adres https://…' }),
      ],
    },
  ],
};

export const GALLERY_MAX = 12;
export const GALLERY_SPEC: SectionSpec = {
  label: 'Galeria',
  nav: '',
  groups: [
    { label: 'Zdjęcia i filmy', fields: [{ key: 'images', label: 'Zdjęcia i filmy', kind: 'images', default: [], max: GALLERY_MAX, hint: `Do ${GALLERY_MAX} plików. Przeciągnij, żeby zmienić kolejność.` }] },
    {
      label: 'Układ',
      fields: [
        {
          key: 'layout',
          label: 'Wygląd',
          kind: 'choice',
          default: 'grid',
          options: [
            ['grid', 'Siatka'],
            ['row', 'Pasek do przewijania'],
            ['mosaic', 'Mozaika'],
          ],
        },
      ],
    },
    heading(''),
  ],
};

export const specOf = (type: SectionType): SectionSpec => (type === 'article' ? ARTICLE_SPEC : type === 'gallery' ? GALLERY_SPEC : SECTION_SPECS[type]);

export type SiteSection = {
  /** identyfikator sekcji na stronie (id elementu) – typ dla systemowych, `a-…` dla tekstu, `g-…` dla galerii */
  key: string;
  type: SystemSectionType | CustomSectionType;
  visible: boolean;
  /** etykieta w menu strony; pusta = sekcja nie trafia do menu */
  nav: string;
  values: Record<string, FieldValue>;
};
export type FixedSection = { visible: boolean; values: Record<string, FieldValue> };

export type SiteTheme = { palette: string | null; softness: Softness | null; fonts: Partial<Record<Exclude<FontRole, 'label'>, string>> };

export type SiteDoc = {
  version: 1;
  hero: FixedSection;
  sections: SiteSection[];
  footer: FixedSection;
  nav: { button: string; showLinks: boolean };
  seo: { title: string; description: string };
  /** nadpisania wyglądu studia tylko na stronie; null / brak = jak w aplikacji */
  theme: SiteTheme;
  /** zdjęcia zajęć i trenerek tylko na stronie (id zajęć / trenerki → zdjęcie); brak = zdjęcie z panelu */
  photos: { classes: Record<string, string>; trainers: Record<string, string> };
  /** które pliki są filmami (reszta to zdjęcia); przy zapisie serwer ustala to z biblioteki studia */
  media: Record<string, 'video'>;
};

export const SYSTEM_SECTIONS: SystemSectionType[] = ['about', 'schedule', 'classes', 'trainers', 'shop', 'menu', 'more'];
const CUSTOM_PREFIX: Record<CustomSectionType, string> = { article: 'a', gallery: 'g' };
export const MAX_SECTIONS = 30;

/** Adresy podstron sekcji systemowych: /s/:slug/grafik itd. Sklep ma własną podstronę z katalogiem (ShopSite). */
const SYSTEM_PATHS: Record<SystemSectionType, string> = { about: 'studio', schedule: 'grafik', classes: 'zajecia', trainers: 'trenerki', shop: 'sklep', menu: 'menu', more: 'wiecej' };
/** Adresy zajęte przez inne strony studia – sekcja z własnym tekstem nie może ich przejąć. */
const RESERVED_PATHS = new Set([...Object.values(SYSTEM_PATHS), 'kurs']);

/** „Zajęcia dla Ciebie” → „zajecia-dla-ciebie” (adres podstrony z etykiety w menu). */
export function pathSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export type SitePage = { key: string; type: SystemSectionType | CustomSectionType; label: string; path: string };

/**
 * Zakładki menu strony studia: widoczne sekcje z etykietą w menu, każda z własnym adresem podstrony.
 * Sklep tylko wtedy, gdy studio ma moduł sklepu i produkty (inaczej podstrona byłaby pusta).
 */
export function sitePages(doc: SiteDoc, opts: { shop: boolean }): SitePage[] {
  const used = new Set<string>();
  const pages: SitePage[] = [];
  for (const s of doc.sections) {
    const label = s.nav.trim();
    if (!s.visible || !label || (s.type === 'shop' && !opts.shop) || (s.type === 'menu' && menuItems(s.values).length === 0)) continue;
    let path = s.type === 'article' || s.type === 'gallery' ? pathSlug(label) : SYSTEM_PATHS[s.type];
    // Własna sekcja o nazwie jak systemowa („Grafik”) albo dwie o tej samej nazwie – dopisujemy klucz sekcji.
    if (!path || used.has(path) || (RESERVED_PATHS.has(path) && path !== SYSTEM_PATHS[s.type as SystemSectionType])) path = `${path || 'strona'}-${s.key}`;
    used.add(path);
    pages.push({ key: s.key, type: s.type, label, path });
  }
  return pages;
}

const MAX_PHOTOS = 200;

/** Id pliku w bibliotece studia (UUID). Wszystko inne – np. adres z zewnątrz – odpada. */
export const isMediaId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
/** Publiczny adres zdjęcia strony. */
export const siteImageUrl = (mediaId: string) => `/api/public-media/${mediaId}`;

function defaults(spec: SectionSpec): Record<string, FieldValue> {
  return Object.fromEntries(spec.groups.flatMap((g) => g.fields.map((f) => [f.key, Array.isArray(f.default) ? ([...f.default] as FieldValue) : f.default])));
}

/** Wartości pól z dowolnego wejścia: zły typ → domyślna, tekst przycięty, liczba w granicach, zdjęcie tylko z biblioteki. */
export function parseValues(spec: SectionSpec, raw: unknown): Record<string, FieldValue> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, FieldValue> = {};
  for (const f of spec.groups.flatMap((g) => g.fields)) {
    const v = src[f.key];
    if (f.kind === 'toggle') out[f.key] = typeof v === 'boolean' ? v : f.default;
    else if (f.kind === 'number') out[f.key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(f.max, Math.max(f.min, Math.round(v))) : f.default;
    else if (f.kind === 'choice') out[f.key] = typeof v === 'string' && f.options.some(([k]) => k === v) ? v : f.default;
    else if (f.kind === 'image') out[f.key] = isMediaId(v) ? v : '';
    else if (f.kind === 'images') out[f.key] = Array.isArray(v) ? [...new Set(v.filter(isMediaId))].slice(0, f.max) : [];
    else if (f.kind === 'menu') out[f.key] = parseMenu(v, f.max);
    else out[f.key] = typeof v === 'string' ? v.slice(0, f.max ?? 200) : f.default;
  }
  return out;
}

/**
 * Pozycje menu z dowolnego wejścia. Pusta nazwa zostaje (pozycja w trakcie wpisywania w edytorze),
 * na stronie pokazujemy tylko pozycje z nazwą – zob. menuItems.
 */
function parseMenu(raw: unknown, max: number): MenuItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MenuItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || out.length >= max) continue;
    const o = r as Record<string, unknown>;
    let id = typeof o.id === 'string' && /^[a-z0-9]{1,12}$/.test(o.id) ? o.id : Math.random().toString(36).slice(2, 10);
    while (seen.has(id)) id = Math.random().toString(36).slice(2, 10);
    seen.add(id);
    out.push({ id, category: str(o.category, 40), name: str(o.name, 60), price: str(o.price, 20), text: str(o.text, 200), tag: str(o.tag, 24), image: isMediaId(o.image) ? o.image : '' });
  }
  return out;
}

/** Pozycje menu do pokazania na stronie (z nazwą). */
export function menuItems(values: Record<string, FieldValue>): MenuItem[] {
  const v = values.items;
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is MenuItem => !!x && typeof x === 'object' && !!(x as MenuItem).name?.trim()) : [];
}

export function newSection(type: SystemSectionType | CustomSectionType, key?: string): SiteSection {
  const spec = specOf(type);
  const custom = type === 'article' || type === 'gallery';
  return { key: key ?? (custom ? `${CUSTOM_PREFIX[type]}-${Math.random().toString(36).slice(2, 8)}` : type), type, visible: true, nav: spec.nav, values: defaults(spec) };
}

export function defaultSiteDoc(): SiteDoc {
  const [about, ...rest] = SYSTEM_SECTIONS.map((t) => newSection(t));
  return {
    version: 1,
    hero: { visible: true, values: defaults(SECTION_SPECS.hero) },
    // Galeria od razu za „O studiu” – pusta nie pokazuje się na stronie, w edytorze czeka na zdjęcia.
    sections: [about, newSection('gallery', 'g-studio'), ...rest],
    footer: { visible: true, values: defaults(SECTION_SPECS.footer) },
    nav: { button: 'Zapisz się', showLinks: true },
    seo: { title: '', description: '' },
    theme: { palette: null, softness: null, fonts: {} },
    photos: { classes: {}, trainers: {} },
    media: {},
  };
}

const str = (v: unknown, max: number, def = '') => (typeof v === 'string' ? v.slice(0, max) : def);

function photoMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([k, v]) => /^[\w-]{1,64}$/.test(k) && isMediaId(v))
      .slice(0, MAX_PHOTOS),
  ) as Record<string, string>;
}

/**
 * Każdy dokument (z bazy, z edytora) przechodzi tędy – przy odczycie i przy zapisie.
 * Stary lub uszkodzony JSON nie wywraca strony: brakujące pola dostają wartości domyślne,
 * nieznane sekcje i pola znikają, każda sekcja systemowa jest dokładnie raz.
 */
export function parseSiteDoc(raw: unknown): SiteDoc {
  const base = defaultSiteDoc();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, any>;

  const fixed = (type: FixedSectionType, v: any): FixedSection => ({
    visible: typeof v?.visible === 'boolean' ? v.visible : true,
    values: parseValues(SECTION_SPECS[type], v?.values),
  });

  const seen = new Set<string>();
  const sections: SiteSection[] = [];
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    if (!s || typeof s !== 'object' || sections.length >= MAX_SECTIONS) continue;
    const type = s.type as SiteSection['type'];
    const isSystem = (SYSTEM_SECTIONS as string[]).includes(type);
    if (!isSystem && type !== 'article' && type !== 'gallery') continue;
    const prefix = isSystem ? '' : CUSTOM_PREFIX[type as CustomSectionType];
    const key = isSystem ? type : typeof s.key === 'string' && new RegExp(`^${prefix}-[a-z0-9-]{1,24}$`).test(s.key) ? s.key : newSection(type).key;
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push({ key, type, visible: typeof s.visible === 'boolean' ? s.visible : true, nav: str(s.nav, 30, specOf(type).nav), values: parseValues(specOf(type), s.values) });
  }
  // Brakujące sekcje systemowe wracają na swoje domyślne miejsce (po poprzedniczce z listy domyślnej).
  SYSTEM_SECTIONS.forEach((t, i) => {
    if (seen.has(t)) return;
    const prev = SYSTEM_SECTIONS.slice(0, i).reverse().find((p) => seen.has(p));
    const at = prev ? sections.findIndex((s) => s.key === prev) + 1 : 0;
    sections.splice(at, 0, newSection(t));
    seen.add(t);
  });

  const t = r.theme ?? {};
  const fonts: SiteTheme['fonts'] = {};
  for (const role of ['display', 'head', 'body'] as const) {
    const id = t.fonts?.[role];
    const f = FONTS.find((x) => x.id === id);
    if (f && f.roles.includes(role) && !f.pending) fonts[role] = f.id;
  }

  return {
    version: 1,
    hero: fixed('hero', r.hero),
    sections,
    footer: fixed('footer', r.footer),
    nav: { button: str(r.nav?.button, 24, base.nav.button) || base.nav.button, showLinks: typeof r.nav?.showLinks === 'boolean' ? r.nav.showLinks : true },
    seo: { title: str(r.seo?.title, 70), description: str(r.seo?.description, 170) },
    theme: {
      palette: PALETTES.some((p) => p.id === t.palette) ? t.palette : null,
      softness: typeof t.softness === 'string' && t.softness in SOFTNESS ? (t.softness as Softness) : null,
      fonts,
    },
    photos: { classes: photoMap(r.photos?.classes), trainers: photoMap(r.photos?.trainers) },
    media: Object.fromEntries(
      Object.entries(r.media && typeof r.media === 'object' ? r.media : {})
        .filter(([k, v]) => isMediaId(k) && v === 'video')
        .slice(0, MAX_PHOTOS),
    ) as Record<string, 'video'>,
  };
}

/** Wszystkie zdjęcia użyte w dokumencie – serwer sprawdza, czy należą do studia. */
export function siteMediaIds(doc: SiteDoc): string[] {
  const ids = new Set<string>();
  const add = (v: FieldValue | undefined) => {
    if (typeof v === 'string' && isMediaId(v)) ids.add(v);
    if (Array.isArray(v)) for (const x of v) typeof x === 'string' ? ids.add(x) : x.image && ids.add(x.image);
  };
  for (const v of [...Object.values(doc.hero.values), ...Object.values(doc.footer.values), ...doc.sections.flatMap((s) => Object.values(s.values))]) add(v);
  for (const v of [...Object.values(doc.photos.classes), ...Object.values(doc.photos.trainers)]) add(v);
  return [...ids];
}

/** Wygląd strony = wygląd studia z nadpisaniami ze strony (tylko z białej listy palet i czcionek). */
export function siteLook(studioLook: Look, theme: SiteTheme): Look {
  return {
    ...studioLook,
    palette: theme.palette ?? studioLook.palette,
    softness: theme.softness ?? studioLook.softness,
    fonts: { ...studioLook.fonts, ...theme.fonts },
  };
}

const DAY_MS = 86_400_000;

/**
 * Czy zajęcia są „nowością” w ofercie studia.
 * Zajęcia z konfiguracji startowej (dodane w pierwszej dobie studia) nigdy nie są nowością – inaczej świeżo
 * założone studio miałoby całą ofertę oznaczoną jako nowa. Później: nowość przez `days` dni od dodania.
 */
export function isNewClass(createdAt: string | null, studioCreatedAt: string, days: number, now = new Date()): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  if (created < Date.parse(studioCreatedAt) + DAY_MS) return false;
  const age = now.getTime() - created;
  return age >= 0 && age < days * DAY_MS;
}
