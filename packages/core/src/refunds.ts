// Podpowiedź kwoty zwrotu za karnet (zwrot z panelu, np. przy przypadkowym zakupie).
// Właścicielka może kwotę zmienić – formularz pilnuje tylko, żeby nie przekroczyła wpłaty.
import type { ProductRules } from './products.ts';

export type RefundBasis = {
  /** Ile klientka zapłaciła, minus zwroty, które już poszły. */
  remainingGrosze: number;
  rules: ProductRules;
  /** Pozostałe wejścia w pulach karnetu (te same klucze co rules.pools[].id). */
  balances: Record<string, number>;
  validFrom: string;
  validUntil: string;
  /** Ile zajęć z tego karnetu już się odbyło (obecność, spóźnione odwołanie). */
  used: number;
};

export function suggestPassRefund(basis: RefundBasis, now = new Date()): number {
  // TODO(Maciek): reguła podpowiedzi. Na razie pełna kwota – pasuje do przypadkowego zakupu bez wejść.
  void now;
  return basis.remainingGrosze;
}
