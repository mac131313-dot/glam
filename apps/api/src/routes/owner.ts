// Panel studia (właścicielka, w stylu Shopify – sekcja 3): pulpit i KPI (12), analityka retencji i LTV (#15),
// klientki i segmenty, finanse, faktury, eksport (Excel/CSV, wydruk PDF), produkty z wersjonowaniem (C5),
// akceptacja i statystyki powitań (P5, P8), rejestr zmian, kopia danych studia, plan i zużycie.
import type { FastifyInstance } from 'fastify';
import {
  activationRate,
  addDays,
  arpu,
  avgVisits30,
  churnRisk,
  describeRules,
  formatPLN,
  localParts,
  ltv,
  nps,
  pct,
  planById,
  retention,
  segmentsOf,
  SEGMENT_LABEL,
  toCsv,
  validateRules,
  zonedToUtc,
  type ProductRules,
} from '@glam/core';
import { ctx, requirePerm, requireStudio, type Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { badRequest, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { audit } from '../services/audit.ts';
import { notify } from '../services/notify.ts';
import { issueInvoice } from '../services/payments.ts';
import { clientFacts } from '../services/segments.ts';
import { nameMaps } from './client.ts';

function productList(scope: StudioScope) {
  const names = nameMaps(scope);
  return scope
    .all<{ id: string; name: string; description: string | null; published: number; channels_json: string; version: number; price_grosze: number; rules_json: string; sold: number }>(
      `SELECT p.id, p.name, p.description, p.published, p.channels_json, v.version, v.price_grosze, v.rules_json,
              (SELECT COUNT(*) FROM passes ps JOIN product_versions pv ON pv.id = ps.product_version_id WHERE pv.product_id = p.id) AS sold
       FROM products p JOIN product_versions v ON v.id = p.current_version_id WHERE p.studio_id = $studio ORDER BY p.sort`,
    )
    .map((p) => {
      const rules = JSON.parse(p.rules_json) as ProductRules;
      return { ...p, channels: JSON.parse(p.channels_json) as string[], rules, price: formatPLN(p.price_grosze), preview: describeRules(rules, names) };
    });
}

const range = (q: { from?: string; to?: string }, tz: string) => {
  const today = localParts(new Date(), tz).date;
  const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : `${today.slice(0, 7)}-01`;
  const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : today;
  return { from, to, fromIso: zonedToUtc(from, '00:00', tz).toISOString(), toIso: zonedToUtc(addDays(to, 1), '00:00', tz).toISOString() };
};

export function ownerRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const owner = { preHandler: requireStudio(db, ['owner']) };
  const finance = requirePerm(db, 'finance.view');
  const exportPerm = requirePerm(db, 'finance.export');

  app.get('/api/owner/dashboard', owner, async (req) => {
    const { studio, scope } = ctx(req);
    const now = new Date();
    const lp = localParts(now, studio.timezone);
    const dayFrom = zonedToUtc(lp.date, '00:00', studio.timezone).toISOString();
    const dayTo = zonedToUtc(addDays(lp.date, 1), '00:00', studio.timezone).toISOString();
    const monthFrom = zonedToUtc(`${lp.date.slice(0, 7)}-01`, '00:00', studio.timezone).toISOString();
    const weekTo = zonedToUtc(addDays(lp.date, 7), '00:00', studio.timezone).toISOString();

    const today = scope.get<{ sessions: number; booked: number; attended: number; capacity: number }>(
      `SELECT COUNT(DISTINCT s.id) AS sessions,
              COALESCE(SUM(CASE WHEN b.status IN ('booked', 'attended') THEN 1 ELSE 0 END), 0) AS booked,
              COALESCE(SUM(CASE WHEN b.status = 'attended' THEN 1 ELSE 0 END), 0) AS attended,
              (SELECT COALESCE(SUM(capacity), 0) FROM class_sessions WHERE studio_id = $studio AND status = 'scheduled' AND starts_at >= $from AND starts_at < $to) AS capacity
       FROM class_sessions s LEFT JOIN bookings b ON b.session_id = s.id
       WHERE s.studio_id = $studio AND s.status = 'scheduled' AND s.starts_at >= $from AND s.starts_at < $to`,
      { from: dayFrom, to: dayTo },
    )!;
    const revenue = scope.get<{ total: number; count: number }>("SELECT COALESCE(SUM(amount_grosze), 0) AS total, COUNT(*) AS count FROM payments WHERE studio_id = $studio AND status = 'paid' AND created_at >= $from", { from: monthFrom })!;
    const newClients = scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE studio_id = $studio AND role = 'client' AND joined_at >= $from", { from: monthFrom })!.n;

    const facts = clientFacts(scope, now);
    const segments = { active: 0, dormant7: 0, dormant14: 0, dormant30: 0, ambassador: 0, churn_risk: 0, new: 0 };
    for (const f of facts) for (const s of segmentsOf(f, now)) segments[s]++;

    const occupancy = scope.get<{ taken: number; capacity: number }>(
      `SELECT COALESCE(SUM((SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ('booked', 'attended'))), 0) AS taken, COALESCE(SUM(s.capacity), 0) AS capacity
       FROM class_sessions s WHERE s.studio_id = $studio AND s.status = 'scheduled' AND s.starts_at >= $now AND s.starts_at < $to`,
      { now: now.toISOString(), to: weekTo },
    )!;
    const popular = scope.all(
      `SELECT ct.name, COUNT(b.id) AS bookings FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id
       LEFT JOIN bookings b ON b.session_id = s.id AND b.status IN ('booked', 'attended', 'waitlist')
       WHERE s.studio_id = $studio AND s.starts_at >= $now AND s.starts_at < $to GROUP BY ct.id ORDER BY bookings DESC LIMIT 5`,
      { now: now.toISOString(), to: weekTo },
    );
    const payments = scope.all<{ amount_grosze: number }>(
      'SELECT p.amount_grosze, p.method, p.kind, p.created_at, p.description, u.name FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.studio_id = $studio ORDER BY p.created_at DESC LIMIT 6',
    );
    const n = (sql: string, p: Record<string, string> = {}) => scope.get<{ n: number }>(sql, p)!.n;
    const guestPasses = scope.get<{ sent: number; activated: number }>("SELECT SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN status != 'sent' THEN 1 ELSE 0 END) AS activated FROM guest_passes WHERE studio_id = $studio")!;
    const courses = scope.get<{ published: number; enrolled: number; completed: number; pending: number }>(
      `SELECT SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              (SELECT COUNT(*) FROM course_enrollments WHERE studio_id = $studio) AS enrolled, (SELECT COUNT(*) FROM course_enrollments WHERE studio_id = $studio AND completed_at IS NOT NULL) AS completed
       FROM courses WHERE studio_id = $studio`,
    )!;
    const unreadChats = n('SELECT COUNT(DISTINCT client_id) AS n FROM chat_messages WHERE studio_id = $studio AND from_staff = 0 AND read_at IS NULL');

    return {
      today,
      revenueMonth: { total: formatPLN(revenue.total), count: revenue.count },
      newClients,
      clientsTotal: facts.length,
      segments,
      occupancy7d: occupancy.capacity ? Math.round((occupancy.taken / occupancy.capacity) * 100) : 0,
      popular,
      payments: payments.map((p) => ({ ...p, amount: formatPLN(p.amount_grosze) })),
      pendingWelcomes: n("SELECT COUNT(*) AS n FROM welcome_messages WHERE studio_id = $studio AND status = 'pending'"),
      guestPasses: { sent: guestPasses.sent ?? 0, activated: guestPasses.activated ?? 0 },
      courses: { published: courses.published ?? 0, pending: courses.pending ?? 0, enrolled: courses.enrolled, completed: courses.completed },
      unreadChats,
      todo: {
        welcomes: n("SELECT COUNT(*) AS n FROM welcome_messages WHERE studio_id = $studio AND status = 'pending'"),
        courses: courses.pending ?? 0,
        reports: n("SELECT COUNT(*) AS n FROM reports WHERE studio_id = $studio AND status = 'open'"),
        followups: n("SELECT COUNT(*) AS n FROM dormant_surveys WHERE studio_id = $studio AND wants_proposal = 1 AND status = 'answered'"),
        locker: n("SELECT COUNT(*) AS n FROM locker_items WHERE studio_id = $studio AND status IN ('queued', 'ready')"),
        cards: n("SELECT COUNT(*) AS n FROM card_tasks WHERE studio_id = $studio AND status IN ('todo', 'written')"),
        events: n("SELECT COUNT(*) AS n FROM private_events WHERE studio_id = $studio AND status = 'inquiry'"),
        orders: n("SELECT COUNT(*) AS n FROM shop_orders WHERE studio_id = $studio AND status IN ('reserved', 'paid')"),
        tracks: n("SELECT COUNT(*) AS n FROM playlist_tracks WHERE studio_id = $studio AND status = 'pending'"),
        chats: unreadChats,
      },
    };
  });

  // KPI z sekcji 12 i analityka 4.11 (retencja 30/60/90, średnia wejść, konwersja zaproszeń, LTV).
  app.get('/api/owner/analytics', owner, async (req) => {
    const { studio, scope } = ctx(req);
    const now = new Date();
    const facts = clientFacts(scope, now);
    const month = zonedToUtc(`${localParts(now, studio.timezone).date.slice(0, 7)}-01`, '00:00', studio.timezone).toISOString();
    const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const g = <T>(sql: string, p: Record<string, string> = {}) => scope.get<T>(sql, p)!;
    const revenueMonth = g<{ t: number }>("SELECT COALESCE(SUM(amount_grosze), 0) AS t FROM payments WHERE studio_id = $studio AND status = 'paid' AND created_at >= $m", { m: month }).t;
    const active = facts.filter((f) => f.lastVisit && now.getTime() - Date.parse(f.lastVisit) < 30 * 86_400_000).length;
    const att = g<{ booked: number; attended: number }>(
      `SELECT SUM(CASE WHEN b.status IN ('attended', 'no_show', 'late_cancel') THEN 1 ELSE 0 END) AS booked, SUM(CASE WHEN b.status = 'attended' THEN 1 ELSE 0 END) AS attended
       FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND s.starts_at >= $s AND s.starts_at < $now`,
      { s: since30, now: now.toISOString() },
    );
    const ref = g<{ sent: number; converted: number }>("SELECT COUNT(*) AS sent, SUM(CASE WHEN status IN ('first_class', 'purchased') THEN 1 ELSE 0 END) AS converted FROM referrals WHERE studio_id = $studio");
    const gp = g<{ sold: number; activated: number }>("SELECT COUNT(*) AS sold, SUM(CASE WHEN status != 'sent' THEN 1 ELSE 0 END) AS activated FROM guest_passes WHERE studio_id = $studio");
    const mindful = g<{ n: number }>('SELECT COUNT(*) AS n FROM mindful_logs WHERE studio_id = $studio AND completed_at >= $s', { s: new Date(now.getTime() - 7 * 86_400_000).toISOString() }).n;
    const scores = scope.all<{ score: number }>('SELECT score FROM nps_responses WHERE studio_id = $studio AND score IS NOT NULL').map((r) => r.score);
    const dormantBack = g<{ total: number; back: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN EXISTS (SELECT 1 FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = d.studio_id AND b.user_id = d.user_id AND b.status = 'attended' AND s.starts_at > d.created_at) THEN 1 ELSE 0 END) AS back
       FROM dormant_surveys d WHERE d.studio_id = $studio`,
    );
    const welcomes = g<{ total: number; trainer: number; fallback: number; booked: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN kind = 'trainer' THEN 1 ELSE 0 END) AS trainer, SUM(CASE WHEN kind = 'studio' THEN 1 ELSE 0 END) AS fallback,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.studio_id = w.studio_id AND b.user_id = w.client_id AND b.created_at > w.created_at) THEN 1 ELSE 0 END) AS booked
       FROM welcome_messages w WHERE w.studio_id = $studio AND w.status = 'published' AND w.kind IN ('trainer', 'studio')`,
    );
    const themePush = g<{ sent: number; opened: number }>("SELECT COUNT(*) AS sent, SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened FROM notifications WHERE studio_id = $studio AND category = 'theme'");
    const challenge = g<{ joined: number; done: number }>('SELECT COUNT(*) AS joined, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done FROM challenge_members WHERE studio_id = $studio');
    const courseStats = g<{ sales: number; completions: number; rating: number | null }>(
      "SELECT (SELECT COUNT(*) FROM course_enrollments WHERE studio_id = $studio) AS sales, (SELECT COUNT(*) FROM course_enrollments WHERE studio_id = $studio AND completed_at IS NOT NULL) AS completions, (SELECT ROUND(AVG(rating), 1) FROM course_reviews WHERE studio_id = $studio) AS rating",
    );
    const birthdays = g<{ n: number }>("SELECT COUNT(*) AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role = 'client' AND u.birthday IS NOT NULL").n;
    const occasional = g<{ sent: number; opened: number }>("SELECT COUNT(*) AS sent, SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened FROM notifications WHERE studio_id = $studio AND category = 'occasional' AND status = 'sent'");
    const optOut = scope.all<{ prefs_json: string | null; push_disabled_json: string }>("SELECT u.prefs_json, u.push_disabled_json FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role = 'client'");
    const offCounts: Record<string, number> = {};
    for (const u of optOut) {
      for (const k of JSON.parse(u.push_disabled_json) as string[]) offCounts[k] = (offCounts[k] ?? 0) + 1;
      for (const k of (u.prefs_json ? (JSON.parse(u.prefs_json).occasionsOff ?? []) : []) as string[]) offCounts[`occasion:${k}`] = (offCounts[`occasion:${k}`] ?? 0) + 1;
    }
    const revenueByMonth = scope.all<{ m: string; total: number }>(
      "SELECT substr(created_at, 1, 7) AS m, SUM(amount_grosze) AS total FROM payments WHERE studio_id = $studio AND status = 'paid' AND created_at >= $s GROUP BY m ORDER BY m",
      { s: new Date(now.getTime() - 180 * 86_400_000).toISOString() },
    );
    return {
      retention: { d30: retention(facts, 30, now), d60: retention(facts, 60, now), d90: retention(facts, 90, now) },
      activation: activationRate(facts, now),
      avgVisits30: avgVisits30(facts, now),
      attendanceRate: pct(att.attended ?? 0, att.booked ?? 0),
      ltv: formatPLN(ltv(facts)),
      arpu: formatPLN(arpu(revenueMonth, active)),
      activeClients: active,
      nps: nps(scores),
      npsResponses: scores.length,
      invitations: { perClient: facts.length ? Math.round(((ref.sent ?? 0) / facts.length) * 100) / 100 : 0, sent: ref.sent ?? 0, converted: ref.converted ?? 0, conversion: pct(ref.converted ?? 0, ref.sent ?? 0) },
      guestPasses: { sold: gp.sold, activated: gp.activated ?? 0, conversion: pct(gp.activated ?? 0, gp.sold) },
      reactivation: { surveyed: dormantBack.total, returned: dormantBack.back ?? 0, rate: pct(dormantBack.back ?? 0, dormantBack.total) },
      mindfulPerActiveWeekly: active ? Math.round((mindful / active) * 10) / 10 : 0,
      themes: { pushSent: themePush.sent, pushOpenRate: pct(themePush.opened ?? 0, themePush.sent), challengeJoined: challenge.joined, challengeDone: challenge.done ?? 0 },
      courses: courseStats,
      welcomes: { ...welcomes, bookedAfterRate: pct(welcomes.booked ?? 0, welcomes.total) },
      greetings: { birthdayShare: pct(birthdays, facts.length), sent: occasional.sent, openRate: pct(occasional.opened ?? 0, occasional.sent), optOuts: offCounts },
      revenueByMonth: revenueByMonth.map((r) => ({ month: r.m, total: r.total, label: formatPLN(r.total) })),
    };
  });

  // Klientki i segmenty (3, 4.11): aktywne, uśpione 7/14/30, nowe, ambasadorki, ryzyko odejścia.
  app.get<{ Querystring: { segment?: string } }>('/api/owner/clients', requirePerm(db, 'clients.view'), async (req) => {
    const { scope } = ctx(req);
    const now = new Date();
    return {
      labels: SEGMENT_LABEL,
      clients: clientFacts(scope, now)
        .map((f) => ({ id: f.userId, name: f.name, phone: f.phone, joinedAt: f.joinedAt, lastVisit: f.lastVisit, visits: f.visits.length, revenue: formatPLN(f.revenueGrosze), hasActivePass: f.hasActivePass, risk: churnRisk(f, now), segments: segmentsOf(f, now), groups: f.groups }))
        .filter((c) => !req.query.segment || (c.segments as string[]).includes(req.query.segment))
        .sort((a, b) => b.risk - a.risk),
    };
  });

  // ——— Finanse ———

  app.get<{ Querystring: { from?: string; to?: string } }>('/api/owner/finance', finance, async (req) => {
    const { scope, studio } = ctx(req);
    const r = range(req.query, studio.timezone);
    const p = { from: r.fromIso, to: r.toIso };
    const byKind = scope.all<{ kind: string; total: number; n: number }>("SELECT kind, SUM(amount_grosze) AS total, COUNT(*) AS n FROM payments WHERE studio_id = $studio AND status = 'paid' AND created_at >= $from AND created_at < $to GROUP BY kind", p);
    const byMethod = scope.all<{ method: string; total: number; n: number }>("SELECT method, SUM(amount_grosze) AS total, COUNT(*) AS n FROM payments WHERE studio_id = $studio AND status = 'paid' AND created_at >= $from AND created_at < $to GROUP BY method", p);
    const total = byKind.reduce((a, k) => a + k.total, 0);
    const discounts = scope.get<{ d: number }>("SELECT COALESCE(SUM(discount_grosze), 0) AS d FROM payments WHERE studio_id = $studio AND created_at >= $from AND created_at < $to", p)!.d;
    const payments = scope.all<{ amount_grosze: number }>(
      `SELECT p.id, p.kind, p.amount_grosze, p.discount_grosze, p.method, p.created_at, p.description, p.invoice_id, i.number AS invoice_number, u.name
       FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.studio_id = $studio AND p.created_at >= $from AND p.created_at < $to ORDER BY p.created_at DESC LIMIT 300`,
      p,
    );
    const shop = scope.get<{ total: number; n: number }>("SELECT COALESCE(SUM(total_grosze), 0) AS total, COUNT(*) AS n FROM shop_orders WHERE studio_id = $studio AND status IN ('collected', 'paid', 'shipped') AND kind != 'online' AND updated_at >= $from AND updated_at < $to", p)!;
    return {
      ...r,
      total: formatPLN(total),
      discounts: formatPLN(discounts),
      // Platforma nie pośredniczy w płatnościach (decyzja 23) – prowizja tylko, jeśli studio ją wybrało (T10).
      commission: studio.settings.commissionPct ? formatPLN(Math.round((total * studio.settings.commissionPct) / 100)) : null,
      byKind: byKind.map((k) => ({ ...k, amount: formatPLN(k.total) })),
      byMethod: byMethod.map((k) => ({ ...k, amount: formatPLN(k.total) })),
      // Sprzedaż merchu na miejscu – tylko ewidencja do raportu, nie dokument sprzedaży (4.8.1).
      shopOnSite: { amount: formatPLN(shop.total), n: shop.n },
      payments: payments.map((x) => ({ ...x, amount: formatPLN(x.amount_grosze) })),
      invoices: scope.all('SELECT id, number, issued_at, gross_grosze, buyer_json FROM invoices WHERE studio_id = $studio AND issued_at >= $from AND issued_at < $to ORDER BY issued_at DESC', p),
    };
  });

  // Faktury zbiorcze (4.11): wszystkie płatności z okresu, które jeszcze nie mają faktury.
  app.post<{ Body: { from: string; to: string } }>('/api/owner/invoices/batch', exportPerm, async (req) => {
    const { scope, studio, user } = ctx(req);
    const r = range(req.body ?? {}, studio.timezone);
    const rows = scope.all<{ id: string; name: string | null; email: string | null }>(
      "SELECT p.id, u.name, u.email FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.studio_id = $studio AND p.invoice_id IS NULL AND p.kind != 'shop' AND p.status = 'paid' AND p.created_at >= $from AND p.created_at < $to",
      { from: r.fromIso, to: r.toIso },
    );
    for (const p of rows) issueInvoice(scope, studio, p.id, { name: p.name ?? 'Klientka', email: p.email });
    audit(scope, { actorId: user.id, action: 'invoices.batch', entity: 'invoice', details: { count: rows.length, from: r.from, to: r.to } });
    return { issued: rows.length };
  });

  // Faktura do wydruku / PDF (przeglądarka „Zapisz jako PDF”). Klientka widzi swoje, finanse – wszystkie.
  app.get<{ Params: { id: string } }>('/api/invoices/:id', { preHandler: requireStudio(db) }, async (req, reply) => {
    const { scope, user, roles } = ctx(req);
    const inv = scope.get<{ number: string; issued_at: string; seller_json: string; buyer_json: string; items_json: string; net_grosze: number; vat_grosze: number; gross_grosze: number; user_id: string | null }>(
      'SELECT * FROM invoices WHERE studio_id = $studio AND id = $id',
      { id: req.params.id },
    );
    if (!inv || (inv.user_id !== user.id && !roles.some((r) => r === 'owner' || r === 'reception'))) throw notFound('Nie znaleziono faktury.');
    const seller = JSON.parse(inv.seller_json);
    const buyer = JSON.parse(inv.buyer_json);
    const items = JSON.parse(inv.items_json) as { name: string; qty: number; vatRate: number; net: number; vat: number; gross: number }[];
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Faktura ${esc(inv.number)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1b1715}h1{font-weight:500;letter-spacing:-.02em}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:8px;border-bottom:1px solid #e0dacf}th{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#5e554c}.r{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}@media print{button{display:none}}</style></head>
<body><button onclick="print()">Drukuj / zapisz PDF</button><h1>Faktura ${esc(inv.number)}</h1><p>Data wystawienia: ${esc(inv.issued_at.slice(0, 10))}</p>
<div class="grid"><div><b>Sprzedawca</b><br>${esc(seller.name)}<br>${esc(seller.address)}<br>${seller.nip ? `NIP: ${esc(seller.nip)}` : ''}</div>
<div><b>Nabywca</b><br>${esc(buyer.name)}<br>${esc(buyer.address)}<br>${buyer.nip ? `NIP: ${esc(buyer.nip)}` : ''}</div></div>
<table><thead><tr><th>Nazwa</th><th>Ilość</th><th>VAT</th><th class="r">Netto</th><th class="r">VAT</th><th class="r">Brutto</th></tr></thead><tbody>
${items.map((i) => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${i.vatRate}%</td><td class="r">${formatPLN(i.net)}</td><td class="r">${formatPLN(i.vat)}</td><td class="r">${formatPLN(i.gross)}</td></tr>`).join('')}
</tbody><tfoot><tr><th colspan="3">Razem</th><th class="r">${formatPLN(inv.net_grosze)}</th><th class="r">${formatPLN(inv.vat_grosze)}</th><th class="r">${formatPLN(inv.gross_grosze)}</th></tr></tfoot></table>
<p>Zapłacono. Dokument wygenerowany w GLAM.</p></body></html>`;
    return reply.header('content-type', 'text/html; charset=utf-8').send(html);
  });

  // Eksport (Excel – CSV z średnikiem i BOM) – 4.11.
  app.get<{ Params: { what: string }; Querystring: { from?: string; to?: string } }>('/api/owner/export/:what', exportPerm, async (req, reply) => {
    const { scope, studio, user } = ctx(req);
    const r = range(req.query, studio.timezone);
    let csv = '';
    if (req.params.what === 'payments.csv') {
      csv = toCsv(
        scope.all(
          `SELECT p.created_at AS data, u.name AS klientka, p.kind AS rodzaj, p.description AS opis, p.method AS metoda, printf('%.2f', p.amount_grosze / 100.0) AS kwota, printf('%.2f', p.discount_grosze / 100.0) AS rabat, i.number AS faktura
           FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.studio_id = $studio AND p.created_at >= $from AND p.created_at < $to ORDER BY p.created_at`,
          { from: r.fromIso, to: r.toIso },
        ),
      );
    } else if (req.params.what === 'clients.csv') {
      const now = new Date();
      csv = toCsv(clientFacts(scope, now).map((f) => ({ imię: f.name, telefon: f.phone, dołączyła: f.joinedAt.slice(0, 10), ostatnia_wizyta: f.lastVisit?.slice(0, 10) ?? '', wizyty: f.visits.length, segmenty: segmentsOf(f, now).join(', '), przychód: (f.revenueGrosze / 100).toFixed(2) })));
    } else if (req.params.what === 'bookings.csv') {
      csv = toCsv(
        scope.all(
          `SELECT s.starts_at AS zajęcia_start, COALESCE(s.title, ct.name) AS zajęcia, t.name AS prowadzi, u.name AS klientka, b.guest_name AS gość, b.status, b.rating AS ocena
           FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id JOIN users t ON t.id = s.trainer_id JOIN users u ON u.id = b.user_id
           WHERE b.studio_id = $studio AND s.starts_at >= $from AND s.starts_at < $to ORDER BY s.starts_at`,
          { from: r.fromIso, to: r.toIso },
        ),
      );
    } else if (req.params.what === 'shop.csv') {
      csv = toCsv(scope.all("SELECT o.created_at AS data, u.name AS klientka, o.kind AS rodzaj, o.status, o.method AS płatność, printf('%.2f', o.total_grosze / 100.0) AS kwota, o.items_json AS pozycje FROM shop_orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.studio_id = $studio AND o.created_at >= $from AND o.created_at < $to", { from: r.fromIso, to: r.toIso }));
    } else throw notFound();
    audit(scope, { actorId: user.id, action: 'export', entity: 'export', details: { what: req.params.what, from: r.from, to: r.to } });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${studio.slug}-${req.params.what.replace('.csv', '')}-${r.from}_${r.to}.csv"`).send(csv);
  });

  // ——— Produkty i karnety (C2, C5) ———

  app.get('/api/owner/products', owner, async (req) => productList(ctx(req).scope));

  app.post<{ Body: { name: string; description?: string; priceGrosze: number; rules: ProductRules; channels?: string[] } }>('/api/owner/products', owner, async (req) => {
    const { scope, user } = ctx(req);
    const b = req.body;
    const errors = validateRules(b?.rules ?? ({} as ProductRules));
    if (!b?.name?.trim()) errors.unshift('Podaj nazwę produktu.');
    if (!Number.isInteger(b?.priceGrosze) || b.priceGrosze < 0) errors.push('Podaj cenę.');
    const channels = (b?.channels ?? ['app', 'desk']).filter((c) => ['app', 'desk'].includes(c));
    if (!channels.length) errors.push('Wybierz co najmniej jeden kanał sprzedaży.');
    if (errors.length) throw badRequest(errors[0], { errors });
    const productId = id();
    const versionId = id();
    scope.tx(() => {
      scope.run(
        'INSERT INTO products (id, studio_id, name, description, channels_json, sort) VALUES ($id, $studio, $name, $desc, $ch, (SELECT COALESCE(MAX(sort), 0) + 1 FROM products WHERE studio_id = $studio))',
        { id: productId, name: b.name.trim(), desc: b.description ?? null, ch: JSON.stringify(channels) },
      );
      scope.run('INSERT INTO product_versions (id, studio_id, product_id, version, price_grosze, rules_json, created_at) VALUES ($id, $studio, $p, 1, $price, $rules, $now)', { id: versionId, p: productId, price: b.priceGrosze, rules: JSON.stringify(b.rules), now: nowIso() });
      scope.run('UPDATE products SET current_version_id = $v WHERE studio_id = $studio AND id = $id', { v: versionId, id: productId });
      audit(scope, { actorId: user.id, action: 'product.created', entity: 'product', entityId: productId, details: { name: b.name, price: b.priceGrosze } });
    });
    return { id: productId };
  });

  // Zmiana ceny / reguł = nowa wersja. Kupione karnety mają własną kopię reguł (C5) – chyba że właścicielka
  // wyraźnie zdecyduje inaczej (applyToExisting) – wtedy klientki zobaczą zmianę przy następnym logowaniu (1.1.6).
  app.put<{ Params: { id: string }; Body: { priceGrosze?: number; rules?: ProductRules; published?: boolean; name?: string; description?: string; channels?: string[]; applyToExisting?: boolean } }>(
    '/api/owner/products/:id',
    owner,
    async (req) => {
      const { scope, studio, user } = ctx(req);
      const cur = scope.get<{ version: number; price_grosze: number; rules_json: string; name: string }>(
        'SELECT v.version, v.price_grosze, v.rules_json, p.name FROM products p JOIN product_versions v ON v.id = p.current_version_id WHERE p.studio_id = $studio AND p.id = $id',
        { id: req.params.id },
      );
      if (!cur) throw notFound('Nie znaleziono produktu.');
      const b = req.body ?? {};
      const rules = b.rules ?? (JSON.parse(cur.rules_json) as ProductRules);
      const price = b.priceGrosze ?? cur.price_grosze;
      const errors = validateRules(rules);
      if (errors.length) throw badRequest(errors[0], { errors });
      scope.tx(() => {
        if (b.rules || b.priceGrosze !== undefined) {
          const v = id();
          scope.run('INSERT INTO product_versions (id, studio_id, product_id, version, price_grosze, rules_json, created_at) VALUES ($id, $studio, $p, $ver, $price, $rules, $now)', {
            id: v,
            p: req.params.id,
            ver: cur.version + 1,
            price,
            rules: JSON.stringify(rules),
            now: nowIso(),
          });
          scope.run('UPDATE products SET current_version_id = $v WHERE studio_id = $studio AND id = $id', { v, id: req.params.id });
          if (b.applyToExisting && b.rules) {
            const affected = scope.all<{ id: string; user_id: string }>(
              "SELECT ps.id, ps.user_id FROM passes ps JOIN product_versions pv ON pv.id = ps.product_version_id WHERE ps.studio_id = $studio AND pv.product_id = $p AND ps.status = 'active'",
              { p: req.params.id },
            );
            for (const a of affected) {
              scope.run('UPDATE passes SET rules_json = $r, product_version_id = $v WHERE studio_id = $studio AND id = $id', { r: JSON.stringify(rules), v, id: a.id });
              notify(scope, { userId: a.user_id, category: 'transactional', tz: studio.timezone, body: `Studio zaktualizowało zasady karnetu „${cur.name}”. Szczegóły znajdziesz w Profilu → Karnety.`, action: 'profile/passes' });
            }
          }
        }
        if (b.published !== undefined) scope.run('UPDATE products SET published = $p WHERE studio_id = $studio AND id = $id', { p: Number(b.published), id: req.params.id });
        if (b.name?.trim()) scope.run('UPDATE products SET name = $n WHERE studio_id = $studio AND id = $id', { n: b.name.trim(), id: req.params.id });
        if (b.description !== undefined) scope.run('UPDATE products SET description = $d WHERE studio_id = $studio AND id = $id', { d: b.description || null, id: req.params.id });
        if (b.channels) scope.run('UPDATE products SET channels_json = $c WHERE studio_id = $studio AND id = $id', { c: JSON.stringify(b.channels.filter((c) => ['app', 'desk'].includes(c))), id: req.params.id });
        audit(scope, { actorId: user.id, action: 'product.updated', entity: 'product', entityId: req.params.id, details: { price, rulesChanged: !!b.rules, applyToExisting: !!b.applyToExisting } });
      });
      return productList(scope).find((p) => p.id === req.params.id);
    },
  );

  // ——— Powitania: akceptacja (P5) i statystyki (P8) ———

  app.get('/api/owner/welcome/pending', owner, async (req) =>
    ctx(req).scope.all(
      `SELECT w.id, w.body, w.video_id, w.created_at, t.name AS trainer_name, c.name AS client_name FROM welcome_messages w
       JOIN users t ON t.id = w.trainer_id JOIN users c ON c.id = w.client_id
       WHERE w.studio_id = $studio AND w.status = 'pending' ORDER BY w.created_at`,
    ),
  );

  app.post<{ Params: { id: string } }>('/api/owner/welcome/:id/approve', owner, async (req) => {
    const { scope, studio } = ctx(req);
    const w = scope.get<{ client_id: string; publish_at: string | null }>("SELECT client_id, publish_at FROM welcome_messages WHERE studio_id = $studio AND id = $id AND status = 'pending'", { id: req.params.id });
    if (!w) throw notFound('Nie znaleziono powitania.');
    const scheduled = w.publish_at && Date.parse(w.publish_at) > Date.now();
    scope.run('UPDATE welcome_messages SET status = $s WHERE studio_id = $studio AND id = $id', { s: scheduled ? 'scheduled' : 'published', id: req.params.id });
    if (!scheduled) notify(scope, { userId: w.client_id, category: 'courses', tz: studio.timezone, body: 'Twoja trenerka napisała do Ciebie 💛', action: 'start' });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>('/api/owner/welcome/:id/reject', owner, async (req) => {
    const { scope, studio } = ctx(req);
    const w = scope.get<{ trainer_id: string }>("SELECT trainer_id FROM welcome_messages WHERE studio_id = $studio AND id = $id AND status = 'pending'", { id: req.params.id });
    if (!w) throw notFound();
    scope.run('DELETE FROM welcome_messages WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    notify(scope, { userId: w.trainer_id, category: 'courses', tz: studio.timezone, body: `Powitanie wróciło do poprawki${req.body?.note ? `: ${req.body.note.slice(0, 200)}` : '.'}`, action: 'staff/welcomes' });
    return { ok: true };
  });

  app.get('/api/owner/welcome/stats', owner, async (req) =>
    ctx(req).scope.all(
      `SELECT t.name AS trainer_name, COUNT(w.id) AS written, SUM(CASE WHEN w.seen_at IS NOT NULL THEN 1 ELSE 0 END) AS seen, SUM(CASE WHEN w.video_id IS NOT NULL THEN 1 ELSE 0 END) AS videos,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.studio_id = w.studio_id AND b.user_id = w.client_id AND b.created_at > w.created_at) THEN 1 ELSE 0 END) AS booked_after
       FROM memberships m JOIN users t ON t.id = m.user_id LEFT JOIN welcome_messages w ON w.studio_id = m.studio_id AND w.trainer_id = m.user_id AND w.kind = 'trainer'
       WHERE m.studio_id = $studio AND m.role = 'trainer' GROUP BY t.id`,
    ),
  );

  // ——— Rejestr zmian, kopia danych studia, plan i zużycie ———

  app.get<{ Querystring: { entity?: string } }>('/api/owner/audit', owner, async (req) =>
    ctx(req).scope.all(
      `SELECT a.action, a.entity, a.entity_id, a.details_json, a.created_at, u.name AS actor, s.name AS subject FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN users s ON s.id = a.subject_user_id
       WHERE a.studio_id = $studio ${req.query.entity ? 'AND a.entity = $e' : ''} ORDER BY a.created_at DESC LIMIT 200`,
      req.query.entity ? { e: req.query.entity } : {},
    ),
  );

  // Kopia zapasowa danych studia (4.11) – pełny zrzut w JSON, bez zaszyfrowanych danych zdrowotnych klientek.
  app.get('/api/owner/backup', owner, async (req, reply) => {
    const { scope, studio, user } = ctx(req);
    const tables = ['facilities', 'zones', 'class_types', 'schedule_templates', 'schedule_exceptions', 'class_sessions', 'products', 'product_versions', 'passes', 'bookings', 'payments', 'invoices', 'guest_passes', 'referrals', 'coupons', 'themes', 'challenges', 'rewards', 'shop_products', 'shop_orders', 'event_packages', 'private_events', 'courses', 'course_lessons', 'course_enrollments', 'playlists', 'campaigns'];
    const dump: Record<string, unknown> = { studio: { ...studio, has: undefined, logo_data: undefined }, exportedAt: nowIso() };
    for (const t of tables) {
      dump[t] = scope.all(`SELECT * FROM ${t} WHERE studio_id = $studio`).map((r) => Object.fromEntries(Object.entries(r as object).filter(([k, v]) => !(v instanceof Uint8Array) && !k.endsWith('_enc'))));
    }
    dump.clients = scope.all("SELECT u.id, u.name, u.phone, u.email, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role = 'client'");
    audit(scope, { actorId: user.id, action: 'backup.downloaded', entity: 'studio' });
    return reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="${studio.slug}-kopia-${new Date().toISOString().slice(0, 10)}.json"`).send(JSON.stringify(dump, null, 2));
  });

  app.get('/api/owner/plan', owner, async (req) => {
    const { scope, studio } = ctx(req);
    const plan = planById(studio.plan_id);
    const month = `${new Date().toISOString().slice(0, 7)}-01`;
    const facts = clientFacts(scope);
    const active = facts.filter((f) => f.lastVisit && Date.now() - Date.parse(f.lastVisit) < 30 * 86_400_000).length;
    const sms = scope.get<{ n: number; cost: number }>("SELECT COALESCE(SUM(units), 0) AS n, COALESCE(SUM(cost_grosze), 0) AS cost FROM usage_log WHERE studio_id = $studio AND kind = 'sms' AND created_at >= $m", { m: month })!;
    const storage = scope.get<{ b: number }>('SELECT COALESCE(SUM(size), 0) AS b FROM media WHERE studio_id = $studio')!.b;
    const staffN = scope.get<{ n: number }>("SELECT COUNT(DISTINCT user_id) AS n FROM memberships WHERE studio_id = $studio AND role != 'client'")!.n;
    const facilities = scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM facilities WHERE studio_id = $studio')!.n;
    return {
      plan: { ...plan, price: formatPLN(plan.priceGrosze) },
      status: studio.status,
      trialEndsAt: studio.trial_ends_at,
      flags: studio.flags,
      features: Object.fromEntries(['courses', 'courses_paid', 'challenges', 'community', 'shop', 'events', 'music', 'campaigns', 'white_label', 'loyalty', 'health', 'cycle', 'catalog', 'network', 'split_payments', 'beta_widgets'].map((f) => [f, studio.has(f as never)])),
      usage: { activeClients: active, smsThisMonth: sms.n, smsCost: formatPLN(sms.cost), storageMb: Math.round(storage / 100_000) / 10, staff: staffN, facilities },
    };
  });
}
