// Samoobsługowa rejestracja studia z okresem próbnym (1.2.6, T6) i weryfikacja e-maila właścicielki.
import type { FastifyInstance } from 'fastify';
import { PRESETS, TRIAL_DAYS, planById, validEmail, validNip } from '@glam/core';
import { checkOtp, createSession, normalizePhone } from '../../auth.ts';
import type { Deps } from '../../context.ts';
import { id, nowIso, tx } from '../../db.ts';
import { badRequest, notFound } from '../../errors.ts';
import { StudioScope } from '../../scope.ts';
import { applyPreset } from '../../services/presets.ts';
import { loadStudio } from '../../services/studio.ts';
import { guestCode } from '../client.ts';

export function signupRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;

  // ——— Samoobsługowa rejestracja studia (1.2.6, T6) ———
  // Krok 1: numer telefonu właścicielki – kod SMS z /api/auth/request-code. Krok 2: dane studia + kod.

  app.post<{ Body: { studioName: string; nip?: string; city?: string; ownerName: string; phone: string; code: string; email: string; presetId?: string; planId?: string; acceptTerms: boolean } }>('/api/signup/studio', async (req) => {
    const b = req.body ?? ({} as typeof req.body);
    if (!b.acceptTerms) throw badRequest('Zaakceptuj regulamin platformy i umowę powierzenia danych (DPA).');
    if (!b.studioName?.trim() || b.studioName.trim().length < 2) throw badRequest('Podaj nazwę studia.');
    if (!b.ownerName?.trim()) throw badRequest('Podaj imię i nazwisko właścicielki.');
    if (!validEmail(b.email ?? '')) throw badRequest('Podaj poprawny e-mail – wyślemy na niego link weryfikacyjny.');
    if (b.nip && !validNip(b.nip)) throw badRequest('Sprawdź NIP (10 cyfr z sumą kontrolną).');
    const phone = normalizePhone(b.phone);
    checkOtp(db, phone, b.code);
    const plan = planById(b.planId);
    const slugBase = b.studioName.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'studio';
    const studioId = `st_${id().slice(0, 8)}`;
    const result = tx(db, () => {
      let user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
      if (!user) {
        user = { id: id() };
        db.prepare('INSERT INTO users (id, phone, name, email, onboarded_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, phone, b.ownerName.trim(), b.email, nowIso(), nowIso());
      }
      let slug = slugBase;
      for (let i = 2; db.prepare('SELECT 1 FROM studios WHERE slug = ?').get(slug); i++) slug = `${slugBase}-${i}`;
      let invite = guestCode(6);
      while (db.prepare('SELECT 1 FROM studios WHERE invite_code = ?').get(invite)) invite = guestCode(6);
      db.prepare(
        `INSERT INTO studios (id, name, slug, invite_code, city, email, nip, logo, policy_json, plan_id, status, trial_ends_at, published, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trial', ?, 0, ?)`,
      ).run(
        studioId,
        b.studioName.trim().slice(0, 60),
        slug,
        invite,
        b.city?.trim() || null,
        b.email,
        b.nip?.replace(/[\s-]/g, '') || null,
        b.studioName.trim().charAt(0).toUpperCase(),
        JSON.stringify({ opensDaysAhead: 14, closesMinutesBefore: 120, cancelMinutesBefore: 120, waitlist: true }),
        plan.id,
        new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
        nowIso(),
      );
      db.prepare("INSERT INTO memberships (studio_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(studioId, user.id, nowIso());
      db.prepare("INSERT INTO studio_billing (studio_id, state, updated_at) VALUES (?, 'none', ?)").run(studioId, nowIso());
      db.prepare("INSERT INTO facilities (id, studio_id, name) VALUES (?, ?, ?)").run(id(), studioId, b.studioName.trim());
      return { userId: user.id, invite };
    });
    // Weryfikacja e-maila: link z jednorazowym tokenem.
    const token = id().replace(/-/g, '');
    db.prepare("INSERT INTO platform_settings (key, value) VALUES (?, ?)").run(`email-verify:${token}`, JSON.stringify({ userId: result.userId, email: b.email }));
    await deps.email?.send(b.email, 'Potwierdź e-mail – GLAM', `Witaj w GLAM! Potwierdź adres: ${deps.publicUrl ?? ''}/api/signup/verify-email/${token}`);
    const preset = PRESETS.find((p) => p.id === b.presetId);
    // Szablon branżowy od razu – kreator prowadzi dalej przez harmonogram, płatności i publikację.
    if (preset) applyPreset(new StudioScope(db, studioId), loadStudio(db, studioId), preset);
    return { studioId, token: createSession(db, result.userId, Date.now(), 'signup'), inviteCode: result.invite, trialDays: TRIAL_DAYS, message: `Studio założone. Masz ${TRIAL_DAYS} dni okresu próbnego.` };
  });

  app.get<{ Params: { token: string } }>('/api/signup/verify-email/:token', async (req, reply) => {
    const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(`email-verify:${req.params.token}`) as { value: string } | undefined;
    if (!row) throw notFound('Link wygasł albo był już użyty.');
    const { userId, email } = JSON.parse(row.value) as { userId: string; email: string };
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
    db.prepare('DELETE FROM platform_settings WHERE key = ?').run(`email-verify:${req.params.token}`);
    return reply.header('content-type', 'text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><title>GLAM</title><p style="font:16px system-ui;margin:40px">E-mail potwierdzony. Możesz wrócić do panelu studia.</p>');
  });
}
