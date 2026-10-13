// Pieniądze i karnety poza samym dostępem (4.2, 4.8): kody rabatowe, zawieszenie karnetu,
// faktury (kwoty netto/VAT), sklep (stany i rezerwacje), polecenia (decyzja 8).
import { addDays } from './time.ts';
import { plural } from './copy.ts';

// ——— Kody rabatowe i kupony ———

export type Coupon = {
  code: string;
  kind: 'percent' | 'amount';
  value: number;
  appliesTo: 'all' | 'pass' | 'course' | 'event' | 'shop' | 'guest_pass';
  productIds?: string[] | null;
  maxUses?: number | null;
  perUser: number;
  onlyUserId?: string | null;
  returningOnly?: boolean;
  firstPurchaseOnly?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  active: boolean;
};

export type CouponContext = {
  kind: Exclude<Coupon['appliesTo'], 'all'>;
  productId?: string;
  amountGrosze: number;
  userId: string;
  usedTotal: number;
  usedByUser: number;
  isReturning: boolean;
  hasPurchased: boolean;
  today: string;
};

export type CouponResult = { ok: true; discountGrosze: number; finalGrosze: number } | { ok: false; reason: string };

export function applyCoupon(c: Coupon, ctx: CouponContext): CouponResult {
  const no = (reason: string): CouponResult => ({ ok: false, reason });
  if (!c.active) return no('Ten kod nie jest już aktywny.');
  if (c.validFrom && ctx.today < c.validFrom) return no('Ten kod zacznie działać później.');
  if (c.validTo && ctx.today > c.validTo) return no('Ten kod już wygasł.');
  if (c.appliesTo !== 'all' && c.appliesTo !== ctx.kind) return no('Ten kod nie dotyczy tego zakupu.');
  if (c.productIds?.length && (!ctx.productId || !c.productIds.includes(ctx.productId))) return no('Ten kod nie dotyczy tego produktu.');
  if (c.onlyUserId && c.onlyUserId !== ctx.userId) return no('Ten kod jest przypisany do innej osoby.');
  if (c.maxUses != null && ctx.usedTotal >= c.maxUses) return no('Ten kod został już wykorzystany.');
  if (ctx.usedByUser >= c.perUser) return no('Ten kod już wykorzystałaś.');
  if (c.returningOnly && !ctx.isReturning) return no('Ten kod jest dla osób wracających po przerwie.');
  if (c.firstPurchaseOnly && ctx.hasPurchased) return no('Ten kod działa przy pierwszym zakupie.');
  const raw = c.kind === 'percent' ? Math.round((ctx.amountGrosze * Math.min(c.value, 100)) / 100) : c.value;
  const discountGrosze = Math.min(raw, ctx.amountGrosze);
  return { ok: true, discountGrosze, finalGrosze: ctx.amountGrosze - discountGrosze };
}

export function couponLabel(c: Pick<Coupon, 'kind' | 'value'>): string {
  return c.kind === 'percent' ? `-${c.value}%` : `-${(c.value / 100).toLocaleString('pl-PL')} zł`;
}

// ——— Zawieszenie karnetu (#11) ———

export type FreezeLimits = { maxTimes: number; maxDays: number };
export type FreezeRequest = { from: string; to: string };
export type FreezeState = { timesUsed: number; daysUsed: number; validUntil: string; status: string };

