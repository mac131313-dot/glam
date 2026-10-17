// Konto (globalne): logowanie SMS / głos / e-mail, biometria, CAPTCHA, profil i ustawienia, zgody,
// onboarding, „Moje studia”, dołączanie kodem i z katalogu, wejściówki i polecenia, zmiana numeru,
// eksport i usunięcie danych (RODO), push, kalendarz, dziennik, cykl, quiz, „7 dni spokoju”.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CALM_7,
  calmDayUnlocked,
  initialBalances,
  journalWeek,
  localParts,
  passValidity,
  quizResult,
  resolveLook,
  validEmail,
  validEntry,
  weekStart,
  addDays,
  cyclePhase,
  CYCLE_SUGGESTION,
  type JournalEntry,
  type ProductRules,
  type QuizAnswers,
} from '@glam/core';
import {
  captchaChallenge,
  confirmPhoneChange,
  createSession,
  logoutAll,
  normalizePhone,
  requestCode,
  sessionHash,
  startPhoneChange,
  verifyCode,
  type AuthUser,
  type CodeChannel,
} from '../auth.ts';
import { bearer, ctx, requireUser, type Deps } from '../context.ts';
import { seal, unseal } from '../crypto.ts';
import { id, nowIso, tx } from '../db.ts';
import { HttpError, badRequest, conflict, notFound } from '../errors.ts';
import { StudioScope } from '../scope.ts';
import { notify } from '../services/notify.ts';
import { issuePass } from '../services/passes.ts';
import { loadStudio, logoInfo, type Studio } from '../services/studio.ts';
import { loginOptions, registrationOptions, verifyLogin, verifyRegistration, type RelyingParty } from '../services/webauthn.ts';
import { vapidKeys } from '../services/webpush.ts';
import { validateImage } from './logo.ts';

const redeemAttempts = new Map<string, { start: number; count: number }>();

/** Strona zaufania WebAuthn: domena z nagłówka Host (lub GLAM_RP_ID), dozwolone pochodzenie z Origin. */
export function relyingParty(req: FastifyRequest): RelyingParty {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(':')[0];
  const rpId = process.env.GLAM_RP_ID ?? host;
  const configured = process.env.GLAM_ORIGINS?.split(',').map((s) => s.trim()) ?? [];
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
  const allowed = origin && (new URL(origin).hostname === rpId || new URL(origin).hostname.endsWith(`.${rpId}`)) ? [origin] : [];
  return { id: rpId, origins: [...configured, ...allowed] };
}

export type UserPrefs = {
  occasionsOff?: string[];
  reminderTime?: string | null;
  eveningDays?: number[];
  microBreaks?: string[];
  visibility?: 'public' | 'studio' | 'private';
  frame?: string;
  language?: 'pl';
  sounds?: boolean;
  appIcon?: string;
  a11y?: { fontScale?: number; contrast?: boolean; reduceMotion?: boolean };
  quiz?: { answers: QuizAnswers; takenAt: string };
  themesSeen?: string[];
  goal?: string;
  timePrefs?: string[];
};

export const prefsOf = (u: { prefs_json: string | null }): UserPrefs => (u.prefs_json ? JSON.parse(u.prefs_json) : {});

