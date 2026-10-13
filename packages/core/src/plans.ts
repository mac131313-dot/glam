// Paywall pakietu zajęć: te same produkty, trzy sposoby zapłaty.
// Rok i tydzień to subskrypcja (autoRenew). Jednorazowo – jedna płatność, bez odnowienia.
// Oszczędność liczymy wobec planu tygodniowego, nie wobec cennika wejść.
import { formatPLN } from './copy.ts';
import type { Billing } from './products.ts';

export type PackageProduct = {
  id: string;
  name: string;
  priceGrosze: number;
  validityDays: number;
  billing?: Billing | null;
  lines: string[];
};

export type PackagePlan = {
  productId: string;
  billing: Billing;
  title: string;
  /** Prawa kolumna: przeliczenie na tydzień albo cena jednorazowa. */
  priceMain: string;
  /** Druga linia ceny, np. „tylko 1599 zł / rok”. */
  priceSub: string | null;
  /** Pod tytułem – tylko przy zakupie jednorazowym, żeby było widać, co dokładnie kupujesz. */
  caption: string | null;
  /** Zaokrąglony procent wobec stawki tygodniowej. Brak, gdy nie ma z czego liczyć. */
  savePct: number | null;
  autoRenew: boolean;
};

const ORDER: Billing[] = ['year', 'week', 'once'];

const TITLES: Record<Billing, string> = {
  year: 'Rocznie',
  week: 'Tygodniowo',
  once: 'Jednorazowo',
};

/** Cena okresu przeliczona na tydzień (grosze). Rok: cena × 7 / 365. */
export function perWeekGrosze(priceGrosze: number, validityDays: number): number {
  return Math.round((priceGrosze * 7) / Math.max(1, validityDays));
}

/**
 * Karty paywallu w kolejności: rok, tydzień, jednorazowo.
 * Produkty bez `billing` zostają poza paywallem (inne karnety studia).
 */
export function classPackagePlans(products: PackageProduct[]): PackagePlan[] {
  const tagged = products.filter((p): p is PackageProduct & { billing: Billing } => p.billing === 'year' || p.billing === 'week' || p.billing === 'once');
  const week = tagged.find((p) => p.billing === 'week');
  const weekRate = week ? perWeekGrosze(week.priceGrosze, week.validityDays) : null;

  const plans: PackagePlan[] = [];
  for (const billing of ORDER) {
    const p = tagged.find((x) => x.billing === billing);
    if (!p) continue;
    if (billing === 'once') {
      plans.push({
        productId: p.id,
        billing,
        title: TITLES[billing],
        priceMain: formatPLN(p.priceGrosze),
        priceSub: null,
        caption: p.lines[0] ?? 'Bez odnowienia',
        savePct: null,
        autoRenew: false,
      });
      continue;
    }
    const per = perWeekGrosze(p.priceGrosze, p.validityDays);
    const save = billing === 'year' && weekRate && per < weekRate ? Math.round((1 - per / weekRate) * 100) : null;
    plans.push({
      productId: p.id,
      billing,
      title: TITLES[billing],
      priceMain: `${formatPLN(per)} / tydzień`,
      priceSub: billing === 'year' ? `tylko ${formatPLN(p.priceGrosze)} / rok` : null,
      caption: null,
      savePct: save && save > 0 ? save : null,
      autoRenew: true,
    });
  }
  return plans;
}
