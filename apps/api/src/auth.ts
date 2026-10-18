// Logowanie numerem telefonu + jednorazowy kod SMS (sekcja 2.2):
// kod 6 cyfr ważny 5 min, ponowna wysyłka po 60 s, blokada 15 min po 5 błędnych próbach,
// limit wysyłek na numer i na IP, CAPTCHA przy podejrzanej aktywności, awaryjnie połączenie
// głosowe albo kod na e-mail. Kody i tokeny trzymamy wyłącznie jako skróty SHA-256.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { id, type Db } from './db.ts';
import { HttpError, badRequest } from './errors.ts';
import type { EmailSender, SmsGateway } from './sms.ts';

export const OTP = {
  length: 6,
  ttlMs: 5 * 60_000,
  resendAfterMs: 60_000,
  maxAttempts: 5,
  lockMs: 15 * 60_000,
  maxSendsPerPhonePerHour: 5,
  maxSendsPerIpPerHour: 20,
  /** Od tylu wysyłek z jednego IP w godzinie prosimy o CAPTCHA. */
  captchaAfterIpSends: 8,
  /** Od tylu wysyłek na numer w godzinie prosimy o CAPTCHA. */
  captchaAfterPhoneSends: 3,
  powDifficulty: 16,
  sessionTtlMs: 90 * 24 * 3_600_000,
};

const PEPPER = process.env.GLAM_OTP_PEPPER ?? 'dev-pepper-change-me';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const codeHash = (phone: string, code: string) => sha(`${phone}:${String(code).trim()}:${PEPPER}`);

export function normalizePhone(raw: string): string {
  const digits = String(raw ?? '').replace(/[\s\-()]/g, '');
  const withCc = /^\d{9}$/.test(digits) ? `+48${digits}` : digits.startsWith('00') ? `+${digits.slice(2)}` : digits;
  if (!/^\+\d{9,15}$/.test(withCc)) throw badRequest('Podaj poprawny numer telefonu, np. 500 600 700.');
  return withCc;
}

const ipBuckets = new Map<string, { start: number; count: number }>();

function ipCount(ip: string, now: number) {
  const b = ipBuckets.get(ip);
  return !b || now - b.start > 3_600_000 ? 0 : b.count;
}

function takeIpToken(ip: string, now: number) {
  const b = ipBuckets.get(ip);
  if (!b || now - b.start > 3_600_000) {
    ipBuckets.set(ip, { start: now, count: 1 });
    return;
  }
  if (b.count >= OTP.maxSendsPerIpPerHour) throw new HttpError(429, 'ip_limit', 'Zbyt wiele prób z tego urządzenia. Spróbuj za chwilę.');
  b.count++;
}

// ——— CAPTCHA bez zewnętrznego dostawcy: proof-of-work (hashcash) ———
// Przeglądarka szuka liczby, dla której SHA-256(wyzwanie + liczba) zaczyna się od N zerowych bitów.
// Człowiekowi to nic nie kosztuje (ułamek sekundy), skryptowi masowo wysyłającemu SMS-y – dużo.

export function captchaChallenge(db: Db) {
  const challenge = randomBytes(16).toString('base64url');
  db.prepare("INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at) VALUES (?, NULL, 'pow', ?)").run(challenge, Date.now() + 5 * 60_000);
  return { challenge, difficulty: OTP.powDifficulty };
}

export function leadingZeroBits(hash: Buffer): number {
  let n = 0;
  for (const byte of hash) {
    if (byte === 0) {
      n += 8;
      continue;
    }
    n += Math.clz32(byte) - 24;
    break;
  }
  return n;
}

export function verifyCaptcha(db: Db, solution: { challenge: string; nonce: string } | undefined): boolean {
  if (!solution?.challenge) return false;
  const row = db.prepare("SELECT expires_at FROM webauthn_challenges WHERE challenge = ? AND kind = 'pow'").get(solution.challenge) as { expires_at: number } | undefined;
  db.prepare('DELETE FROM webauthn_challenges WHERE challenge = ?').run(solution.challenge);
  if (!row || row.expires_at < Date.now()) return false;
  return leadingZeroBits(createHash('sha256').update(`${solution.challenge}${solution.nonce}`).digest()) >= OTP.powDifficulty;
}

type OtpRow = {
  phone: string;
  code_hash: string;
  expires_at: number;
  sent_at: number;
  attempts: number;
  locked_until: number | null;
  window_started: number;
  sends_in_window: number;
};

export type CodeChannel = 'sms' | 'voice' | 'email';

