// Limity wiadomości, które klientka wysyła do innych osób (zaproszenie na zajęcia, polecenie, przepisanie wejściówki).
// SMS kosztuje studio, a numer odbiorczyni podaje klientka – bez limitu jedno konto mogłoby rozsyłać spam
// albo sprawdzać numer po numerze, kto chodzi do studia. Liczymy każdą próbę z numerem, także tę bez SMS.
import { id } from '../db.ts';
import { HttpError } from '../errors.ts';
import type { StudioScope } from '../scope.ts';

export const CLIENT_SMS = {
  /** Ile wiadomości do znajomych jedna klientka wyśle w ciągu doby (w jednym studiu). */
  perUserPerDay: 5,
  /** Ile wiadomości z jednego studia dostanie jeden numer w ciągu doby – od wszystkich klientek razem. */
  perPhonePerDay: 2,
};

export type ClientSmsKind = 'session_invite' | 'referral' | 'guest_pass_transfer';

/** Sprawdza limity i zapisuje próbę. Rzuca 429, gdy limit jest wyczerpany. */
export function claimClientSms(scope: StudioScope, userId: string, kind: ClientSmsKind, phone: string, now = new Date()) {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const byUser = scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM client_sms_log WHERE studio_id = $studio AND user_id = $u AND created_at >= $since', { u: userId, since })!.n;
  if (byUser >= CLIENT_SMS.perUserPerDay) throw new HttpError(429, 'sms_limit', 'Na dziś wysłałaś już dużo zaproszeń. Kolejne będą możliwe jutro.');
  const byPhone = scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM client_sms_log WHERE studio_id = $studio AND phone = $p AND created_at >= $since', { p: phone, since })!.n;
  if (byPhone >= CLIENT_SMS.perPhonePerDay) throw new HttpError(429, 'sms_limit', 'Ta osoba dostała już dziś od nas wiadomość. Spróbuj jutro.');
  scope.run('INSERT INTO client_sms_log (id, studio_id, user_id, kind, phone, created_at) VALUES ($id, $studio, $u, $k, $p, $now)', { id: id(), u: userId, k: kind, p: phone, now: now.toISOString() });
}
