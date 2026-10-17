// Kreator i konfiguracja obiektu (1.1, C1–C11): obiekty, strefy, typy zajęć, harmonogram i wyjątki, regulamin
// rezerwacji, ustawienia studia, szablony branżowe, eksport i import konfiguracji, migracja klientek z CSV,
// konto testowe („zasymuluj zakup i rezerwację”), role i kwalifikacje, bramka płatności, white-label.
import type { FastifyInstance } from 'fastify';
import {
  addDays,
  cleanAudience,
  initialBalances,
  LEVEL_TEXT,
  localParts,
  parseCsv,
  PRESETS,
  resolveLook,
  resolveSettings,
  validateLook,
  validateRules,
  validEmail,
  validNip,
  zonedToUtc,
  type BookingPolicy,
  type Look,
  type ProductRules,
  type Role,
} from '@glam/core';
import { createSession, normalizePhone } from '../auth.ts';
import { ctx, requirePerm, requireStudio, type Deps } from '../context.ts';
import { seal, unseal } from '../crypto.ts';
import { id, nowIso } from '../db.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { audit } from '../services/audit.ts';
import { issuePass } from '../services/passes.ts';
import { addException, createSlots, fillSchedule, removeSlot, updateSlot, type SlotPatch } from '../services/schedule.ts';
import { applyPreset } from '../services/presets.ts';
import { PHOTO_URL } from './client.ts';