export function accountRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const auth = { preHandler: requireUser(db) };
  const me = (req: FastifyRequest) => req.user!;
  const reloadUser = (uid: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as AuthUser;

  // ——— Logowanie ———

  app.post<{ Body: { phone: string; channel?: CodeChannel; captcha?: { challenge: string; nonce: string } } }>('/api/auth/request-code', async (req) => {
    const res = await requestCode(db, deps, req.body?.phone, req.ip, Date.now(), { channel: req.body?.channel, captcha: req.body?.captcha });
    // Kod w odpowiedzi tylko w trybie deweloperskim – w produkcji wyłącznie SMS / połączenie / e-mail.
    return { phone: res.phone, channel: res.channel, resendIn: res.resendIn, ...(deps.exposeDevCodes ? { devCode: res.code } : {}) };
  });

  app.post('/api/auth/captcha', async () => captchaChallenge(db));

  app.post<{ Body: { phone: string; code: string; device?: string } }>('/api/auth/verify', async (req) => {
    const { token, user, isNew } = verifyCode(db, req.body?.phone, req.body?.code);
    return { token, isNew, user: publicUser(user) };
  });

  // Tryb demo (na razie bez ekranu logowania): sesja dla istniejącego konta demo bez SMS.
  // Rejestrowany WYŁĄCZNIE poza produkcją – w produkcji ta ścieżka nie istnieje (404).
  if (deps.exposeDevCodes) {
    app.post<{ Body: { phone: string } }>('/api/dev/login', async (req) => {
      const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalizePhone(req.body?.phone)) as AuthUser | undefined;
      if (!user) throw notFound('Nie ma takiego konta demo.');
      return { token: createSession(db, user.id, Date.now(), 'demo'), user: publicUser(user) };
    });
  }

  // Biometria (WebAuthn): logowanie bez SMS na urządzeniu, na którym klucz został zapisany.
  app.post('/api/auth/passkey/options', async (req) => loginOptions(db, relyingParty(req)));
  app.post<{ Body: { id: string; response: { clientDataJSON: string; authenticatorData: string; signature: string } } }>('/api/auth/passkey/verify', async (req) => {
    const userId = verifyLogin(db, req.body, relyingParty(req));
    const user = reloadUser(userId);
    return { token: createSession(db, userId, Date.now(), 'passkey'), user: publicUser(user) };
  });
  app.post('/api/me/passkeys/options', auth, async (req) => registrationOptions(db, me(req), relyingParty(req)));
  app.post<{ Body: { id: string; response: { clientDataJSON: string; attestationObject: string }; label?: string } }>('/api/me/passkeys', auth, async (req) =>
    verifyRegistration(db, me(req).id, req.body, relyingParty(req), req.body.label?.slice(0, 40)),
  );
  app.get('/api/me/passkeys', auth, async (req) => db.prepare('SELECT id, label, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at').all(me(req).id));
  app.delete<{ Params: { id: string } }>('/api/me/passkeys/:id', auth, async (req) => {
    db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?').run(req.params.id, me(req).id);
    return { ok: true };
  });

  app.post('/api/auth/logout', auth, async (req) => {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sessionHash(bearer(req) ?? ''));
    return { ok: true };
  });
  app.post('/api/auth/logout-all', auth, async (req) => {
    logoutAll(db, me(req).id);
    return { ok: true };
  });
  app.get('/api/me/sessions', auth, async (req) =>
    (db.prepare('SELECT token_hash, device, created_at FROM auth_sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC').all(me(req).id, Date.now()) as { token_hash: string; device: string | null; created_at: string }[]).map((s) => ({
      device: s.device ?? 'Telefon',
      created_at: s.created_at,
      current: s.token_hash === sessionHash(bearer(req) ?? ''),
    })),
  );

  // ——— Profil i ustawienia ———

  app.get('/api/me', auth, async (req) => {
    const studios = db
      .prepare(
        `SELECT s.id, s.name, s.city, s.logo, s.accent, s.tagline, s.look_json, s.logo_mime, s.logo_ratio, s.logo_version, s.status, s.plan_id, group_concat(m.role) AS roles
         FROM memberships m JOIN studios s ON s.id = m.studio_id WHERE m.user_id = ? GROUP BY s.id ORDER BY s.name`,
      )
      .all(me(req).id) as { id: string; roles: string; look_json: string | null; logo_mime: string | null; logo_ratio: number | null; logo_version: number }[];
    return {
      user: publicUser(me(req)),
      studios: studios.map(({ look_json, logo_mime, logo_ratio, logo_version, ...s }) => ({
        ...s,
        roles: s.roles.split(','),
        look: resolveLook(look_json ? JSON.parse(look_json) : null),
        ...logoInfo({ id: s.id, logo_mime, logo_ratio, logo_version }),
      })),
    };
  });

  app.patch<{
    Body: {
      name?: string;
      email?: string | null;
      birthday?: string | null;
      nameday?: string | null;
      themeOptOut?: boolean;
      needQuiet?: boolean;
      restToday?: boolean;
      quietFrom?: string;
      quietTo?: string;
      pushDisabled?: string[];
      prefs?: Partial<UserPrefs>;
      address?: { line: string; city: string; zip: string } | null;
    };
  }>('/api/me', auth, async (req) => {
    const b = req.body ?? {};
    const u = me(req);
    const mmdd = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    if (b.birthday && !mmdd.test(b.birthday)) throw badRequest('Data urodzin w formacie MM-DD (bez roku).');
    if (b.nameday && !mmdd.test(b.nameday)) throw badRequest('Imieniny w formacie MM-DD.');
    if (b.name !== undefined && (b.name.trim().length < 2 || b.name.length > 60)) throw badRequest('Imię powinno mieć od 2 do 60 znaków.');
    if (b.email && !validEmail(b.email)) throw badRequest('Sprawdź adres e-mail.');
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if ((b.quietFrom && !hhmm.test(b.quietFrom)) || (b.quietTo && !hhmm.test(b.quietTo))) throw badRequest('Ciche godziny w formacie GG:MM.');
    const prefs = { ...prefsOf(u), ...(b.prefs ?? {}) };
    if (prefs.a11y?.fontScale && (prefs.a11y.fontScale < 0.9 || prefs.a11y.fontScale > 1.6)) throw badRequest('Rozmiar tekstu: od 90 do 160%.');
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(
      `UPDATE users SET name = ?, email = ?, birthday = ?, nameday = ?, theme_opt_out = ?, need_quiet = ?, quiet_from = ?, quiet_to = ?, push_disabled_json = ?, prefs_json = ?, rest_day = ?, address_enc = ? WHERE id = ?`,
    ).run(
      b.name?.trim() ?? u.name,
      b.email !== undefined ? b.email || null : u.email,
      b.birthday !== undefined ? b.birthday : u.birthday,
      b.nameday !== undefined ? b.nameday : u.nameday,
      b.themeOptOut !== undefined ? Number(b.themeOptOut) : u.theme_opt_out,
      b.needQuiet !== undefined ? Number(b.needQuiet) : u.need_quiet,
      b.quietFrom ?? u.quiet_from,
      b.quietTo ?? u.quiet_to,
      b.pushDisabled !== undefined ? JSON.stringify(b.pushDisabled.filter((x) => x !== 'transactional')) : u.push_disabled_json,
      JSON.stringify(prefs),
      b.restToday !== undefined ? (b.restToday ? today : null) : u.rest_day,
      b.address !== undefined ? (b.address ? seal(b.address) : null) : u.address_enc,
      u.id,
    );
    return { user: publicUser(reloadUser(u.id)) };
  });

  app.put<{ Body: { dataUrl: string | null } }>('/api/me/avatar', { ...auth, bodyLimit: 1024 * 1024 }, async (req) => {
    const u = me(req);
    if (!req.body?.dataUrl) {
      db.prepare('UPDATE users SET avatar_mime = NULL, avatar_data = NULL, avatar_version = avatar_version + 1 WHERE id = ?').run(u.id);
      return { ok: true };
    }
    const { mime, data } = validateImage(req.body.dataUrl, { what: 'Zdjęcie profilowe', maxBytes: 400_000, svg: false });
    db.prepare('UPDATE users SET avatar_mime = ?, avatar_data = ?, avatar_version = avatar_version + 1 WHERE id = ?').run(mime, data, u.id);
    return { user: publicUser(reloadUser(u.id)) };
  });

  app.get<{ Params: { id: string } }>('/api/users/:id/avatar', async (req, reply) => {
    const row = db.prepare('SELECT avatar_mime, avatar_data FROM users WHERE id = ?').get(req.params.id) as { avatar_mime: string | null; avatar_data: Uint8Array | null } | undefined;
    if (!row?.avatar_mime || !row.avatar_data) throw notFound();
    return reply.header('content-type', row.avatar_mime).header('cache-control', 'public, max-age=31536000, immutable').send(Buffer.from(row.avatar_data));
  });

  // Onboarding (3): cel, preferencje czasowe, zgody, urodziny (dobrowolnie, bez roku).
  app.post<{ Body: { name?: string; goal?: string; timePrefs?: string[]; birthday?: string | null; consents?: Record<string, boolean>; studioId?: string } }>('/api/me/onboarding', auth, async (req) => {
    const u = me(req);
    const b = req.body ?? {};
    if (b.name && (b.name.trim().length < 2 || b.name.length > 60)) throw badRequest('Imię powinno mieć od 2 do 60 znaków.');
    if (b.birthday && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(b.birthday)) throw badRequest('Data urodzin w formacie MM-DD.');
    if (!b.consents?.terms) throw badRequest('Aby korzystać z aplikacji, zaakceptuj regulamin.');
    tx(db, () => {
      const prefs = { ...prefsOf(u), goal: b.goal?.slice(0, 120), timePrefs: b.timePrefs?.slice(0, 5) };
      db.prepare('UPDATE users SET name = COALESCE(?, name), birthday = COALESCE(?, birthday), prefs_json = ?, onboarded_at = ? WHERE id = ?').run(b.name?.trim() ?? null, b.birthday ?? null, JSON.stringify(prefs), nowIso(), u.id);
      for (const [kind, granted] of Object.entries(b.consents ?? {})) setConsent(u.id, kind, granted, kind === 'marketing' ? (b.studioId ?? '') : '');
      if (b.goal && b.studioId) db.prepare("UPDATE memberships SET goal = ? WHERE studio_id = ? AND user_id = ? AND role = 'client'").run(b.goal.slice(0, 120), b.studioId, u.id);
    });
    return { user: publicUser(reloadUser(u.id)) };
  });

  // ——— Zgody (sekcja 11): regulamin, marketing (per studio), dane zdrowotne i cykl (art. 9), zdjęcia, adres ———

  const setConsent = (userId: string, kind: string, granted: boolean, studioId = '') =>
    db.prepare('INSERT INTO consents (user_id, studio_id, kind, granted, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, studio_id, kind) DO UPDATE SET granted = excluded.granted, updated_at = excluded.updated_at').run(
      userId,
      studioId,
      kind,
      Number(granted),
      nowIso(),
    );

  app.get('/api/me/consents', auth, async (req) => db.prepare('SELECT studio_id, kind, granted, updated_at FROM consents WHERE user_id = ?').all(me(req).id));
  app.put<{ Body: { kind: string; granted: boolean; studioId?: string } }>('/api/me/consents', auth, async (req) => {
    const allowed = ['terms', 'marketing', 'marketing_sms', 'marketing_email', 'health', 'cycle', 'photos', 'address', 'community'];
    if (!allowed.includes(req.body?.kind)) throw badRequest('Nieznany rodzaj zgody.');
    setConsent(me(req).id, req.body.kind, !!req.body.granted, req.body.studioId ?? '');
    // Wycofanie zgody na dane zdrowotne = usunięcie tych danych (art. 9, sekcja 11).
    if (!req.body.granted && req.body.kind === 'health') {
      const uid = me(req).id;
      tx(db, () => {
        db.prepare('DELETE FROM journal_entries WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM health_profiles WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM measurements WHERE user_id = ?').run(uid);
      });
    }
    if (!req.body.granted && req.body.kind === 'cycle') db.prepare('DELETE FROM cycle_entries WHERE user_id = ?').run(me(req).id);
    if (!req.body.granted && req.body.kind === 'address') db.prepare('UPDATE users SET address_enc = NULL WHERE id = ?').run(me(req).id);
    return { ok: true };
  });

  // ——— Zmiana numeru telefonu ———

  app.post<{ Body: { newPhone: string } }>('/api/me/phone/start', auth, async (req) => {
    const r = await startPhoneChange(db, deps.sms, me(req), req.body?.newPhone);
    return { newPhone: r.newPhone, ...(deps.exposeDevCodes ? { devOldCode: r.oldCode, devNewCode: r.newCode } : {}) };
  });
  app.post<{ Body: { oldCode: string; newCode: string } }>('/api/me/phone/confirm', auth, async (req) => {
    const phone = confirmPhoneChange(db, me(req), req.body?.oldCode, req.body?.newCode);
    return { phone };
  });

  // ——— RODO: eksport i usunięcie konta ———

  app.get('/api/me/export', auth, async (req, reply) => {
    const u = me(req);
    const q = (sql: string) => db.prepare(sql).all(u.id);
    const data = {
      exportedAt: nowIso(),
      account: { ...publicUser(u), address: unseal(u.address_enc) },
      memberships: q('SELECT studio_id, role, goal, joined_at FROM memberships WHERE user_id = ?'),
      consents: q('SELECT studio_id, kind, granted, updated_at FROM consents WHERE user_id = ?'),
      passes: q('SELECT studio_id, product_name, valid_from, valid_until, status, balances_json FROM passes WHERE user_id = ?'),
      bookings: q('SELECT b.studio_id, s.starts_at, b.status, b.rating FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.user_id = ?'),
      payments: q('SELECT studio_id, kind, amount_grosze, method, created_at FROM payments WHERE user_id = ?'),
      journal: (db.prepare('SELECT date, data_enc FROM journal_entries WHERE user_id = ?').all(u.id) as { date: string; data_enc: string }[]).map((j) => ({ date: j.date, ...(unseal(j.data_enc) as object) })),
      healthProfiles: (db.prepare('SELECT studio_id, data_enc FROM health_profiles WHERE user_id = ?').all(u.id) as { studio_id: string; data_enc: string }[]).map((h) => ({ studio_id: h.studio_id, ...(unseal(h.data_enc) as object) })),
      measurements: (db.prepare('SELECT date, data_enc FROM measurements WHERE user_id = ?').all(u.id) as { date: string; data_enc: string }[]).map((m) => ({ date: m.date, ...(unseal(m.data_enc) as object) })),
      cycle: (db.prepare('SELECT start_date, data_enc FROM cycle_entries WHERE user_id = ?').all(u.id) as { start_date: string; data_enc: string }[]).map((c) => ({ start: c.start_date, ...(unseal(c.data_enc) as object) })),
      mindful: q('SELECT studio_id, kind, ref, minutes, completed_at FROM mindful_logs WHERE user_id = ?'),
      posts: q('SELECT studio_id, body, created_at FROM posts WHERE author_id = ?'),
      comments: q('SELECT studio_id, body, created_at FROM post_comments WHERE author_id = ?'),
      badges: q('SELECT studio_id, code, earned_at FROM user_badges WHERE user_id = ?'),
      loyalty: q('SELECT studio_id, points, reason, created_at FROM loyalty_ledger WHERE user_id = ?'),
      notifications: q('SELECT studio_id, category, body, deliver_at FROM notifications WHERE user_id = ?'),
      chat: q('SELECT studio_id, body, from_staff, created_at FROM chat_messages WHERE client_id = ?'),
      groupChat: q('SELECT studio_id, group_id, body, created_at FROM group_chat WHERE author_id = ?'),
      trainerMessages: q('SELECT studio_id, trainer_id, body, author_id = client_id AS from_me, created_at FROM trainer_messages WHERE client_id = ?'),
    };
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="glam-moje-dane-${new Date().toISOString().slice(0, 10)}.json"`)
      .send(JSON.stringify(data, null, 2));
  });

  app.delete<{ Body: { confirm: string } }>('/api/me', auth, async (req) => {
    if (req.body?.confirm !== 'USUŃ') throw badRequest('Wpisz „USUŃ”, żeby potwierdzić.');
    const u = me(req);
    const staff = db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND role = 'owner'").get(u.id);
    if (staff) throw conflict('owner', 'Konto właścicielki studia usuwamy po przekazaniu studia. Napisz do nas z panelu.');
    tx(db, () => {
      // Dane szczególne i treści – usuwamy. Rozliczenia studia (płatności, faktury) – anonimizujemy.
      for (const sql of [
        'DELETE FROM journal_entries WHERE user_id = ?',
        'DELETE FROM health_profiles WHERE user_id = ?',
        'DELETE FROM measurements WHERE user_id = ?',
        'DELETE FROM cycle_entries WHERE user_id = ?',
        'DELETE FROM progress_photos WHERE user_id = ?',
        'DELETE FROM consents WHERE user_id = ?',
        'DELETE FROM auth_sessions WHERE user_id = ?',
        'DELETE FROM webauthn_credentials WHERE user_id = ?',
        'DELETE FROM push_subscriptions WHERE user_id = ?',
        'DELETE FROM music_accounts WHERE user_id = ?',
        'DELETE FROM health_sync WHERE user_id = ?',
        'DELETE FROM notifications WHERE user_id = ?',
        'DELETE FROM post_likes WHERE user_id = ?',
        'DELETE FROM course_mini_progress WHERE user_id = ?',
        'UPDATE posts SET hidden = 1, body = \'[treść usunięta]\', media_id = NULL WHERE author_id = ?',
        'UPDATE post_comments SET hidden = 1, body = \'[treść usunięta]\' WHERE author_id = ?',
        'DELETE FROM trainer_notes WHERE client_id = ?',
        'DELETE FROM chat_messages WHERE client_id = ?',
        'UPDATE group_chat SET hidden = 1, body = \'[treść usunięta]\', media_id = NULL WHERE author_id = ?',
        'DELETE FROM group_chat_reads WHERE user_id = ?',
        'DELETE FROM trainer_messages WHERE client_id = ?',
        "UPDATE bookings SET status = 'cancelled' WHERE user_id = ? AND status IN ('booked', 'waitlist')",
      ])
        db.prepare(sql).run(u.id);
      db.prepare("DELETE FROM memberships WHERE user_id = ? AND role = 'client'").run(u.id);
      db.prepare(
        `UPDATE users SET phone = ?, name = NULL, email = NULL, birthday = NULL, nameday = NULL, prefs_json = NULL, address_enc = NULL,
         avatar_mime = NULL, avatar_data = NULL, calendar_token = NULL, deleted_at = ? WHERE id = ?`,
      ).run(`usunieta:${u.id}`, nowIso(), u.id);
    });
    return { ok: true, message: 'Konto usunięte. Dziękujemy za wspólny czas 💛' };
  });

  // ——— Push na urządzenie (PWA) ———

  app.get('/api/push/key', async () => ({ publicKey: vapidKeys(db).publicKey }));
  app.post<{ Body: { endpoint: string; keys: { p256dh: string; auth: string } } }>('/api/me/push-subscriptions', auth, async (req) => {
    const b = req.body;
    if (!b?.endpoint?.startsWith('https://') || !b.keys?.p256dh || !b.keys?.auth) throw badRequest('Nieprawidłowa subskrypcja.');
    db.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)').run(b.endpoint, me(req).id, b.keys.p256dh, b.keys.auth, nowIso());
    return { ok: true };
  });
  app.delete<{ Body: { endpoint: string } }>('/api/me/push-subscriptions', auth, async (req) => {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(req.body?.endpoint, me(req).id);
    return { ok: true };
  });

  // ——— Synchronizacja z kalendarzem telefonu (4.1): prywatny adres .ics ———

  app.post('/api/me/calendar', auth, async (req) => {
    const u = me(req);
    let token = (db.prepare('SELECT calendar_token FROM users WHERE id = ?').get(u.id) as { calendar_token: string | null }).calendar_token;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, '');
      db.prepare('UPDATE users SET calendar_token = ? WHERE id = ?').run(token, u.id);
    }
    return { url: `/api/calendar/${token}.ics`, webcal: `${deps.publicUrl ?? ''}/api/calendar/${token}.ics` };
  });

  // ——— Dołączanie do studia (1.2.2) ———

  app.post<{ Body: { code: string } }>('/api/studios/join', auth, async (req) => {
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    const studio = db.prepare("SELECT id, name FROM studios WHERE invite_code = ? AND status != 'suspended'").get(code) as { id: string; name: string } | undefined;
    if (studio) {
      db.prepare("INSERT OR IGNORE INTO memberships (studio_id, user_id, role, joined_at) VALUES (?, ?, 'client', ?)").run(studio.id, me(req).id, nowIso());
      return { studio };
    }
    // Kod polecenia od znajomej (decyzja 8) też prowadzi do studia.
    const ref = db.prepare('SELECT studio_id FROM referrals WHERE code = ?').get(code) as { studio_id: string } | undefined;
    if (ref) return acceptReferral(me(req), code);
    throw notFound('Nie znamy takiego kodu studia. Sprawdź go albo zeskanuj QR w recepcji.');
  });

  // Polecenie: znajoma przyjmuje zaproszenie → pierwsze zajęcia gratis (raz na numer w studiu).
  const acceptReferral = (user: AuthUser, code: string) => {
    const ref = db.prepare('SELECT * FROM referrals WHERE code = ?').get(code) as { id: string; studio_id: string; inviter_id: string; invitee_phone: string | null; status: string } | undefined;
    if (!ref) throw notFound('Ten kod zaproszenia nie istnieje.');
    if (ref.inviter_id === user.id) throw conflict('own_referral', 'To Twoje zaproszenie – wyślij je znajomej.');
    if (ref.invitee_phone && ref.invitee_phone !== user.phone) throw conflict('wrong_recipient', 'To zaproszenie jest dla innego numeru.');
    const studio = loadStudio(db, ref.studio_id);
    const scope = new StudioScope(db, studio.id);
    const wasMember = !!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: user.id });
    const alreadyFree = !!scope.get("SELECT 1 FROM referrals WHERE studio_id = $studio AND invitee_id = $u", { u: user.id });
    scope.tx(() => {
      scope.run("INSERT OR IGNORE INTO memberships (studio_id, user_id, role, joined_at) VALUES ($studio, $u, 'client', $now)", { u: user.id, now: nowIso() });
      if (ref.status !== 'sent') return;
      scope.run("UPDATE referrals SET status = 'accepted', invitee_id = $u, invitee_name = $n, updated_at = $now WHERE studio_id = $studio AND id = $id", { u: user.id, n: user.name, now: nowIso(), id: ref.id });
      if (studio.settings.referral.friendFirstClassFree && !wasMember && !alreadyFree) {
        const rules: ProductRules = { validityDays: 30, pools: [{ id: 'free', label: 'Pierwsze zajęcia gratis', entries: 1, classTypeIds: 'all' }] };
        const v = passValidity(rules, new Date());
        issuePass(scope, { userId: user.id, versionId: null, name: 'Pierwsze zajęcia gratis', rules, balances: initialBalances(rules), validFrom: v.validFrom, validUntil: v.validUntil, source: 'referral' });
      }
      notify(scope, { userId: ref.inviter_id, category: 'community', tz: studio.timezone, body: `${user.name ?? 'Twoja znajoma'} zaakceptowała zaproszenie 💛`, action: 'community/invites' });
    });
    return { studio: { id: studio.id, name: studio.name }, message: wasMember ? `Witaj ponownie w ${studio.name}.` : `Witaj w ${studio.name}! Pierwsze zajęcia masz w prezencie.` };
  };
  app.post<{ Body: { code: string } }>('/api/referrals/accept', auth, async (req) => acceptReferral(me(req), String(req.body?.code ?? '').trim().toUpperCase()));

  // Aktywacja wejściówki od znajomej (4.3). Kod identyfikuje studio; dołączamy klientkę do studia.
  app.post<{ Body: { code: string } }>('/api/guest-passes/redeem', auth, async (req) => {
    const user = ctx(req).user;
    const now = Date.now();
    const bucket = redeemAttempts.get(user.id);
    if (bucket && now - bucket.start < 3_600_000 && bucket.count >= 10) throw new HttpError(429, 'redeem_limit', 'Za dużo prób. Spróbuj za godzinę.');
    if (!bucket || now - bucket.start >= 3_600_000) redeemAttempts.set(user.id, { start: now, count: 1 });
    else bucket.count++;

    const code = String(req.body?.code ?? '').trim().toUpperCase();
    const gp = db.prepare('SELECT * FROM guest_passes WHERE code = ?').get(code) as
      | { id: string; studio_id: string; buyer_id: string | null; recipient_phone: string | null; status: string; expires_at: string; rules_json: string | null; activation_attempts: number }
      | undefined;
    if (!gp) throw notFound('Ten kod nie pasuje do żadnej wejściówki.');
    if (gp.activation_attempts >= 5) throw new HttpError(429, 'redeem_locked', 'Za dużo prób aktywacji tej wejściówki. Skontaktuj się ze studiem.');
    if (gp.recipient_phone && gp.recipient_phone !== user.phone) {
      db.prepare('UPDATE guest_passes SET activation_attempts = activation_attempts + 1 WHERE id = ?').run(gp.id);
      throw conflict('wrong_recipient', 'Ta wejściówka jest przypisana do innego numeru telefonu.');
    }
    if (gp.status !== 'sent') throw conflict('used', 'Ta wejściówka została już aktywowana.');
    if (Date.parse(gp.expires_at) < now) throw conflict('expired', 'Ta wejściówka wygasła.');
    if (gp.buyer_id === user.id) throw conflict('own_pass', 'To Twój prezent dla znajomej – przekaż jej kod.');

    const studio = loadStudio(db, gp.studio_id);
    activateGuestPass(new StudioScope(db, studio.id), studio, gp, { id: user.id, name: user.name }, new Date(now));
    return { studio: { id: studio.id, name: studio.name }, message: `Prezent odebrany! Masz wejście do ${studio.name}.` };
  });

  // ——— Katalog studiów (T12, v2): tylko studia, które chcą być widoczne ———

  app.get<{ Querystring: { city?: string; q?: string } }>('/api/catalog', async (req) => {
    const rows = db
      .prepare(
        `SELECT s.id, s.name, s.city, s.tagline, s.logo, s.logo_mime, s.logo_ratio, s.logo_version,
                (SELECT ROUND(AVG(rating), 1) FROM studio_reviews r WHERE r.studio_id = s.id) AS rating,
                (SELECT COUNT(*) FROM studio_reviews r WHERE r.studio_id = s.id) AS reviews,
                (SELECT group_concat(DISTINCT name) FROM class_types c WHERE c.studio_id = s.id) AS classes
         FROM studios s WHERE s.catalog_visible = 1 AND s.status != 'suspended' AND s.published = 1 ORDER BY s.name`,
      )
      .all() as { id: string; name: string; city: string | null; classes: string | null; logo_mime: string | null; logo_ratio: number | null; logo_version: number }[];
    const q = (req.query.q ?? '').toLowerCase();
    const city = (req.query.city ?? '').toLowerCase();
    return rows
      .filter((r) => (!city || (r.city ?? '').toLowerCase().includes(city)) && (!q || `${r.name} ${r.classes ?? ''}`.toLowerCase().includes(q)))
      .map(({ logo_mime, logo_ratio, logo_version, ...r }) => ({ ...r, classes: r.classes?.split(',') ?? [], ...logoInfo({ id: r.id, logo_mime, logo_ratio, logo_version }) }));
  });

  app.post<{ Params: { id: string } }>('/api/catalog/:id/join', auth, async (req) => {
    const s = db.prepare('SELECT id, name FROM studios WHERE id = ? AND catalog_visible = 1').get(req.params.id) as { id: string; name: string } | undefined;
    if (!s) throw notFound('Tego studia nie ma w katalogu.');
    db.prepare("INSERT OR IGNORE INTO memberships (studio_id, user_id, role, joined_at) VALUES (?, ?, 'client', ?)").run(s.id, me(req).id, nowIso());
    return { studio: s };
  });

  app.put<{ Params: { id: string }; Body: { rating: number; body?: string } }>('/api/catalog/:id/review', auth, async (req) => {
    const member = db.prepare("SELECT 1 FROM memberships WHERE studio_id = ? AND user_id = ? AND role = 'client'").get(req.params.id, me(req).id);
    if (!member) throw notFound();
    const r = req.body?.rating;
    if (!Number.isInteger(r) || r < 1 || r > 5) throw badRequest('Ocena od 1 do 5.');
    db.prepare('INSERT OR REPLACE INTO studio_reviews (studio_id, user_id, rating, body, created_at) VALUES (?, ?, ?, ?, ?)').run(req.params.id, me(req).id, r, req.body.body?.slice(0, 500) ?? null, nowIso());
    return { ok: true };
  });

  // ——— Dziennik nastroju i energii (#23) – prywatny, zaszyfrowany, wymaga zgody na dane zdrowotne ———

  const requireHealthConsent = (uid: string) => {
    const c = db.prepare("SELECT granted FROM consents WHERE user_id = ? AND studio_id = '' AND kind = 'health'").get(uid) as { granted: number } | undefined;
    if (!c?.granted) throw new HttpError(403, 'consent_required', 'Dziennik wymaga Twojej zgody na przechowywanie danych o samopoczuciu.');
  };

  app.get<{ Querystring: { week?: string } }>('/api/me/journal', auth, async (req) => {
    const uid = me(req).id;
    requireHealthConsent(uid);
    const today = localParts(new Date()).date;
    const from = weekStart(req.query.week && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week) ? req.query.week : today);
    const rows = db.prepare('SELECT date, data_enc FROM journal_entries WHERE user_id = ? AND date >= ? AND date < ? ORDER BY date').all(uid, from, addDays(from, 7)) as { date: string; data_enc: string }[];
    const entries = rows.map((r) => ({ date: r.date, ...(unseal<Omit<JournalEntry, 'date'>>(r.data_enc) ?? { mood: 3, energy: 3, sleep: 3 }) }));
    return { week: from, entries, summary: journalWeek(entries) };
  });

  app.put<{ Params: { date: string }; Body: Omit<JournalEntry, 'date'> }>('/api/me/journal/:date', auth, async (req) => {
    const uid = me(req).id;
    requireHealthConsent(uid);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) throw badRequest('Nieprawidłowa data.');
    const err = validEntry(req.body ?? {});
    if (err) throw badRequest(err);
    const data = { mood: req.body.mood, energy: req.body.energy, sleep: req.body.sleep, gratitude: req.body.gratitude?.trim() || undefined };
    db.prepare('INSERT OR REPLACE INTO journal_entries (user_id, date, data_enc, created_at) VALUES (?, ?, ?, ?)').run(uid, req.params.date, seal(data), nowIso());
    return { ok: true };
  });

  // ——— Moduł cyklu (#37) – odrębna zgoda (art. 9), tylko sugestie ogólne ———

  app.get('/api/me/cycle', auth, async (req) => {
    const uid = me(req).id;
    const c = db.prepare("SELECT granted FROM consents WHERE user_id = ? AND studio_id = '' AND kind = 'cycle'").get(uid) as { granted: number } | undefined;
    if (!c?.granted) return { consent: false };
    const rows = db.prepare('SELECT start_date, data_enc FROM cycle_entries WHERE user_id = ? ORDER BY start_date DESC LIMIT 6').all(uid) as { start_date: string; data_enc: string }[];
    const entries = rows.map((r) => ({ start: r.start_date, ...(unseal<{ length: number }>(r.data_enc) ?? { length: 28 }) }));
    const last = entries[0];
    const today = localParts(new Date()).date;
    const phase = last ? cyclePhase(last.start, today, last.length) : null;
    return { consent: true, entries, today: phase ? { ...phase, ...CYCLE_SUGGESTION[phase.phase] } : null };
  });

  app.post<{ Body: { start: string; length?: number } }>('/api/me/cycle', auth, async (req) => {
    const uid = me(req).id;
    const c = db.prepare("SELECT granted FROM consents WHERE user_id = ? AND studio_id = '' AND kind = 'cycle'").get(uid) as { granted: number } | undefined;
    if (!c?.granted) throw new HttpError(403, 'consent_required', 'Moduł cyklu wymaga osobnej zgody.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body?.start ?? '')) throw badRequest('Podaj datę.');
    const length = req.body.length ?? 28;
    if (!Number.isInteger(length) || length < 20 || length > 45) throw badRequest('Długość cyklu od 20 do 45 dni.');
    db.prepare('INSERT OR REPLACE INTO cycle_entries (user_id, start_date, data_enc) VALUES (?, ?, ?)').run(uid, req.body.start, seal({ length }));
    return { ok: true };
  });

  // ——— Quiz „Mój styl dnia” (G3) ———

  app.post<{ Body: QuizAnswers }>('/api/me/quiz', auth, async (req) => {
    const a = req.body;
    const valid =
      ['morning', 'afternoon', 'evening'].includes(a?.dayPart) &&
      ['low', 'medium', 'high'].includes(a?.energy) &&
      [15, 30, 45].includes(a?.minutes) &&
      ['energy', 'strength', 'stretch', 'calm', 'recovery'].includes(a?.goal) &&
      ['none', 'gentle', 'daily'].includes(a?.reminders);
    if (!valid) throw badRequest('Odpowiedz na wszystkie pytania albo pomiń quiz.');
    const u = me(req);
    const result = quizResult(a);
    const prefs: UserPrefs = { ...prefsOf(u), quiz: { answers: a, takenAt: nowIso() }, reminderTime: a.reminders === 'daily' ? result.reminderTime : a.reminders === 'gentle' ? null : null, eveningDays: a.reminders === 'gentle' ? [2, 4] : prefsOf(u).eveningDays };
    db.prepare('UPDATE users SET prefs_json = ? WHERE id = ?').run(JSON.stringify(prefs), u.id);
    // Trenerka widzi tylko zadeklarowany cel (4.12.2) – zapisujemy go w członkostwach klientki.
    db.prepare("UPDATE memberships SET goal = COALESCE(goal, ?) WHERE user_id = ? AND role = 'client'").run(result.goalLabel, u.id);
    return { result };
  });

  // ——— „7 dni spokoju” (4.4) ———

  app.get('/api/me/calm7', auth, async (req) => {
    const rows = db.prepare("SELECT day, done_at FROM course_mini_progress WHERE user_id = ? AND program = 'calm7'").all(me(req).id) as { day: number; done_at: string }[];
    const today = localParts(new Date()).date;
    const done = rows.map((r) => ({ day: r.day, doneOn: localParts(new Date(r.done_at)).date }));
    return { ...CALM_7, days: CALM_7.days.map((d) => ({ ...d, done: done.some((x) => x.day === d.day), unlocked: calmDayUnlocked(done, d.day, today) })) };
  });

  app.post<{ Params: { day: string } }>('/api/me/calm7/:day', auth, async (req) => {
    const day = Number(req.params.day);
    const rows = db.prepare("SELECT day, done_at FROM course_mini_progress WHERE user_id = ? AND program = 'calm7'").all(me(req).id) as { day: number; done_at: string }[];
    const today = localParts(new Date()).date;
    if (!calmDayUnlocked(rows.map((r) => ({ day: r.day, doneOn: localParts(new Date(r.done_at)).date })), day, today)) throw conflict('locked', 'Ten dzień odblokuje się jutro. Spokojnie, po kolei.');
    db.prepare("INSERT OR IGNORE INTO course_mini_progress (user_id, program, day, done_at) VALUES (?, 'calm7', ?, ?)").run(me(req).id, day, nowIso());
    return { ok: true };
  });

  // ——— Integracje: muzyka (G5). Bez Apple Health / Google Fit – decyzja 17.10.2026: bez sensorów zdrowia. ———

  app.get('/api/me/integrations', auth, async (req) => ({
    music: db.prepare('SELECT provider, label, connected_at FROM music_accounts WHERE user_id = ?').all(me(req).id),
  }));

  // Logowanie u dostawcy przez OAuth – my nie przechowujemy haseł. Bez skonfigurowanego klienta: tryb demo.
  app.post<{ Params: { provider: string } }>('/api/me/music/:provider', auth, async (req) => {
    const provider = req.params.provider;
    if (!['spotify', 'apple'].includes(provider)) throw notFound();
    const clientId = provider === 'spotify' ? process.env.SPOTIFY_CLIENT_ID : process.env.APPLE_MUSIC_TEAM_ID;
    if (clientId && provider === 'spotify') {
      const state = crypto.randomUUID();
      const redirect = `${deps.publicUrl ?? ''}/api/music/spotify/callback`;
      return { authorizeUrl: `https://accounts.spotify.com/authorize?response_type=code&client_id=${clientId}&scope=playlist-read-private%20playlist-modify-public&redirect_uri=${encodeURIComponent(redirect)}&state=${state}` };
    }
    db.prepare('INSERT OR REPLACE INTO music_accounts (user_id, provider, token_enc, label, connected_at) VALUES (?, ?, NULL, ?, ?)').run(me(req).id, provider, provider === 'spotify' ? 'Spotify' : 'Apple Music', nowIso());
    return { connected: true };
  });
  app.delete<{ Params: { provider: string } }>('/api/me/music/:provider', auth, async (req) => {
    db.prepare('DELETE FROM music_accounts WHERE user_id = ? AND provider = ?').run(me(req).id, req.params.provider);
    return { ok: true };
  });
}

