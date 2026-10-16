// Sklep studia (4.8.1): oferta w kategoriach (menu baru po treningu, akcesoria z logo, stroje), warianty ze stanem,
// miara rozmiaru dobrana do produktu (ubrania, skarpetki, waga hantli, pojemność) i opcjonalne makro napojów.
import { addDays } from './time.ts';

export const SHOP_CATEGORIES = [
  { id: 'drink', label: 'Napoje', one: 'Napój' },
  { id: 'accessory', label: 'Akcesoria', one: 'Akcesorium' },
  { id: 'apparel', label: 'Stroje', one: 'Strój' },
  { id: 'other', label: 'Inne', one: 'Inne' },
] as const;
export type ShopCategory = (typeof SHOP_CATEGORIES)[number]['id'];
export const isShopCategory = (x: unknown): x is ShopCategory => SHOP_CATEGORIES.some((c) => c.id === x);
export const categoryLabel = (c: string) => SHOP_CATEGORIES.find((x) => x.id === c)?.label ?? 'Inne';

/**
 * Miara wariantu. `name` to podpis nad wyborem w sklepie („Rozmiar skarpetek”), `options` – podpowiedzi w panelu
 * i kolejność wyświetlania. Wartość wariantu zawsze jest tekstem, więc studio może wpisać własną (np. „36–40”).
 */
export const SIZE_SCALES = {
  none: { label: 'Bez rozmiaru', name: null, options: [] },
  clothing: { label: 'Ubrania', name: 'Rozmiar', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  socks: { label: 'Skarpetki', name: 'Rozmiar skarpetek', options: ['35–38', '39–42', '43–46'] },
  weight: { label: 'Waga (np. hantle)', name: 'Waga', options: ['0,5 kg', '1 kg', '1,5 kg', '2 kg', '3 kg'] },
  volume: { label: 'Pojemność', name: 'Pojemność', options: ['250 ml', '330 ml', '400 ml', '500 ml'] },
  custom: { label: 'Własne warianty', name: 'Wariant', options: [] },
} as const satisfies Record<string, { label: string; name: string | null; options: readonly string[] }>;
export type SizeScale = keyof typeof SIZE_SCALES;
export const isSizeScale = (x: unknown): x is SizeScale => typeof x === 'string' && x in SIZE_SCALES;

export const DEFAULT_SCALE: Record<ShopCategory, SizeScale> = { drink: 'none', accessory: 'none', apparel: 'clothing', other: 'none' };

// ——— Warianty i stan ———

/** `stock: null` – bez limitu (napój robiony na miejscu). `priceGrosze` – cena wariantu, gdy inna niż produktu (np. hantle 2 kg). */
export type Variant = { id: string; size?: string | null; color?: string | null; stock: number | null; priceGrosze?: number | null };

export function variantLabel(v: Pick<Variant, 'size' | 'color'>): string {
  return [v.size, v.color].filter(Boolean).join(' · ') || 'standard';
}

export const variantPrice = (v: Pick<Variant, 'priceGrosze'>, productGrosze: number) => v.priceGrosze ?? productGrosze;

export function takeStock(variants: Variant[], variantId: string, qty: number): Variant[] {
  const v = variants.find((x) => x.id === variantId);
  if (!v) throw new Error('Nie ma takiego wariantu.');
  if (v.stock === null) return variants;
  if (v.stock < qty) throw new Error(v.stock === 0 ? 'Ten wariant jest wyprzedany.' : `Zostało tylko ${v.stock} szt.`);
  return variants.map((x) => (x.id === variantId ? { ...x, stock: x.stock! - qty } : x));
}

export function returnStock(variants: Variant[], variantId: string, qty: number): Variant[] {
  return variants.map((x) => (x.id === variantId && x.stock !== null ? { ...x, stock: x.stock + qty } : x));
}

/** Suma policzalnych sztuk (warianty bez limitu się nie liczą). */
export const totalStock = (variants: Variant[]) => variants.reduce((n, v) => n + (v.stock ?? 0), 0);
export const hasStock = (variants: Variant[]) => variants.some((v) => v.stock === null || v.stock > 0);

/** Warianty w kolejności miary (XS → XXL, 35–38 → 43–46); własne wartości na końcu, w kolejności dodania. */
export function sortVariants<V extends Pick<Variant, 'size'>>(scale: SizeScale, variants: V[]): V[] {
  const order: readonly string[] = SIZE_SCALES[scale].options;
  const rank = (v: V) => {
    const i = order.indexOf(v.size ?? '');
    return i === -1 ? order.length : i;
  };
  return variants.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i).map((x) => x.v);
}