const clean = (v: unknown, max = 120) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export function configRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const owner = { preHandler: requireStudio(db, ['owner']) };
  const scheduleEdit = requirePerm(db, 'schedule.edit');
  const blocks = requirePerm(db, 'blocks.edit');

  app.get('/api/owner/config', { preHandler: requireStudio(db, ['owner', 'reception', 'trainer', 'coordinator']) }, async (req) => {
    const { scope, studio, roles } = ctx(req);
    const isOwner = roles.includes('owner');
    const gateway = studio.has('split_payments') || isOwner ? unseal<{ provider: string; merchantId: string; apiKey: string; crc: string }>(scope.get<{ gateway_enc: string | null }>('SELECT gateway_enc FROM studios WHERE id = $studio')?.gateway_enc) : null;
    return {
      facilities: scope.all('SELECT * FROM facilities WHERE studio_id = $studio ORDER BY name'),
      zones: scope.all('SELECT * FROM zones WHERE studio_id = $studio ORDER BY name'),
      classTypes: scope.all<Record<string, unknown>>(`SELECT ct.id, ct.zone_id, ct.name, ct.level, ct.color, ct.description, ct.playlist_id, ct.audience_json, ${PHOTO_URL} FROM class_types ct WHERE ct.studio_id = $studio ORDER BY ct.name`).map(({ audience_json, ...c }) => ({
        ...c,
        audience: cleanAudience(audience_json ? JSON.parse(audience_json as string) : null, c.level as string),
      })),
      templates: scope.all(
        `SELECT t.*, ct.name AS class_name, u.name AS trainer_name FROM schedule_templates t
         JOIN class_types ct ON ct.id = t.class_type_id JOIN users u ON u.id = t.trainer_id
         WHERE t.studio_id = $studio AND t.valid_to IS NULL ORDER BY t.weekday, t.start_time`,
      ),
      exceptions: scope.all('SELECT * FROM schedule_exceptions WHERE studio_id = $studio ORDER BY date DESC LIMIT 40'),
      trainers: scope.all<{ id: string; name: string }>("SELECT u.id, u.name, MAX(m.bio) AS bio FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role IN ('trainer', 'owner') GROUP BY u.id ORDER BY u.name").map((t) => ({
        ...t,
        classTypeIds: scope.all<{ class_type_id: string }>('SELECT class_type_id FROM trainer_class_types WHERE studio_id = $studio AND trainer_id = $t', { t: t.id }).map((x) => x.class_type_id),
      })),
      policy: studio.policy,
      settings: isOwner ? studio.settings : undefined,
      regulations: studio.regulations,
      studio: isOwner
        ? { name: studio.name, tagline: studio.tagline, city: studio.city, phone: studio.phone, email: studio.email, address: studio.address, nip: studio.nip, foundedOn: studio.founded_on, catalogVisible: !!studio.catalog_visible, published: !!studio.published, welcomeApproval: !!studio.welcome_approval, inviteCode: studio.invite_code, timezone: studio.timezone, whiteLabel: studio.white_label_json ? JSON.parse(studio.white_label_json) : null }
        : undefined,
      gateway: gateway ? { provider: gateway.provider, merchantId: gateway.merchantId, apiKey: gateway.apiKey ? `••••${gateway.apiKey.slice(-4)}` : '', connected: true } : { connected: false },
      presets: PRESETS.map((p) => ({ id: p.id, label: p.label, description: p.description })),
    };
  });

  // ——— Obiekty, strefy, typy zajęć (C1, C3, C11) ———

  app.post<{ Body: { name: string; address?: string } }>('/api/owner/facilities', owner, async (req) => {
    const { scope, studio, user } = ctx(req);
    const n = scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM facilities WHERE studio_id = $studio')!.n;
    if (n >= 1 && !studio.has('network')) throw conflict('plan', 'Sieć obiektów (kilka lokali) jest w planie „Sieć”.');
    const fid = id();
    scope.run('INSERT INTO facilities (id, studio_id, name, address) VALUES ($id, $studio, $n, $a)', { id: fid, n: clean(req.body?.name, 80) || 'Nowy obiekt', a: clean(req.body?.address, 160) || null });
    audit(scope, { actorId: user.id, action: 'facility.created', entity: 'facility', entityId: fid });
    return { id: fid };
  });

  app.put<{ Params: { id: string }; Body: { name?: string; address?: string; hours?: Record<string, [string, string]> } }>('/api/owner/facilities/:id', owner, async (req) => {
    const { scope } = ctx(req);
    const r = scope.run('UPDATE facilities SET name = COALESCE($n, name), address = COALESCE($a, address), hours_json = COALESCE($h, hours_json) WHERE studio_id = $studio AND id = $id', {
      n: req.body?.name ? clean(req.body.name, 80) : null,
      a: req.body?.address !== undefined ? clean(req.body.address, 160) : null,
      h: req.body?.hours ? JSON.stringify(req.body.hours) : null,
      id: req.params.id,
    });
    if (!r.changes) throw notFound();
    return { ok: true };
  });

  app.post<{ Body: { facilityId: string; name: string; access: 'reserved' | 'open' | 'checkin' | 'mixed' } }>('/api/owner/zones', owner, async (req) => {
    const { scope, user } = ctx(req);
    if (!['reserved', 'open', 'checkin', 'mixed'].includes(req.body?.access)) throw badRequest('Wybierz typ dostępu do strefy.');
    if (!scope.get('SELECT 1 FROM facilities WHERE studio_id = $studio AND id = $f', { f: req.body.facilityId })) throw notFound('Nie znaleziono obiektu.');
    if (scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM zones WHERE studio_id = $studio')!.n >= 5 && !ctx(req).studio.has('network')) throw conflict('limit', 'Na start obsługujemy do 5 stref (pyt. 20). Więcej w planie „Sieć”.');
    const zid = id();
    scope.run('INSERT INTO zones (id, studio_id, facility_id, name, access) VALUES ($id, $studio, $f, $n, $a)', { id: zid, f: req.body.facilityId, n: clean(req.body.name, 60) || 'Strefa', a: req.body.access });
    audit(scope, { actorId: user.id, action: 'zone.created', entity: 'zone', entityId: zid });
    return { id: zid };
  });

  app.put<{ Params: { id: string }; Body: { name?: string; access?: string } }>('/api/owner/zones/:id', owner, async (req) => {
    const { scope } = ctx(req);
    if (req.body?.access && !['reserved', 'open', 'checkin', 'mixed'].includes(req.body.access)) throw badRequest('Nieprawidłowy typ dostępu.');
    scope.run('UPDATE zones SET name = COALESCE($n, name), access = COALESCE($a, access) WHERE studio_id = $studio AND id = $id', { n: req.body?.name ? clean(req.body.name, 60) : null, a: req.body?.access ?? null, id: req.params.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/owner/zones/:id', owner, async (req) => {
    const { scope } = ctx(req);
    if (scope.get('SELECT 1 FROM class_types WHERE studio_id = $studio AND zone_id = $z', { z: req.params.id })) throw conflict('in_use', 'W tej strefie są typy zajęć. Przenieś je najpierw.');
    scope.run('DELETE FROM zones WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    return { ok: true };
  });

  app.post<{ Body: { zoneId: string; name: string; level?: string; color?: string; description?: string; audience?: unknown } }>('/api/owner/class-types', owner, async (req) => {
    const { scope, user, studio } = ctx(req);
    if (!scope.get('SELECT 1 FROM zones WHERE studio_id = $studio AND id = $z', { z: req.body?.zoneId })) throw notFound('Nie znaleziono strefy.');
    if (scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM class_types WHERE studio_id = $studio')!.n >= 10 && !studio.has('network')) throw conflict('limit', 'Na start obsługujemy do 10 typów zajęć (pyt. 20).');
    const cid = id();
    // „Dla kogo” wybrane w panelu ustala też tekst poziomu, który widać w grafiku i na stronie.
    const aud = req.body.audience !== undefined ? cleanAudience(req.body.audience, req.body.level) : null;
    scope.run('INSERT INTO class_types (id, studio_id, zone_id, name, level, color, description, audience_json) VALUES ($id, $studio, $z, $n, $l, $c, $d, $a)', {
      id: cid,
      z: req.body.zoneId,
      n: clean(req.body.name, 60) || 'Zajęcia',
      l: aud ? LEVEL_TEXT[aud.level] : clean(req.body.level, 40) || 'wszystkie poziomy',
      a: aud ? JSON.stringify(aud) : null,
      c: /^#[0-9a-f]{6}$/i.test(req.body.color ?? '') ? req.body.color! : '#e8b4c4',
      d: clean(req.body.description, 300) || null,
    });
    audit(scope, { actorId: user.id, action: 'class_type.created', entity: 'class_type', entityId: cid });
    return { id: cid };
  });

  app.put<{ Params: { id: string }; Body: { name?: string; level?: string; description?: string; zoneId?: string; playlistId?: string | null; audience?: unknown } }>('/api/owner/class-types/:id', owner, async (req) => {
    const { scope } = ctx(req);
    const b = req.body ?? {};
    const aud = b.audience !== undefined ? cleanAudience(b.audience, b.level) : null;
    scope.run(
      `UPDATE class_types SET name = COALESCE($n, name), level = COALESCE($l, level), description = COALESCE($d, description), zone_id = COALESCE($z, zone_id),
       audience_json = COALESCE($a, audience_json), playlist_id = CASE WHEN $setp = 1 THEN $p ELSE playlist_id END WHERE studio_id = $studio AND id = $id`,
      { a: aud ? JSON.stringify(aud) : null, n: b.name ? clean(b.name, 60) : null, l: aud ? LEVEL_TEXT[aud.level] : b.level ? clean(b.level, 40) : null, d: b.description !== undefined ? clean(b.description, 300) : null, z: b.zoneId ?? null, setp: Number(b.playlistId !== undefined), p: b.playlistId ?? null, id: req.params.id },
    );
    return { ok: true };
  });

  // ——— Harmonogram cykliczny (C7) i wyjątki (#7) ———

  // Grafik ustawiany slotami: jedne zajęcia w kilku dniach naraz, zapis od razu uzupełnia sesje
  // (zmiana godziny nie tworzy dwóch sesji tego samego dnia – sesja z zapisami zostaje albo jest odwołana).
  app.post<{ Body: { classTypeId: string; trainerId: string; weekdays: number[]; startTime: string; durationMin: number; capacity: number } }>('/api/owner/templates', scheduleEdit, async (req) => {
    const { scope, studio, user } = ctx(req);
    const b = req.body ?? ({} as never);
    const res = createSlots(scope, studio, { ...b, weekdays: Array.isArray(b.weekdays) ? b.weekdays : [] });
    audit(scope, { actorId: user.id, action: 'template.created', entity: 'template', details: { weekdays: b.weekdays, startTime: b.startTime } });
    return res;
  });

  app.put<{ Params: { id: string }; Body: SlotPatch }>('/api/owner/templates/:id', scheduleEdit, async (req) => {
    const { scope, studio, user } = ctx(req);
    const res = updateSlot(scope, studio, req.params.id, req.body ?? {});
    audit(scope, { actorId: user.id, action: 'template.updated', entity: 'template', entityId: req.params.id, details: req.body as Record<string, unknown> });
    return res;
  });

  app.delete<{ Params: { id: string } }>('/api/owner/templates/:id', scheduleEdit, async (req) => {
    const { scope, studio, user } = ctx(req);
    const res = removeSlot(scope, studio, req.params.id);
    audit(scope, { actorId: user.id, action: 'template.removed', entity: 'template', entityId: req.params.id });
    return res;
  });

  app.post('/api/owner/schedule/fill', scheduleEdit, async (req) => {
    const { scope, studio } = ctx(req);
    return fillSchedule(scope, studio);
  });

  app.post<{ Body: { date: string; zoneId?: string | null; reason: string } }>('/api/owner/exceptions', blocks, async (req) => {
    const { scope, studio, user } = ctx(req);
    const b = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b?.date ?? '')) throw badRequest('Podaj datę.');
    if (!b.reason?.trim()) throw badRequest('Podaj powód (np. „Święto”, „Urlop”, „Remont sali”).');
    if (b.zoneId && !scope.get('SELECT 1 FROM zones WHERE studio_id = $studio AND id = $z', { z: b.zoneId })) throw notFound('Nie znaleziono strefy.');
    const r = addException(scope, studio, { date: b.date, zoneId: b.zoneId ?? null, reason: b.reason.trim() });
    audit(scope, { actorId: user.id, action: 'exception.added', entity: 'exception', details: { date: b.date, zoneId: b.zoneId, reason: b.reason } });
    return r;
  });

  app.delete<{ Params: { id: string } }>('/api/owner/exceptions/:id', blocks, async (req) => {
    const { scope, studio } = ctx(req);
    scope.run('DELETE FROM schedule_exceptions WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    fillSchedule(scope, studio);
    return { ok: true };
  });

  // ——— Regulamin rezerwacji, ustawienia studia, regulamin, dane studia ———

  app.put<{ Body: Partial<BookingPolicy> }>('/api/owner/policy', owner, async (req) => {
    const { scope, studio, user } = ctx(req);
    const p = { ...studio.policy, ...req.body };
    const ok = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
    if (!ok(p.opensDaysAhead, 1, 90) || !ok(p.closesMinutesBefore, 0, 1440) || !ok(p.cancelMinutesBefore, 0, 2880)) throw badRequest('Okno zapisu 1–90 dni, zamknięcie i odwołanie 0–48 h przed zajęciami.');
    scope.run('UPDATE studios SET policy_json = $p WHERE id = $studio', { p: JSON.stringify({ opensDaysAhead: p.opensDaysAhead, closesMinutesBefore: p.closesMinutesBefore, cancelMinutesBefore: p.cancelMinutesBefore, waitlist: !!p.waitlist }) });
    audit(scope, { actorId: user.id, action: 'policy.updated', entity: 'studio', details: p });
    return { policy: p };
  });

  app.put<{ Body: Record<string, unknown> }>('/api/owner/settings', owner, async (req) => {
    const { scope, user } = ctx(req);
    const current = scope.get<{ settings_json: string | null }>('SELECT settings_json FROM studios WHERE id = $studio')!;
    const merged = { ...(current.settings_json ? JSON.parse(current.settings_json) : {}), ...(req.body ?? {}) };
    const s = resolveSettings(merged);
    if (s.loyalty.levels.length < 2 || s.loyalty.levels[0].minPoints !== 0) throw badRequest('Poziomy lojalności: co najmniej dwa, pierwszy od 0 punktów.');
    if (s.tenClassReward.every < 1 || s.tenClassReward.every > 100) throw badRequest('Nagroda: co od 1 do 100 treningów.');
    if (s.guestPass.variants.some((v) => !(v.priceGrosze >= 0) || !(v.entries >= 1) || !v.label)) throw badRequest('Każda wejściówka potrzebuje nazwy, ceny i liczby wejść.');
    if (s.invoice.vatRate < 0 || s.invoice.vatRate > 23) throw badRequest('Stawka VAT od 0 do 23%.');
    if (s.commissionPct < 0 || s.commissionPct > 30) throw badRequest('Prowizja od 0 do 30%.');
    scope.run('UPDATE studios SET settings_json = $s WHERE id = $studio', { s: JSON.stringify(merged) });
    audit(scope, { actorId: user.id, action: 'settings.updated', entity: 'studio', details: { keys: Object.keys(req.body ?? {}) } });
    return { settings: s };
  });

  app.put<{ Body: { regulations: string } }>('/api/owner/regulations', owner, async (req) => {
    const { scope, user } = ctx(req);
    const text = String(req.body?.regulations ?? '').trim();
    if (text.length > 20_000) throw badRequest('Regulamin może mieć najwyżej 20 000 znaków.');
    scope.run('UPDATE studios SET regulations = $r WHERE id = $studio', { r: text || null });
    audit(scope, { actorId: user.id, action: 'regulations.updated', entity: 'studio' });
    return { ok: true };
  });

  app.put<{ Body: { name?: string; tagline?: string | null; city?: string | null; phone?: string | null; email?: string | null; address?: string | null; nip?: string | null; foundedOn?: string | null; catalogVisible?: boolean; published?: boolean; welcomeApproval?: boolean; whiteLabel?: Record<string, string> | null } }>(
    '/api/owner/studio',
    owner,
    async (req) => {
      const { scope, studio, user } = ctx(req);
      const b = req.body ?? {};
      const name = b.name !== undefined ? clean(b.name, 60) : studio.name;
      if (name.length < 2) throw badRequest('Nazwa studia powinna mieć od 2 do 60 znaków.');
      if (b.tagline && b.tagline.length > 120) throw badRequest('Hasło może mieć najwyżej 120 znaków.');
      if (b.email && !validEmail(b.email)) throw badRequest('Sprawdź adres e-mail.');
      if (b.nip && !validNip(b.nip)) throw badRequest('Sprawdź NIP (10 cyfr).');
      if (b.foundedOn && !/^\d{4}-\d{2}-\d{2}$/.test(b.foundedOn)) throw badRequest('Data założenia w formacie RRRR-MM-DD.');
      if (b.catalogVisible && !studio.has('catalog')) throw conflict('plan', 'Katalog studiów jest w planie „Studio” i wyższych.');
      if (b.whiteLabel && !studio.has('white_label')) throw conflict('plan', 'White-label jest w planie „Sieć” (po wycenie).');
      // Litera zastępcza (gdy nie ma wgranego logo) idzie za nową nazwą.
      scope.run(
        `UPDATE studios SET name = $name, logo = $letter, tagline = $tagline, city = $city, phone = $phone, email = $email, address = $address, nip = $nip,
         founded_on = $founded, catalog_visible = $cat, published = $pub, welcome_approval = $wa, white_label_json = $wl WHERE id = $studio`,
        {
          name,
          letter: name.charAt(0).toLocaleUpperCase('pl-PL'),
          tagline: b.tagline !== undefined ? clean(b.tagline) || null : studio.tagline,
          city: b.city !== undefined ? clean(b.city, 60) || null : studio.city,
          phone: b.phone !== undefined ? clean(b.phone, 30) || null : studio.phone,
          email: b.email !== undefined ? b.email || null : studio.email,
          address: b.address !== undefined ? clean(b.address, 160) || null : studio.address,
          nip: b.nip !== undefined ? b.nip?.replace(/[\s-]/g, '') || null : studio.nip,
          founded: b.foundedOn !== undefined ? b.foundedOn : studio.founded_on,
          cat: Number(b.catalogVisible ?? !!studio.catalog_visible),
          pub: Number(b.published ?? !!studio.published),
          wa: Number(b.welcomeApproval ?? !!studio.welcome_approval),
          wl: b.whiteLabel !== undefined ? (b.whiteLabel ? JSON.stringify(b.whiteLabel) : null) : studio.white_label_json,
        },
      );
      audit(scope, { actorId: user.id, action: 'studio.updated', entity: 'studio', details: { keys: Object.keys(b) } });
      return { name, logo: name.charAt(0).toLocaleUpperCase('pl-PL') };
    },
  );

  // Wygląd studia (T4): paleta, czcionki, miękkość. Walidacja tym samym rejestrem co w aplikacji.
  app.put<{ Body: Partial<Look> }>('/api/owner/look', owner, async (req) => {
    const { scope, studio } = ctx(req);
    const look = resolveLook({ ...studio.look, ...req.body, fonts: { ...studio.look.fonts, ...(req.body?.fonts ?? {}) }, logo: { ...studio.look.logo, ...(req.body?.logo ?? {}) } });
    const errors = validateLook(look);
    if (errors.length) throw badRequest(errors[0], { errors });
    scope.run('UPDATE studios SET look_json = $look WHERE id = $studio', { look: JSON.stringify(look) });
    return { look };
  });

  // Bramka płatności studia (decyzja 23): klucze trzymamy zaszyfrowane, pokazujemy tylko końcówkę.
  app.put<{ Body: { provider: 'p24' | 'stripe' | 'payu' | 'tpay'; merchantId: string; apiKey: string; crc?: string } }>('/api/owner/gateway', owner, async (req) => {
    const { scope, user } = ctx(req);
    const b = req.body;
    if (!['p24', 'stripe', 'payu', 'tpay'].includes(b?.provider) || !b.merchantId?.trim() || !b.apiKey?.trim()) throw badRequest('Podaj dostawcę, identyfikator sprzedawcy i klucz API.');
    scope.run('UPDATE studios SET gateway_enc = $g WHERE id = $studio', { g: seal({ provider: b.provider, merchantId: b.merchantId.trim(), apiKey: b.apiKey.trim(), crc: b.crc?.trim() ?? '' }) });
    audit(scope, { actorId: user.id, action: 'gateway.connected', entity: 'studio', details: { provider: b.provider } });
    return { ok: true, webhook: `${deps.publicUrl ?? ''}/api/payments/webhook/${scope.studioId}` };
  });

  // ——— Szablony branżowe (C6) ———

  app.post<{ Params: { id: string } }>('/api/owner/presets/:id/apply', owner, async (req) => {
    const { scope, studio, user } = ctx(req);
    const preset = PRESETS.find((p) => p.id === req.params.id);
    if (!preset) throw notFound('Nie ma takiego szablonu.');
    const created = applyPreset(scope, studio, preset);
    audit(scope, { actorId: user.id, action: 'preset.applied', entity: 'studio', details: { preset: preset.id } });
    return { ...created, message: `Szablon „${preset.label}” dodany. Teraz ustaw harmonogram i sprawdź podgląd klientki.` };
  });

  // ——— Eksport i import konfiguracji (C10) – np. do drugiego obiektu sieci ———

  app.get('/api/owner/config/export', owner, async (req, reply) => {
    const { scope, studio } = ctx(req);
    const data = {
      version: 1,
      exportedAt: nowIso(),
      policy: studio.policy,
      settings: scope.get<{ s: string | null }>('SELECT settings_json AS s FROM studios WHERE id = $studio')!.s ? JSON.parse(scope.get<{ s: string }>('SELECT settings_json AS s FROM studios WHERE id = $studio')!.s) : {},
      look: studio.look,
      regulations: studio.regulations,
      zones: scope.all('SELECT id, name, access FROM zones WHERE studio_id = $studio'),
      classTypes: scope.all('SELECT id, zone_id, name, level, color, description FROM class_types WHERE studio_id = $studio'),
      products: scope.all<{ name: string; description: string | null; channels_json: string; price_grosze: number; rules_json: string }>(
        'SELECT p.name, p.description, p.channels_json, v.price_grosze, v.rules_json FROM products p JOIN product_versions v ON v.id = p.current_version_id WHERE p.studio_id = $studio AND p.published = 1',
      ).map((p) => ({ name: p.name, description: p.description, channels: JSON.parse(p.channels_json), priceGrosze: p.price_grosze, rules: JSON.parse(p.rules_json) })),
      templates: scope.all('SELECT class_type_id, weekday, start_time, duration_min, capacity FROM schedule_templates WHERE studio_id = $studio AND (valid_to IS NULL OR valid_to >= date())'),
    };
    return reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="${studio.slug}-konfiguracja.json"`).send(JSON.stringify(data, null, 2));
  });

  app.post<{ Body: { config: any; trainerId?: string } }>('/api/owner/config/import', { ...owner, bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const { scope, studio, user } = ctx(req);
    const c = req.body?.config;
    if (!c || c.version !== 1 || !Array.isArray(c.zones)) throw badRequest('To nie jest plik konfiguracji GLAM.');
    const trainerId = req.body.trainerId ?? scope.get<{ user_id: string }>("SELECT user_id FROM memberships WHERE studio_id = $studio AND role = 'trainer' LIMIT 1")?.user_id;
    const res = scope.tx(() => {
      let facility = scope.get<{ id: string }>('SELECT id FROM facilities WHERE studio_id = $studio LIMIT 1')?.id;
      if (!facility) {
        facility = id();
        scope.run('INSERT INTO facilities (id, studio_id, name) VALUES ($id, $studio, $n)', { id: facility, n: studio.name });
      }
      const zoneMap: Record<string, string> = {};
      for (const z of c.zones) {
        zoneMap[z.id] = id();
        scope.run('INSERT INTO zones (id, studio_id, facility_id, name, access) VALUES ($id, $studio, $f, $n, $a)', { id: zoneMap[z.id], f: facility, n: clean(z.name, 60), a: ['reserved', 'open', 'checkin', 'mixed'].includes(z.access) ? z.access : 'reserved' });
      }
      const ctMap: Record<string, string> = {};
      for (const t of c.classTypes ?? []) {
        ctMap[t.id] = id();
        scope.run('INSERT INTO class_types (id, studio_id, zone_id, name, level, color, description) VALUES ($id, $studio, $z, $n, $l, $c, $d)', { id: ctMap[t.id], z: zoneMap[t.zone_id], n: clean(t.name, 60), l: clean(t.level, 40), c: t.color ?? '#e8b4c4', d: clean(t.description, 300) || null });
      }
      const remap = (s: string) => Object.entries({ ...zoneMap, ...ctMap }).reduce((acc, [from, to]) => acc.split(`"${from}"`).join(`"${to}"`), s);
      let products = 0;
      for (const p of c.products ?? []) {
        const rules = JSON.parse(remap(JSON.stringify(p.rules))) as ProductRules;
        if (validateRules(rules).length) continue;
        const pid = id();
        const vid = id();
        scope.run('INSERT INTO products (id, studio_id, name, description, channels_json, sort) VALUES ($id, $studio, $n, $d, $ch, (SELECT COALESCE(MAX(sort), 0) + 1 FROM products WHERE studio_id = $studio))', { id: pid, n: clean(p.name, 80), d: p.description ?? null, ch: JSON.stringify(p.channels ?? ['app', 'desk']) });
        scope.run('INSERT INTO product_versions (id, studio_id, product_id, version, price_grosze, rules_json, created_at) VALUES ($id, $studio, $p, 1, $price, $r, $now)', { id: vid, p: pid, price: p.priceGrosze, r: JSON.stringify(rules), now: nowIso() });
        scope.run('UPDATE products SET current_version_id = $v WHERE studio_id = $studio AND id = $id', { v: vid, id: pid });
        products++;
      }
      let templates = 0;
      if (trainerId) {
        for (const t of c.templates ?? []) {
          if (!ctMap[t.class_type_id]) continue;
          scope.run("INSERT INTO schedule_templates (id, studio_id, class_type_id, trainer_id, weekday, start_time, duration_min, capacity, valid_from) VALUES ($id, $studio, $c, $t, $w, $s, $d, $cap, date())", { id: id(), c: ctMap[t.class_type_id], t: trainerId, w: t.weekday, s: t.start_time, d: t.duration_min, cap: t.capacity });
          templates++;
        }
      }
      if (c.policy) scope.run('UPDATE studios SET policy_json = $p WHERE id = $studio', { p: JSON.stringify(c.policy) });
      if (c.settings) scope.run('UPDATE studios SET settings_json = $s WHERE id = $studio', { s: JSON.stringify(c.settings) });
      return { zones: c.zones.length, classTypes: (c.classTypes ?? []).length, products, templates };
    });
    fillSchedule(scope, studio);
    audit(scope, { actorId: user.id, action: 'config.imported', entity: 'studio', details: res });
    return res;
  });

  // Migracja z obecnego systemu (1.2.6): CSV z klientkami i stanem karnetów (telefon, imię, e-mail, karnet, wejścia, ważny_do).
  app.post<{ Body: { csv: string; dryRun?: boolean } }>('/api/owner/import/clients', { ...owner, bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const { scope, user } = ctx(req);
    const rows = parseCsv(String(req.body?.csv ?? ''));
    if (!rows.length) throw badRequest('Plik jest pusty albo nie ma nagłówka (telefon; imię; e-mail; karnet; wejścia; ważny_do).');
    const pick = (r: Record<string, string>, ...keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== '') ?? '';
    const report = { clients: 0, passes: 0, errors: [] as string[] };
    const work = () => {
      rows.forEach((r, i) => {
        try {
          const phone = normalizePhone(pick(r, 'telefon', 'phone', 'numer'));
          const name = pick(r, 'imię', 'imie', 'name', 'imię i nazwisko');
          const email = pick(r, 'e-mail', 'email', 'mail');
          let u = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
          if (!u) {
            u = { id: id() };
            db.prepare('INSERT INTO users (id, phone, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(u.id, phone, name || null, email && validEmail(email) ? email : null, nowIso());
          }
          const added = scope.run("INSERT OR IGNORE INTO memberships (studio_id, user_id, role, joined_at) VALUES ($studio, $u, 'client', $now)", { u: u.id, now: nowIso() });
          if (added.changes) report.clients++;
          const passName = pick(r, 'karnet', 'pass', 'produkt');
          const entries = Number(pick(r, 'wejścia', 'wejscia', 'entries', 'pozostało'));
          const until = pick(r, 'ważny_do', 'wazny_do', 'valid_until', 'ważny do');
          if (passName && /^\d{4}-\d{2}-\d{2}$/.test(until) && until >= localParts(new Date()).date) {
            const rules: ProductRules = entries > 0 ? { validityDays: 365, pools: [{ id: 'import', label: passName, entries, classTypeIds: 'all' }] } : { validityDays: 365, unlimited: { zoneIds: 'all', classTypeIds: 'all' } };
            issuePass(scope, { userId: u.id, versionId: null, name: passName, rules, balances: initialBalances(rules), validFrom: nowIso(), validUntil: `${until}T23:59:59.000Z`, source: 'import' });
            report.passes++;
          }
        } catch (e) {
          report.errors.push(`Wiersz ${i + 2}: ${(e as Error).message}`);
        }
      });
      if (req.body.dryRun) throw new DryRun();
    };
    class DryRun extends Error {}
    try {
      scope.tx(work);
    } catch (e) {
      if (!(e instanceof DryRun)) throw e;
      return { ...report, dryRun: true };
    }
    audit(scope, { actorId: user.id, action: 'import.clients', entity: 'studio', details: { clients: report.clients, passes: report.passes } });
    return report;
  });

  // Konto testowe właścicielki (1.1.5 „Testy”): osobna klientka testowa – zakup i rezerwacja bez wpływu na raporty.
  app.post('/api/owner/test-account', owner, async (req) => {
    const { scope, studio, user } = ctx(req);
    const phone = `+48999${user.id.replace(/\D/g, '').padEnd(6, '0').slice(0, 6)}`;
    let u = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
    if (!u) {
      u = { id: id() };
      db.prepare("INSERT INTO users (id, phone, name, prefs_json, onboarded_at, created_at) VALUES (?, ?, 'Konto testowe', '{\"test\":true}', ?, ?)").run(u.id, phone, nowIso(), nowIso());
    }
    scope.run("INSERT OR IGNORE INTO memberships (studio_id, user_id, role, joined_at) VALUES ($studio, $u, 'client', $now)", { u: u.id, now: nowIso() });
    return { token: createSession(db, u.id, Date.now(), 'test'), studioId: studio.id, phone };
  });

  // ——— Role i zespół (2.1: zarządzanie rolami – tylko właścicielka) ———

  app.get('/api/owner/staff', owner, async (req) =>
    ctx(req).scope.all("SELECT u.id, u.name, u.phone, m.role, m.bio, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role != 'client' ORDER BY u.name, m.role"),
  );

  app.post<{ Body: { phone: string; name?: string; role: Role; bio?: string } }>('/api/owner/staff', owner, async (req) => {
    const { scope, studio, user } = ctx(req);
    const role = req.body?.role;
    if (!['trainer', 'reception', 'owner', 'coordinator'].includes(role)) throw badRequest('Wybierz rolę.');
    const phone = normalizePhone(req.body.phone);
    let u = db.prepare('SELECT id, name FROM users WHERE phone = ?').get(phone) as { id: string; name: string | null } | undefined;
    if (!u) {
      if (!req.body.name?.trim()) throw badRequest('Podaj imię nowej osoby.');
      u = { id: id(), name: req.body.name.trim() };
      db.prepare('INSERT INTO users (id, phone, name, created_at) VALUES (?, ?, ?, ?)').run(u.id, phone, u.name, nowIso());
    }
    scope.run('INSERT OR IGNORE INTO memberships (studio_id, user_id, role, bio, joined_at) VALUES ($studio, $u, $r, $b, $now)', { u: u.id, r: role, b: req.body.bio ?? null, now: nowIso() });
    await deps.sms.send(phone, `${studio.name} zaprasza Cię do zespołu w GLAM. Zaloguj się w panelu studia tym numerem telefonu.`);
    audit(scope, { actorId: user.id, action: 'role.granted', entity: 'staff', entityId: u.id, subjectUserId: u.id, details: { role } });
    return { id: u.id };
  });

  app.delete<{ Params: { userId: string; role: string } }>('/api/owner/staff/:userId/:role', owner, async (req) => {
    const { scope, user } = ctx(req);
    if (req.params.role === 'owner' && scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE studio_id = $studio AND role = 'owner'")!.n <= 1) throw conflict('last_owner', 'Studio musi mieć co najmniej jedną właścicielkę.');
    scope.run('DELETE FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = $r AND role != $client', { u: req.params.userId, r: req.params.role, client: 'client' });
    audit(scope, { actorId: user.id, action: 'role.revoked', entity: 'staff', entityId: req.params.userId, subjectUserId: req.params.userId, details: { role: req.params.role } });
    return { ok: true };
  });

  app.put<{ Params: { userId: string }; Body: { classTypeIds?: string[]; bio?: string } }>('/api/owner/staff/:userId', owner, async (req) => {
    const { scope } = ctx(req);
    if (!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'trainer'", { u: req.params.userId })) throw notFound();
    scope.tx(() => {
      if (req.body?.classTypeIds) {
        scope.run('DELETE FROM trainer_class_types WHERE studio_id = $studio AND trainer_id = $t', { t: req.params.userId });
        for (const c of req.body.classTypeIds) scope.run('INSERT OR IGNORE INTO trainer_class_types (studio_id, trainer_id, class_type_id) SELECT $studio, $t, id FROM class_types WHERE studio_id = $studio AND id = $c', { t: req.params.userId, c });
      }
      if (req.body?.bio !== undefined) scope.run("UPDATE memberships SET bio = $b WHERE studio_id = $studio AND user_id = $u AND role = 'trainer'", { b: clean(req.body.bio, 300) || null, u: req.params.userId });
    });
    return { ok: true };
  });

  // Manifest PWA studia – pełny white-label (T5): nazwa, kolory i ikona studia zamiast GLAM.
  app.get<{ Params: { id: string } }>('/api/studios/:id/manifest.webmanifest', async (req, reply) => {
    const s = db.prepare('SELECT id, name, white_label_json, look_json, logo_mime, logo_version FROM studios WHERE id = ?').get(req.params.id) as
      | { id: string; name: string; white_label_json: string | null; look_json: string | null; logo_mime: string | null; logo_version: number }
      | undefined;
    if (!s) throw notFound();
    const wl = s.white_label_json ? (JSON.parse(s.white_label_json) as { appName?: string; shortName?: string; themeColor?: string; background?: string }) : {};
    const icon = s.logo_mime ? `/api/studios/${s.id}/logo?v=${s.logo_version}` : null;
    return reply.header('content-type', 'application/manifest+json').send({
      name: wl.appName ?? `${s.name} · GLAM`,
      short_name: wl.shortName ?? s.name.slice(0, 12),
      start_url: `/app?studio=${s.id}`,
      display: 'standalone',
      background_color: wl.background ?? '#f3f0ea',
      theme_color: wl.themeColor ?? '#1b1715',
      lang: 'pl',
      icons: icon ? [{ src: icon, sizes: '512x512', type: s.logo_mime, purpose: 'any' }] : [],
      shortcuts: [
        { name: 'Grafik', url: `/app?studio=${s.id}&go=schedule` },
        { name: 'Oddech', url: `/app?studio=${s.id}&go=forme` },
      ],
    });
  });
}