export function guestRules(validityDays: number, entries: number, classTypeIds: string[] | 'all' = 'all'): ProductRules {
  return { validityDays, pools: [{ id: 'guest', label: 'Wejściówka', entries, classTypeIds }] };
}

/** Wejściówka → karnet obdarowanej i członkostwo w studiu (aktywacja w aplikacji albo w recepcji). */
export function activateGuestPass(
  scope: StudioScope,
  studio: Studio,
  gp: { id: string; buyer_id: string | null; rules_json: string | null },
  user: { id: string; name: string | null },
  now = new Date(),
) {
  const rules = (gp.rules_json ? JSON.parse(gp.rules_json) : guestRules(studio.settings.guestPass.validityDays, 1)) as ProductRules;
  scope.tx(() => {
    scope.run("INSERT OR IGNORE INTO memberships (studio_id, user_id, role, joined_at) VALUES ($studio, $user, 'client', $now)", { user: user.id, now: nowIso() });
    const v = passValidity(rules, now);
    const passId = issuePass(scope, { userId: user.id, versionId: null, name: 'Wejściówka od znajomej', rules, balances: initialBalances(rules), validFrom: v.validFrom, validUntil: v.validUntil, source: 'guest_pass' });
    scope.run("UPDATE guest_passes SET status = 'activated', pass_id = $pass, activated_by = $user WHERE studio_id = $studio AND id = $id", { pass: passId, user: user.id, id: gp.id });
    if (gp.buyer_id) {
      notify(scope, { userId: gp.buyer_id, category: 'community', tz: studio.timezone, body: `${user.name ?? 'Twoja znajoma'} odebrała Twój prezent 💛`, action: 'community/invites' });
    }
  });
}

export function publicUser(u: AuthUser) {
  const prefs = prefsOf(u);
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    email: u.email,
    birthday: u.birthday,
    nameday: u.nameday,
    themeOptOut: !!u.theme_opt_out,
    needQuiet: !!u.need_quiet,
    restToday: u.rest_day === new Date().toISOString().slice(0, 10),
    quietFrom: u.quiet_from,
    quietTo: u.quiet_to,
    pushDisabled: JSON.parse(u.push_disabled_json) as string[],
    prefs,
    hasAddress: !!u.address_enc,
    address: unseal(u.address_enc),
    avatarUrl: u.avatar_mime ? `/api/users/${u.id}/avatar?v=${u.avatar_version}` : null,
    onboarded: !!u.onboarded_at,
  };
}
