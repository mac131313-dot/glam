// Marketing (3: zakładka właścicielki): motywy i edycje sezonowe (7, M1–M10), ciepłe wiadomości i życzenia (8.1),
// kalendarz powiadomień (8) z podglądem, kampanie push / e-mail / SMS z segmentami i testem A/B (#34),
// kody rabatowe, nagrody programu lojalnościowego, partnerzy (4.8.3).
import type { FastifyInstance } from 'fastify';
import {
  abVariant,
  APP_ICONS,
  BADGES,
  couponLabel,
  editionsFor,
  fill,
  HOLIDAYS,
  localParts,
  moderate,
  MODERATION_COPY,
  PALETTES,
  pct,
  PREVIEW_VARS,
  sentenceCount,
  SEGMENT_LABEL,
  THEME_SOUNDS,
  themeContrastErrors,
  TRIGGERS,
  WISHES,
  type Palette,
} from '@glam/core';
import { ctx, requirePerm, type Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { audit } from '../services/audit.ts';
import { registerCampaignSender } from '../services/jobs.ts';
import { notify } from '../services/notify.ts';
import { audience } from '../services/segments.ts';
import type { Studio } from '../services/studio.ts';

type Variant = { id: string; body: string; subject?: string };

/** Wysyłka kampanii: przypisanie wariantu A/B stałe dla osoby, limity i zgody pilnuje notify(). */
export function sendCampaign(scope: StudioScope, studio: Studio, campaignId: string, now = new Date()) {
  const c = scope.get<{ id: string; name: string; channel: 'push' | 'email' | 'sms'; segment: string; variants_json: string; status: string }>('SELECT * FROM campaigns WHERE studio_id = $studio AND id = $id', { id: campaignId });
  if (!c || c.status === 'sent') return 0;
  const variants = JSON.parse(c.variants_json) as Variant[];
  const users = audience(scope, c.segment, now);
  // SMS marketingowe tylko po osobnej zgodzie (sekcja 11), e-mail – po zgodzie na e-mail.
  const consentKind = c.channel === 'sms' ? 'marketing_sms' : c.channel === 'email' ? 'marketing_email' : 'marketing';
  let sent = 0;
  scope.tx(() => {
    for (const u of users) {
      const consent = scope.db.prepare("SELECT granted FROM consents WHERE user_id = ? AND kind = ? AND studio_id IN (?, '') ORDER BY studio_id DESC").get(u, consentKind, studio.id) as { granted: number } | undefined;
      if (!consent?.granted) continue;
      const v = variants[abVariant(u, c.id, variants.length)];
      notify(scope, { userId: u, category: 'marketing', tz: studio.timezone, now, title: v.subject ?? studio.name, body: v.body, channel: c.channel, campaignId: c.id, variant: v.id, dedupeKey: `campaign:${c.id}` });
      sent++;
    }
    scope.run("UPDATE campaigns SET status = 'sent', sent_at = $now WHERE studio_id = $studio AND id = $id", { id: c.id, now: now.toISOString() });
  });
  return sent;
}

registerCampaignSender(sendCampaign);

export function marketingRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const themesPerm = requirePerm(db, 'themes.edit');
  const themesView = requirePerm(db, 'themes.view');
  const campaignsPerm = requirePerm(db, 'campaigns.edit');
  const loyaltyPerm = requirePerm(db, 'loyalty.edit');
  const ownerish = requirePerm(db, 'config.edit');

  // ——— Motywy (7.7): kalendarz z podglądem, biblioteka pakietów, harmonogram, segment, statystyki ———

  app.get('/api/owner/themes', themesView, async (req) => {
    const { scope } = ctx(req);
    return scope.all<{ id: string; palette_json: string; pack_json: string | null }>('SELECT * FROM themes WHERE studio_id = $studio ORDER BY starts_on').map((t) => {
      const stats = themeStats(scope, t.id);
      return { ...t, palette: JSON.parse(t.palette_json), pack: t.pack_json ? JSON.parse(t.pack_json) : {}, stats };
    });
  });

  // Biblioteka (M10): kalendarz edycji 7.4 na ten i przyszły rok + palety bazowe, dźwięki, ikony, odznaki.
  app.get('/api/owner/themes/library', themesView, async (req) => {
    const { studio } = ctx(req);
    const y = Number(localParts(new Date(), studio.timezone).date.slice(0, 4));
    return {
      editions: [...editionsFor(y), ...editionsFor(y + 1)].filter((e) => e.to >= localParts(new Date(), studio.timezone).date).slice(0, 20),
      palettes: PALETTES.map((p) => ({ id: p.id, label: p.label, palette: p.palette })),
      sounds: THEME_SOUNDS,
      icons: APP_ICONS,
      badges: BADGES.filter((b) => b.limited),
      segments: SEGMENT_LABEL,
    };
  });

  const themeBody = (b: any) => {
    const palette = (b.palette ?? {}) as Partial<Palette>;
    const errors = themeContrastErrors(palette);
    if (!b.name?.trim()) errors.unshift('Podaj nazwę motywu.');
    if (b.startsOn && b.endsOn && b.endsOn < b.startsOn) errors.push('Koniec motywu musi być po początku.');
    if (b.auto && (!b.startsOn || !b.endsOn)) errors.push('Motyw automatyczny potrzebuje dat od–do.');
    if (errors.length) throw badRequest(errors[0], { errors });
    return palette;
  };

  app.post<{ Body: any }>('/api/owner/themes', themesPerm, async (req) => {
    const { scope, user } = ctx(req);
    const b: any = req.body ?? {};
    const palette = themeBody(b);
    const tid = id();
    scope.run(
      `INSERT INTO themes (id, studio_id, name, tagline, emoji, palette_json, effect, starts_on, ends_on, is_active, auto, segment, pack_json, sound, icon)
       VALUES ($id, $studio, $n, $t, $e, $p, $fx, $s, $end, 0, $auto, $seg, $pack, $sound, $icon)`,
      { id: tid, n: b.name.trim().slice(0, 60), t: b.tagline?.slice(0, 120) ?? null, e: b.emoji?.slice(0, 4) ?? null, p: JSON.stringify(palette), fx: b.effect === 'snow' ? 'snow' : null, s: b.startsOn ?? null, end: b.endsOn ?? null, auto: Number(!!b.auto), seg: b.segment || null, pack: JSON.stringify(b.pack ?? {}), sound: b.sound ?? null, icon: b.icon ?? null },
    );
    if (b.pack?.challengeTitle && b.startsOn && b.endsOn) createThemeChallenge(scope, tid, b);
    audit(scope, { actorId: user.id, action: 'theme.created', entity: 'theme', entityId: tid, details: { name: b.name } });
    return { id: tid };
  });

  app.put<{ Params: { id: string }; Body: any }>('/api/owner/themes/:id', themesPerm, async (req) => {
    const { scope, user } = ctx(req);
    const b: any = req.body ?? {};
    const palette = themeBody(b);
    const r = scope.run(
      `UPDATE themes SET name = $n, tagline = $t, emoji = $e, palette_json = $p, effect = $fx, starts_on = $s, ends_on = $end, auto = $auto, segment = $seg, pack_json = $pack, sound = $sound, icon = $icon
       WHERE studio_id = $studio AND id = $id`,
      { id: req.params.id, n: b.name.trim().slice(0, 60), t: b.tagline?.slice(0, 120) ?? null, e: b.emoji?.slice(0, 4) ?? null, p: JSON.stringify(palette), fx: b.effect === 'snow' ? 'snow' : null, s: b.startsOn ?? null, end: b.endsOn ?? null, auto: Number(!!b.auto), seg: b.segment || null, pack: JSON.stringify(b.pack ?? {}), sound: b.sound ?? null, icon: b.icon ?? null },
    );
    if (!r.changes) throw notFound();
    audit(scope, { actorId: user.id, action: 'theme.updated', entity: 'theme', entityId: req.params.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/owner/themes/:id', themesPerm, async (req) => {
    const { scope } = ctx(req);
    if (scope.get('SELECT 1 FROM themes WHERE studio_id = $studio AND id = $id AND is_active = 1', { id: req.params.id })) throw conflict('active', 'Najpierw wyłącz ten motyw.');
    scope.run('DELETE FROM themes WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    return { ok: true };
  });

  // M2: ręczne włączenie motywu (np. „Dzień Kobiet dla nowych”). Jeden aktywny naraz (pilnuje też indeks w bazie).
  app.post<{ Params: { id: string }; Body: { notify?: boolean } }>('/api/owner/themes/:id/activate', themesPerm, async (req) => {
    const { scope, studio, user } = ctx(req);
    const t = scope.get<{ name: string; tagline: string | null; segment: string | null }>('SELECT name, tagline, segment FROM themes WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!t) throw notFound('Nie znaleziono motywu.');
    scope.tx(() => {
      scope.run('UPDATE themes SET is_active = 0 WHERE studio_id = $studio AND is_active = 1');
      // Ręczne włączenie wyłącza tryb automatyczny tego motywu – inaczej harmonogram by go zaraz zgasił.
      scope.run('UPDATE themes SET is_active = 1, auto = 0 WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    });
    if (req.body?.notify) {
      const today = localParts(new Date(), studio.timezone).date;
      for (const u of audience(scope, t.segment ?? 'all')) notify(scope, { userId: u, category: 'theme', tz: studio.timezone, body: TRIGGERS.theme_start.text({ tagline: t.tagline ?? '', name: t.name }), action: 'start', dedupeKey: `theme_start:${req.params.id}:${today}` });
    }
    audit(scope, { actorId: user.id, action: 'theme.activated', entity: 'theme', entityId: req.params.id });
    return { ok: true };
  });

  app.post('/api/owner/themes/deactivate', themesPerm, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('UPDATE themes SET is_active = 0, auto = 0 WHERE studio_id = $studio AND is_active = 1');
    audit(scope, { actorId: user.id, action: 'theme.deactivated', entity: 'theme' });
    return { ok: true };
  });

  // ——— Ciepłe wiadomości i życzenia (8.1.5): ustawienia, podgląd na telefonie, log wysyłek ———

  app.get('/api/owner/greetings', ownerish, async (req) => {
    const { scope, studio } = ctx(req);
    const vars = { imię: 'Magda', trenerka: 'Marzena' };
    return {
      settings: studio.settings.greetings,
      hour: studio.settings.greetingsHour,
      previews: {
        birthday: fill(WISHES.birthday, vars),
        birthdayTrainer: fill(WISHES.birthdayTrainer, vars),
        nameday: WISHES.nameday,
        anniversary: WISHES.anniversary,
        studioAnniversary: WISHES.studioAnniversary,
        support: WISHES.support,
      },
      holidays: HOLIDAYS.map((h) => ({ id: h.id, date: h.date(Number(new Date().getFullYear())), time: h.time, body: fill(h.body, vars), extra: h.extra ?? null })),
      // Log wysyłek bez treści medycznych – tylko rodzaj, data i status (8.1.5).
      log: scope.all(
        "SELECT n.created_at, n.status, n.reason, u.name, substr(n.body, 1, 60) AS preview FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.studio_id = $studio AND n.category = 'occasional' ORDER BY n.created_at DESC LIMIT 100",
      ),
    };
  });

  // Kalendarz powiadomień (8) – każdy wyzwalacz z przykładową treścią i statystyką otwarć.
  app.get('/api/owner/push-calendar', ownerish, async (req) => {
    const { scope } = ctx(req);
    const stats = scope.all<{ category: string; sent: number; opened: number; suppressed: number }>(
      "SELECT category, SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened, SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END) AS suppressed FROM notifications WHERE studio_id = $studio GROUP BY category",
    );
    return {
      rules: ['Każdy typ do wyłączenia osobno', 'Ciche godziny 22:00–7:00 (niekrytyczne)', 'Max 2 marketingowe i 1 „dla mnie” dziennie', 'Max 2 zdania, bez presji i porównań'],
      triggers: Object.entries(TRIGGERS).map(([key, t]) => ({ key, label: t.label, when: t.when, category: t.category, preview: t.text(PREVIEW_VARS) })),
      stats: stats.map((s) => ({ ...s, openRate: pct(s.opened, s.sent) })),
    };
  });

  // ——— Kampanie (#34) ———

  app.get('/api/owner/campaigns', campaignsPerm, async (req) => {
    const { scope } = ctx(req);
    return scope.all<{ id: string; variants_json: string }>('SELECT * FROM campaigns WHERE studio_id = $studio ORDER BY created_at DESC').map((c) => {
      const variants = JSON.parse(c.variants_json) as Variant[];
      const stats = scope.all<{ variant: string; sent: number; opened: number; booked: number }>(
        `SELECT n.variant, COUNT(*) AS sent, SUM(CASE WHEN n.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
                SUM(CASE WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.studio_id = n.studio_id AND b.user_id = n.user_id AND b.created_at > n.created_at AND b.created_at < datetime(n.created_at, '+7 days')) THEN 1 ELSE 0 END) AS booked
         FROM notifications n WHERE n.studio_id = $studio AND n.campaign_id = $c AND n.status != 'suppressed' GROUP BY n.variant`,
        { c: c.id },
      );
      return { ...c, variants: variants.map((v) => { const s = stats.find((x) => x.variant === v.id); return { ...v, sent: s?.sent ?? 0, opened: s?.opened ?? 0, booked: s?.booked ?? 0, openRate: pct(s?.opened ?? 0, s?.sent ?? 0), bookRate: pct(s?.booked ?? 0, s?.sent ?? 0) }; }) };
    });
  });

  app.get<{ Querystring: { segment: string } }>('/api/owner/audience', campaignsPerm, async (req) => ({ count: audience(ctx(req).scope, req.query.segment ?? 'all').length }));

  app.post<{ Body: { name: string; channel: 'push' | 'email' | 'sms'; segment: string; variants: Variant[]; scheduledAt?: string | null } }>('/api/owner/campaigns', campaignsPerm, async (req) => {
    const { scope, studio, user } = ctx(req);
    const b = req.body;
    if (!b?.name?.trim()) throw badRequest('Nazwij kampanię.');
    if (!['push', 'email', 'sms'].includes(b.channel)) throw badRequest('Wybierz kanał.');
    if (b.channel === 'email' && !studio.has('campaigns')) throw conflict('plan', 'Kampanie e-mail są w planie „Studio” i wyższych.');
    const variants = (b.variants ?? []).filter((v) => v.body?.trim()).slice(0, 2).map((v, i) => ({ id: i === 0 ? 'A' : 'B', body: v.body.trim(), subject: v.subject?.trim() }));
    if (!variants.length) throw badRequest('Napisz treść.');
    for (const v of variants) {
      if (b.channel !== 'email' && sentenceCount(v.body) > 2) throw badRequest('Max 2 zdania – krótko i ciepło (sekcja 8).');
      if (v.body.length > (b.channel === 'sms' ? 300 : 600)) throw badRequest('Treść jest za długa.');
      const m = moderate(v.body, { allowLinks: true, maxLength: 600 });
      if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
      if (/musisz|ostatnia szansa|tylko dziś|straciłaś|zaległości/i.test(v.body)) throw badRequest('Bez presji: unikaj „musisz”, „ostatnia szansa”, „straciłaś” (sekcja 10).');
    }
    const cid = id();
    const scheduled = b.scheduledAt && Date.parse(b.scheduledAt) > Date.now();
    scope.run('INSERT INTO campaigns (id, studio_id, name, channel, segment, variants_json, status, scheduled_at, created_by, created_at) VALUES ($id, $studio, $n, $ch, $seg, $v, $st, $at, $by, $now)', {
      id: cid,
      n: b.name.trim().slice(0, 80),
      ch: b.channel,
      seg: b.segment || 'all',
      v: JSON.stringify(variants),
      st: scheduled ? 'scheduled' : 'draft',
      at: scheduled ? new Date(b.scheduledAt!).toISOString() : null,
      by: user.id,
      now: nowIso(),
    });
    audit(scope, { actorId: user.id, action: 'campaign.created', entity: 'campaign', entityId: cid });
    return { id: cid };
  });

  app.post<{ Params: { id: string } }>('/api/owner/campaigns/:id/send', campaignsPerm, async (req) => {
    const { scope, studio, user } = ctx(req);
    if (!scope.get("SELECT 1 FROM campaigns WHERE studio_id = $studio AND id = $id AND status != 'sent'", { id: req.params.id })) throw notFound('Nie znaleziono kampanii do wysłania.');
    const n = sendCampaign(scope, studio, req.params.id);
    audit(scope, { actorId: user.id, action: 'campaign.sent', entity: 'campaign', entityId: req.params.id, details: { recipients: n } });
    return { message: `Wysłane do ${n} osób (tylko z zgodą na marketing; limity dzienne i ciche godziny działają).` };
  });

  app.delete<{ Params: { id: string } }>('/api/owner/campaigns/:id', campaignsPerm, async (req) => {
    ctx(req).scope.run("DELETE FROM campaigns WHERE studio_id = $studio AND id = $id AND status != 'sent'", { id: req.params.id });
    return { ok: true };
  });

  // ——— Kody rabatowe i kupony (4.2) ———

  app.get('/api/owner/coupons', campaignsPerm, async (req) =>
    ctx(req)
      .scope.all<{ id: string; kind: 'percent' | 'amount'; value: number }>(
        "SELECT c.*, (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id) AS used, (SELECT COALESCE(SUM(discount_grosze), 0) FROM coupon_redemptions r WHERE r.coupon_id = c.id) AS discount_total FROM coupons c WHERE c.studio_id = $studio AND c.only_user_id IS NULL ORDER BY c.created_at DESC",
      )
      .map((c) => ({ ...c, label2: couponLabel(c) })),
  );

  app.post<{ Body: { code: string; label: string; kind: 'percent' | 'amount'; value: number; appliesTo?: string; maxUses?: number | null; perUser?: number; returningOnly?: boolean; firstPurchaseOnly?: boolean; validFrom?: string | null; validTo?: string | null } }>(
    '/api/owner/coupons',
    campaignsPerm,
    async (req) => {
      const { scope, user } = ctx(req);
      const b = req.body;
      const code = String(b?.code ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,20}$/.test(code)) throw badRequest('Kod: 3–20 znaków (litery, cyfry, myślnik).');
      if (!['percent', 'amount'].includes(b.kind) || !(b.value > 0) || (b.kind === 'percent' && b.value > 100)) throw badRequest('Podaj wartość rabatu.');
      if (!['all', 'pass', 'course', 'event', 'shop', 'guest_pass'].includes(b.appliesTo ?? 'all')) throw badRequest('Nieprawidłowy zakres kodu.');
      if (scope.get('SELECT 1 FROM coupons WHERE studio_id = $studio AND code = $c', { c: code })) throw conflict('exists', 'Taki kod już istnieje.');
      scope.run(
        `INSERT INTO coupons (id, studio_id, code, label, kind, value, applies_to, max_uses, per_user, returning_only, first_purchase_only, valid_from, valid_to, active, created_at)
         VALUES ($id, $studio, $code, $label, $kind, $value, $ap, $max, $per, $ret, $first, $from, $to, 1, $now)`,
        { id: id(), code, label: b.label?.trim() || code, kind: b.kind, value: Math.round(b.value), ap: b.appliesTo ?? 'all', max: b.maxUses ?? null, per: b.perUser ?? 1, ret: Number(!!b.returningOnly), first: Number(!!b.firstPurchaseOnly), from: b.validFrom ?? null, to: b.validTo ?? null, now: nowIso() },
      );
      audit(scope, { actorId: user.id, action: 'coupon.created', entity: 'coupon', details: { code } });
      return { ok: true };
    },
  );

  app.patch<{ Params: { id: string }; Body: { active: boolean } }>('/api/owner/coupons/:id', campaignsPerm, async (req) => {
    ctx(req).scope.run('UPDATE coupons SET active = $a WHERE studio_id = $studio AND id = $id', { a: Number(!!req.body?.active), id: req.params.id });
    return { ok: true };
  });

  // ——— Nagrody programu lojalnościowego (4.7) ———

  app.get('/api/owner/rewards', loyaltyPerm, async (req) => ctx(req).scope.all('SELECT r.*, (SELECT COUNT(*) FROM loyalty_ledger l WHERE l.studio_id = r.studio_id AND l.reason = \'reward\' AND l.ref LIKE r.id || \':%\') AS claimed FROM rewards r WHERE r.studio_id = $studio ORDER BY r.cost_points'));

  app.post<{ Body: { name: string; kind: 'entry' | 'discount' | 'gift' | 'early_booking'; costPoints: number; value?: number; shopProductId?: string } }>('/api/owner/rewards', loyaltyPerm, async (req) => {
    const { scope } = ctx(req);
    const b = req.body;
    if (!b?.name?.trim() || !['entry', 'discount', 'gift', 'early_booking'].includes(b.kind) || !(b.costPoints > 0)) throw badRequest('Podaj nazwę, rodzaj i koszt w punktach.');
    scope.run('INSERT INTO rewards (id, studio_id, name, kind, cost_points, value, shop_product_id, active) VALUES ($id, $studio, $n, $k, $c, $v, $sp, 1)', { id: id(), n: b.name.trim().slice(0, 60), k: b.kind, c: Math.round(b.costPoints), v: b.value ?? null, sp: b.shopProductId ?? null });
    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Body: { active: boolean } }>('/api/owner/rewards/:id', loyaltyPerm, async (req) => {
    ctx(req).scope.run('UPDATE rewards SET active = $a WHERE studio_id = $studio AND id = $id', { a: Number(!!req.body?.active), id: req.params.id });
    return { ok: true };
  });

  // ——— Partnerzy (4.8.3, #40) – tylko zweryfikowani ———

  app.get('/api/owner/partners', ownerish, async (req) => ctx(req).scope.all('SELECT * FROM partners WHERE studio_id = $studio ORDER BY category, name'));

  app.post<{ Body: { name: string; category: string; description?: string; perk: string; code?: string; url?: string; verified?: boolean } }>('/api/owner/partners', ownerish, async (req) => {
    const { scope } = ctx(req);
    const b = req.body;
    if (!b?.name?.trim() || !b.perk?.trim() || !b.category?.trim()) throw badRequest('Podaj nazwę, kategorię i korzyść dla klientek.');
    if (b.url && !/^https:\/\//.test(b.url)) throw badRequest('Adres strony musi zaczynać się od https://');
    scope.run('INSERT INTO partners (id, studio_id, name, category, description, perk, code, url, verified) VALUES ($id, $studio, $n, $c, $d, $p, $code, $url, $v)', {
      id: id(),
      n: b.name.trim(),
      c: b.category.trim(),
      d: b.description ?? null,
      p: b.perk.trim(),
      code: b.code ?? null,
      url: b.url ?? null,
      v: Number(!!b.verified),
    });
    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Body: { verified?: boolean } }>('/api/owner/partners/:id', ownerish, async (req) => {
    ctx(req).scope.run('UPDATE partners SET verified = $v WHERE studio_id = $studio AND id = $id', { v: Number(!!req.body?.verified), id: req.params.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/owner/partners/:id', ownerish, async (req) => {
    ctx(req).scope.run('DELETE FROM partners WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    return { ok: true };
  });

}

/** Statystyki motywu (7.7): udział w wyzwaniach motywowych, zakupy z kodu motywu, otwarcia push. */
function themeStats(scope: StudioScope, themeId: string) {
  const challenge = scope.get<{ joined: number; done: number }>(
    'SELECT COUNT(m.user_id) AS joined, SUM(CASE WHEN m.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done FROM challenges c LEFT JOIN challenge_members m ON m.challenge_id = c.id WHERE c.studio_id = $studio AND c.theme_id = $t',
    { t: themeId },
  )!;
  const push = scope.get<{ sent: number; opened: number }>(
    "SELECT COUNT(*) AS sent, SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened FROM notifications WHERE studio_id = $studio AND category = 'theme' AND dedupe_key LIKE $k",
    { k: `theme_start:${themeId}:%` },
  )!;
  const pack = scope.get<{ pack_json: string | null }>('SELECT pack_json FROM themes WHERE studio_id = $studio AND id = $t', { t: themeId });
  const code = pack?.pack_json ? (JSON.parse(pack.pack_json).couponCode as string | undefined) : undefined;
  const voucher = code ? scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM coupon_redemptions r JOIN coupons c ON c.id = r.coupon_id WHERE c.studio_id = $studio AND c.code = $c', { c: code })!.n : 0;
  return { challengeJoined: challenge.joined, challengeDone: challenge.done ?? 0, pushSent: push.sent, pushOpenRate: pct(push.opened ?? 0, push.sent), voucherUses: voucher };
}

/** Pakiet motywu z wyzwaniem (7.2): wyzwanie i limitowana odznaka w okresie motywu. */
function createThemeChallenge(scope: StudioScope, themeId: string, b: any) {
  scope.run(
    "INSERT INTO challenges (id, studio_id, title, description, metric, target, starts_on, ends_on, badge_code, theme_id, created_at) VALUES ($id, $studio, $t, $d, $m, $target, $s, $e, $badge, $theme, $now)",
    { id: id(), t: b.pack.challengeTitle, d: b.tagline ?? null, m: b.pack.challengeMetric ?? 'checkins', target: b.pack.challengeTarget ?? 10, s: b.startsOn, e: b.endsOn, badge: b.pack.badge ?? 'challenge', theme: themeId, now: nowIso() },
  );
}