export function freezeDays(req: FreezeRequest): number {
  return Math.round((Date.parse(`${req.to}T00:00:00Z`) - Date.parse(`${req.from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Sprawdza wniosek o zawieszenie i zwraca nową datę ważności (przesuniętą o liczbę dni). */
export function planFreeze(limits: FreezeLimits, state: FreezeState, req: FreezeRequest, today: string): { ok: true; days: number; validUntil: string } | { ok: false; reason: string } {
  if (state.status !== 'active') return { ok: false, reason: 'Zawiesić można tylko aktywny karnet.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.from) || !/^\d{4}-\d{2}-\d{2}$/.test(req.to) || req.to < req.from) return { ok: false, reason: 'Podaj poprawny zakres dat.' };
  if (req.from < today) return { ok: false, reason: 'Zawieszenie może zacząć się najwcześniej dziś.' };
  if (limits.maxTimes <= 0) return { ok: false, reason: 'Tego karnetu nie można zawiesić. Zapytaj w recepcji.' };
  if (state.timesUsed >= limits.maxTimes) return { ok: false, reason: `Ten karnet można zawiesić najwyżej ${limits.maxTimes} ${plural(limits.maxTimes, 'raz', 'razy', 'razy')}.` };
  const days = freezeDays(req);
  if (state.daysUsed + days > limits.maxDays) return { ok: false, reason: `Zostało Ci ${Math.max(0, limits.maxDays - state.daysUsed)} dni zawieszenia na tym karnecie.` };
  if (`${req.from}T00:00:00Z` > state.validUntil) return { ok: false, reason: 'Karnet wygasa przed początkiem zawieszenia.' };
  return { ok: true, days, validUntil: new Date(Date.parse(state.validUntil) + days * 86_400_000).toISOString() };
}

// ——— Faktury (4.2): kwota brutto → netto i VAT, numeracja miesięczna ———

export function vatSplit(grossGrosze: number, ratePct: number) {
  const net = Math.round((grossGrosze * 100) / (100 + ratePct));
  return { net, vat: grossGrosze - net, gross: grossGrosze };
}

/** FV/2026/10/0007 – numer kolejny w miesiącu, w strefie studia. */
export function invoiceNumber(prefix: string, localDate: string, seq: number): string {
  const [y, m] = localDate.split('-');
  return `${prefix || 'FV'}/${y}/${m}/${String(seq).padStart(4, '0')}`;
}

// ——— Sklep (4.8.1): warianty (rozmiar / kolor) ze stanem magazynowym ———

export type Variant = { id: string; size?: string | null; color?: string | null; stock: number };

export function variantLabel(v: Variant): string {
  return [v.size, v.color].filter(Boolean).join(' · ') || 'standard';
}

export function takeStock(variants: Variant[], variantId: string, qty: number): Variant[] {
  const v = variants.find((x) => x.id === variantId);
  if (!v) throw new Error('Nie ma takiego wariantu.');
  if (v.stock < qty) throw new Error(v.stock === 0 ? 'Ten rozmiar jest wyprzedany.' : `Zostało tylko ${v.stock} szt.`);
  return variants.map((x) => (x.id === variantId ? { ...x, stock: x.stock - qty } : x));
}

export function returnStock(variants: Variant[], variantId: string, qty: number): Variant[] {
  return variants.map((x) => (x.id === variantId ? { ...x, stock: x.stock + qty } : x));
}

export const totalStock = (variants: Variant[]) => variants.reduce((n, v) => n + v.stock, 0);

/** Rezerwacja do odbioru (S3): sztuka blokowana na X dni, potem wraca na stan. */
export function reservationExpiry(localToday: string, days: number): string {
  return addDays(localToday, days);
}

// ——— Polecenia (decyzja 8) ———

export type ReferralRules = { enabled: boolean; friendFirstClassFree: boolean; inviterBonusEntries: number; monthlyCap: number };

/** Czy zapraszającej należy się bonus (znajoma kupiła pierwszy karnet, limit miesięczny nieprzekroczony). */
export function referralBonusDue(rules: ReferralRules, input: { bonusesThisMonth: number; alreadyGranted: boolean }): boolean {
  return rules.enabled && rules.inviterBonusEntries > 0 && !input.alreadyGranted && input.bonusesThisMonth < rules.monthlyCap;
}

export const REFERRAL_STATUS_COPY: Record<'sent' | 'accepted' | 'first_class' | 'purchased', (name: string) => string> = {
  sent: () => 'Zaproszenie wysłane',
  accepted: (n) => `${n} zaakceptowała`,
  first_class: (n) => `${n} ma już pierwszy trening`,
  purchased: (n) => `${n} kupiła karnet – bonus na Twoim koncie`,
};