/** Najniższa i najwyższa cena wśród wariantów – do „od 49 zł” na karcie. */
export function priceRange(productGrosze: number, variants: Variant[]): { min: number; max: number } {
  const prices = variants.length ? variants.map((v) => variantPrice(v, productGrosze)) : [productGrosze];
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * Podpis przy wariancie w sklepie: ile sztuk zostało. `null` – nic nie piszemy.
 * Decyzja „sprzedażowa” jak `spotsLabel` na stronie studia.
 */
export function stockHint(stock: number | null): string | null {
  if (stock === null) return null;
  if (stock === 0) return 'brak';
  if (stock <= 3) return stock === 1 ? 'ostatnia sztuka' : `ostatnie ${stock} szt.`;
  return null;
}

/** Rezerwacja do odbioru (S3): sztuka blokowana na X dni, potem wraca na stan. Napoje – do końca dnia. */
export function reservationExpiry(localToday: string, days: number): string {
  return addDays(localToday, days);
}

// ——— Makro napojów (wszystko opcjonalne: czego studio nie wpisze, tego nie pokazujemy) ———

export const NUTRIENTS = [
  { key: 'kcal', label: 'Energia', unit: 'kcal' },
  { key: 'protein', label: 'Białko', unit: 'g' },
  { key: 'carbs', label: 'Węglowodany', unit: 'g' },
  { key: 'sugar', label: 'w tym cukry', unit: 'g', sub: true },
  { key: 'fat', label: 'Tłuszcz', unit: 'g' },
  { key: 'fiber', label: 'Błonnik', unit: 'g' },
  { key: 'caffeine', label: 'Kofeina', unit: 'mg' },
] as const;
export type NutrientKey = (typeof NUTRIENTS)[number]['key'];
export type Nutrition = Partial<Record<NutrientKey, number>> & { serving?: string };

/** Z formularza: zostają tylko liczby ≥ 0 (z przecinkiem też), porcja jako krótki tekst. Pusto → null. */
export function cleanNutrition(input: unknown): Nutrition | null {
  if (!input || typeof input !== 'object') return null;
  const src = input as Record<string, unknown>;
  const out: Nutrition = {};
  for (const n of NUTRIENTS) {
    const raw = src[n.key];
    if (raw === null || raw === undefined || raw === '') continue;
    const x = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (Number.isFinite(x) && x >= 0 && x <= 10_000) out[n.key] = Math.round(x * 10) / 10;
  }
  const serving = typeof src.serving === 'string' ? src.serving.trim().slice(0, 30) : '';
  if (serving) out.serving = serving;
  return Object.keys(out).length ? out : null;
}

const amount = (x: number) => x.toLocaleString('pl-PL', { maximumFractionDigits: 1 });

/** Wiersze tabelki wartości odżywczych – wyłącznie te, które studio uzupełniło. */
export function nutritionRows(n: Nutrition | null | undefined): { key: NutrientKey; label: string; value: string; sub: boolean }[] {
  if (!n) return [];
  return NUTRIENTS.filter((x) => n[x.key] !== undefined).map((x) => ({ key: x.key, label: x.label, value: `${amount(n[x.key]!)} ${x.unit}`, sub: 'sub' in x && x.sub }));
}

/** Jedna linijka na kartę w katalogu: białko, a gdy go nie ma – kalorie. */
export function nutritionHighlight(n: Nutrition | null | undefined): string | null {
  if (n?.protein !== undefined) return `${amount(n.protein)} g białka`;
  if (n?.kcal !== undefined) return `${amount(n.kcal)} kcal`;
  return null;
}

// ——— Komplety i propozycje na stronie produktu ———

/** Nazwa kompletu wpisana w panelu („Komplet Isola”) – produkty z tą samą nazwą tworzą zestaw. Pusto → null. */
export function cleanSetName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.replace(/\s+/g, ' ').trim().slice(0, 40);
  return s || null;
}

const sameSet = (a: string | null, b: string | null) => !!a && !!b && a.toLocaleLowerCase('pl') === b.toLocaleLowerCase('pl');

type Suggestable = { id: string; category: string; set: string | null; featured: boolean; status: string };

/**
 * Jak bardzo `other` pasuje jako propozycja do oglądanego produktu (większe = wyżej). Wyprzedane nigdy nie trafiają
 * na listę. Najpierw to, co uzupełnia zakup (inna kategoria – do legginsów bidon, nie kolejne legginsy), potem polecane.
 */
export function suggestionScore(current: Suggestable, other: Suggestable): number {
  let score = 0;
  if (other.category !== current.category) score += 2;
  if (other.featured) score += 1;
  // napój do stroju to słaba para – menu baru zostaje w swojej kategorii
  if ((current.category === 'drink') !== (other.category === 'drink')) score -= 3;
  return score;
}

/**
 * Propozycje na stronie produktu: `set` – pozostałe części kompletu (w kolejności katalogu), `more` – do `limit`
 * innych produktów, które warto dobrać. Wyprzedane pomijamy, bo nie da się ich kupić razem.
 */
export function shopSuggestions<P extends Suggestable>(current: P, all: P[], limit = 4): { set: P[]; more: P[] } {
  const others = all.filter((p) => p.id !== current.id && p.status === 'available');
  const set = others.filter((p) => sameSet(p.set, current.set));
  const more = others
    .filter((p) => !set.includes(p))
    .map((p, i) => ({ p, i, s: suggestionScore(current, p) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
  return { set, more };
}