export async function requestCode(
  db: Db,
  senders: { sms: SmsGateway; email?: EmailSender },
  rawPhone: string,
  ip: string,
  now = Date.now(),
  opts: { channel?: CodeChannel; captcha?: { challenge: string; nonce: string } } = {},
) {
  const phone = normalizePhone(rawPhone);
  const channel = opts.channel ?? 'sms';
  const row = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(phone) as OtpRow | undefined;

  if (row?.locked_until && row.locked_until > now) {
    throw new HttpError(429, 'locked', 'Za dużo błędnych kodów. Spróbuj ponownie za kilka minut.', { retryIn: Math.ceil((row.locked_until - now) / 1000) });
  }
  if (row && now - row.sent_at < OTP.resendAfterMs) {
    throw new HttpError(429, 'resend_too_soon', 'Kod już wysłałyśmy. Nowy możesz poprosić za chwilę.', { retryIn: Math.ceil((OTP.resendAfterMs - (now - row.sent_at)) / 1000) });
  }
  const windowFresh = !row || now - row.window_started > 3_600_000;
  if (!windowFresh && row!.sends_in_window >= OTP.maxSendsPerPhonePerHour) {
    throw new HttpError(429, 'phone_limit', 'Wysłałyśmy już kilka kodów na ten numer. Spróbuj za godzinę.');
  }
  const suspicious = ipCount(ip, now) >= OTP.captchaAfterIpSends || (!windowFresh && row!.sends_in_window >= OTP.captchaAfterPhoneSends);
  if (suspicious && !verifyCaptcha(db, opts.captcha)) {
    throw new HttpError(428, 'captcha_required', 'Potwierdź, że to Ty – to potrwa sekundę.', captchaChallenge(db));
  }

  let email: string | null = null;
  if (channel === 'email') {
    email = (db.prepare('SELECT email FROM users WHERE phone = ?').get(phone) as { email: string | null } | undefined)?.email ?? null;
    if (!email || !senders.email) throw badRequest('Do tego numeru nie ma przypisanego e-maila. Wybierz SMS albo połączenie.');
  }
  if (channel === 'voice' && !senders.sms.call) throw badRequest('Połączenie głosowe jest chwilowo niedostępne.');
  takeIpToken(ip, now);

  const code = String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, '0');
  db.prepare(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, sent_at, attempts, locked_until, window_started, sends_in_window, channel)
     VALUES ($phone, $hash, $exp, $now, 0, NULL, $ws, $sends, $channel)
     ON CONFLICT (phone) DO UPDATE SET code_hash = $hash, expires_at = $exp, sent_at = $now, attempts = 0,
       locked_until = NULL, window_started = $ws, sends_in_window = $sends, channel = $channel`,
  ).run({
    phone,
    hash: codeHash(phone, code),
    exp: now + OTP.ttlMs,
    now,
    ws: windowFresh ? now : row!.window_started,
    sends: windowFresh ? 1 : row!.sends_in_window + 1,
    channel,
  });

  if (channel === 'voice') await senders.sms.call!(phone, `Twój kod GLAM to: ${code.split('').join(' ')}. Powtarzam: ${code.split('').join(' ')}.`);
  else if (channel === 'email') await senders.email!.send(email!, 'Twój kod logowania GLAM', `Twój kod logowania to ${code}. Ważny 5 minut. Nie podawaj go nikomu.`);
  else await senders.sms.send(phone, `GLAM: Twój kod logowania to ${code}. Ważny 5 minut. Nie podawaj go nikomu.`);
  return { phone, code, resendIn: OTP.resendAfterMs / 1000, channel };
}

export type AuthUser = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  birthday: string | null;
  nameday: string | null;
  need_quiet: number;
  rest_day: string | null;
  push_disabled_json: string;
  quiet_from: string;
  quiet_to: string;
  prefs_json: string | null;
  address_enc: string | null;
  avatar_mime: string | null;
  avatar_version: number;
  onboarded_at: string | null;
  created_at: string;
};

export function verifyCode(db: Db, rawPhone: string, code: string, now = Date.now()) {
  const phone = normalizePhone(rawPhone);
  checkOtp(db, phone, code, now);
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as AuthUser | undefined;
  const isNew = !user;
  if (!user) {
    db.prepare('INSERT INTO users (id, phone, created_at) VALUES (?, ?, ?)').run(id(), phone, new Date(now).toISOString());
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as AuthUser;
  }
  return { token: createSession(db, user.id, now), user, isNew };
}

/** Sprawdza kod (z blokadą po 5 błędach) i zużywa go. */
export function checkOtp(db: Db, phone: string, code: string, now = Date.now()) {
  const row = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(phone) as OtpRow | undefined;
  if (!row) throw new HttpError(400, 'no_code', 'Najpierw poproś o kod SMS.');
  if (row.locked_until && row.locked_until > now) throw new HttpError(429, 'locked', 'Za dużo błędnych kodów. Spróbuj ponownie za kilka minut.');
  if (row.expires_at < now) throw new HttpError(400, 'expired', 'Kod wygasł. Poproś o nowy.');
  const expected = Buffer.from(row.code_hash, 'hex');
  const given = Buffer.from(codeHash(phone, code), 'hex');
  if (!timingSafeEqual(expected, given)) {
    const attempts = row.attempts + 1;
    const locked = attempts >= OTP.maxAttempts ? now + OTP.lockMs : null;
    db.prepare('UPDATE otp_codes SET attempts = ?, locked_until = ? WHERE phone = ?').run(attempts, locked, phone);
    throw new HttpError(400, 'wrong_code', locked ? 'Za dużo błędnych kodów. Spróbuj za 15 minut.' : 'Ten kod się nie zgadza. Sprawdź SMS.', {
      attemptsLeft: Math.max(0, OTP.maxAttempts - attempts),
    });
  }
  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone);
}

export function createSession(db: Db, userId: string, now = Date.now(), device?: string): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO auth_sessions (token_hash, user_id, device, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    sha(token),
    userId,
    device ?? null,
    new Date(now).toISOString(),
    now + OTP.sessionTtlMs,
  );
  return token;
}

export function userFromToken(db: Db, token: string | undefined, now = Date.now()): AuthUser | undefined {
  if (!token) return undefined;
  return db.prepare('SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(sha(token), now) as AuthUser | undefined;
}

/** Wylogowanie zdalne ze wszystkich urządzeń (2.2). */
export function logoutAll(db: Db, userId: string) {
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
}

export const sessionHash = sha;

// ——— Zmiana numeru: kod na stary i na nowy numer (2.2) ———

export async function startPhoneChange(db: Db, sms: SmsGateway, user: AuthUser, rawNew: string, now = Date.now()) {
  const newPhone = normalizePhone(rawNew);
  if (newPhone === user.phone) throw badRequest('To jest Twój obecny numer.');
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(newPhone)) throw new HttpError(409, 'phone_taken', 'Ten numer ma już konto w GLAM.');
  const oldCode = String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, '0');
  const newCode = String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, '0');
  db.prepare('INSERT OR REPLACE INTO phone_changes (user_id, new_phone, old_code_hash, new_code_hash, attempts, expires_at) VALUES (?, ?, ?, ?, 0, ?)').run(
    user.id,
    newPhone,
    codeHash(user.phone, oldCode),
    codeHash(newPhone, newCode),
    now + 10 * 60_000,
  );
  await sms.send(user.phone, `GLAM: kod potwierdzenia zmiany numeru: ${oldCode}. Jeśli to nie Ty – zignoruj tę wiadomość.`);
  await sms.send(newPhone, `GLAM: kod do potwierdzenia nowego numeru: ${newCode}.`);
  return { newPhone, oldCode, newCode };
}

export function confirmPhoneChange(db: Db, user: AuthUser, oldCode: string, newCode: string, now = Date.now()) {
  const row = db.prepare('SELECT * FROM phone_changes WHERE user_id = ?').get(user.id) as
    | { new_phone: string; old_code_hash: string; new_code_hash: string; attempts: number; expires_at: number }
    | undefined;
  if (!row || row.expires_at < now) throw new HttpError(400, 'expired', 'Kody wygasły. Zacznij zmianę numeru od nowa.');
  if (row.attempts >= OTP.maxAttempts) throw new HttpError(429, 'locked', 'Za dużo prób. Zacznij od nowa za kilka minut.');
  const ok = codeHash(user.phone, oldCode) === row.old_code_hash && codeHash(row.new_phone, newCode) === row.new_code_hash;
  if (!ok) {
    db.prepare('UPDATE phone_changes SET attempts = attempts + 1 WHERE user_id = ?').run(user.id);
    throw new HttpError(400, 'wrong_code', 'Któryś z kodów się nie zgadza.');
  }
  db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(row.new_phone, user.id);
  db.prepare('DELETE FROM phone_changes WHERE user_id = ?').run(user.id);
  return row.new_phone;
}
