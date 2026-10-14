// Wydarzenia prywatne (4.13, W1–W6): kreator (typ i termin z wolnych slotów sali i trenerki, liczba osób, trenerka,
// sala i zajęcia, dodatki), cennik pakietów albo „cena do ustalenia”, zaliczka online lub płatność na miejscu,
// zaproszenia z RSVP, blokada sali i trenerki w grafiku, notatki, historia ustaleń.
import type { FastifyInstance } from 'fastify';
import {
  addDays,
  canClientCancel,
  EVENT_ACTIVITIES,
  EVENT_ADDONS,
  EVENT_KINDS,
  EVENT_STATUS_LABEL,
  eventTransitionOk,
  formatPLN,
  freeSlots,
  localParts,
  validateEventRequest,
  zonedToUtc,
  type EventStatus,
} from '@glam/core';
import { assertFeature, ctx, requirePerm, requireStudio, type Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { HttpError, badRequest, conflict, notFound } from '../errors.ts';
import { StudioScope } from '../scope.ts';
import { PAYMENT_METHODS, type PaymentMethod } from '../sms.ts';
import { audit } from '../services/audit.ts';
import { notify } from '../services/notify.ts';
import { recordPayment } from '../services/payments.ts';
import type { Studio } from '../services/studio.ts';
import { guestCode } from './client.ts';

type EventRow = {
  id: string;
  client_id: string;
  kind: string;
  /** Nazwa wydarzenia organizowanego przez studio (np. tematyczne zajęcia); prywatne wydarzenia klientek jej nie mają. */
  title: string | null;
  package_id: string | null;
  trainer_id: string | null;
  zone_id: string | null;
  activity: string;
  starts_at: string;
  ends_at: string;
  guests: number;
  addons_json: string;
  client_note: string | null;
  internal_note: string | null;
  status: EventStatus;
  price_grosze: number | null;
  deposit_grosze: number | null;
  payment_mode: 'deposit' | 'on_site' | 'private';
  offer_text: string | null;
  invite_code: string;
  history_json: string;
  created_at: string;
};

function busy(scope: StudioScope, studio: Studio, date: string) {
  const from = zonedToUtc(date, '00:00', studio.timezone).toISOString();
  const to = zonedToUtc(addDays(date, 1), '00:00', studio.timezone).toISOString();
  const sessions = scope.all<{ start: string; end: string; zone_id: string; trainer_id: string }>(
    "SELECT s.starts_at AS start, s.ends_at AS end, ct.zone_id, s.trainer_id FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id WHERE s.studio_id = $studio AND s.status = 'scheduled' AND s.starts_at < $to AND s.ends_at > $from",
    { from, to },
  );
  const events = scope.all<{ start: string; end: string; zone_id: string | null; trainer_id: string | null }>(
    "SELECT starts_at AS start, ends_at AS end, zone_id, trainer_id FROM private_events WHERE studio_id = $studio AND status IN ('offer', 'confirmed', 'paid') AND starts_at < $to AND ends_at > $from",
    { from, to },
  );
  return [...sessions, ...events];
}

function history(e: Pick<EventRow, 'history_json'>, entry: { by: string; text: string }) {
  return JSON.stringify([...(JSON.parse(e.history_json) as unknown[]), { ...entry, at: nowIso() }]);
}

/** Blokada (W6): sala i trenerka wyjęte z grafiku publicznego – sesja niewidoczna dla klientek. */
function blockSchedule(scope: StudioScope, e: EventRow) {
  if (!e.zone_id || !e.trainer_id) return;
  const ct = scope.get<{ id: string }>('SELECT id FROM class_types WHERE studio_id = $studio AND zone_id = $z LIMIT 1', { z: e.zone_id });
  if (!ct) return;
  scope.run(
    `INSERT INTO class_sessions (id, studio_id, template_id, class_type_id, trainer_id, starts_at, ends_at, capacity, kind, title, public)
     SELECT $id, $studio, NULL, $ct, $t, $s, $end, $cap, 'event', $title, 0
     WHERE NOT EXISTS (SELECT 1 FROM class_sessions WHERE studio_id = $studio AND kind = 'event' AND title = $title)`,
    { id: id(), ct: ct.id, t: e.trainer_id, s: e.starts_at, end: e.ends_at, cap: e.guests, title: `Wydarzenie prywatne ${e.invite_code}` },
  );
}

export function eventRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const member = { preHandler: requireStudio(db) };
  const manage = requirePerm(db, 'events.manage');

  app.get('/api/events/options', member, async (req) => {
    const { scope, studio } = ctx(req);
    assertFeature(studio, 'events');
    return {
      kinds: EVENT_KINDS,
      activities: EVENT_ACTIVITIES,
      addons: EVENT_ADDONS,
      regulations: studio.settings.events.regulations,
      minNoticeDays: studio.settings.events.minNoticeDays,
      packages: scope.all<{ price_grosze: number | null; deposit_grosze: number | null; kinds_json: string; addons_json: string }>('SELECT * FROM event_packages WHERE studio_id = $studio AND active = 1').map((p) => ({
        ...p,
        kinds: JSON.parse(p.kinds_json),
        addons: JSON.parse(p.addons_json),
        price: p.price_grosze ? formatPLN(p.price_grosze) : 'cena do ustalenia',
        deposit: p.deposit_grosze ? formatPLN(p.deposit_grosze) : null,
      })),
      trainers: scope.all("SELECT u.id, u.name, m.bio, CASE WHEN u.avatar_mime IS NOT NULL THEN '/api/users/' || u.id || '/avatar?v=' || u.avatar_version END AS avatar_url FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role = 'trainer' ORDER BY u.name"),
      zones: scope.all("SELECT id, name FROM zones WHERE studio_id = $studio AND access IN ('reserved', 'mixed') ORDER BY name"),
    };
  });

  // Krok 1: wolne sloty – tylko te, w których wolna jest sala i wybrana trenerka.
  app.get<{ Querystring: { date: string; zoneId: string; trainerId: string; durationMin?: string } }>('/api/events/slots', member, async (req) => {
    const { scope, studio } = ctx(req);
    const q = req.query;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date ?? '')) throw badRequest('Wybierz dzień.');
    const b = busy(scope, studio, q.date);
    const slots = freeSlots({
      dayStartIso: zonedToUtc(q.date, '08:00', studio.timezone).toISOString(),
      dayEndIso: zonedToUtc(q.date, '22:00', studio.timezone).toISOString(),
      durationMin: Number(q.durationMin) || 90,
      busyZone: b.filter((x) => x.zone_id === q.zoneId),
      busyTrainer: b.filter((x) => x.trainer_id === q.trainerId),
      notBeforeIso: new Date(Date.now() + studio.settings.events.minNoticeDays * 86_400_000).toISOString(),
    });
    return slots.map((s) => ({ startsAt: s, time: localParts(new Date(s), studio.timezone).time }));
  });

  app.post<{ Body: { kind: string; packageId?: string | null; trainerId: string; zoneId: string; activity: string; startsAt: string; durationMin?: number; guests: number; addons?: string[]; note?: string; termsAccepted: boolean } }>(
    '/api/events',
    member,
    async (req) => {
      const { scope, studio, user } = ctx(req);
      assertFeature(studio, 'events');
      if (!studio.settings.events.enabled) throw conflict('off', 'Studio nie przyjmuje teraz wydarzeń.');
      const b = req.body ?? ({} as typeof req.body);
      if (!EVENT_KINDS.some((k) => k.id === b.kind)) throw badRequest('Wybierz typ wydarzenia.');
      if (!EVENT_ACTIVITIES.includes(b.activity as (typeof EVENT_ACTIVITIES)[number])) throw badRequest('Wybierz rodzaj zajęć.');
      const pkg = b.packageId ? scope.get<{ id: string; min_guests: number; max_guests: number; duration_min: number; price_grosze: number | null; deposit_grosze: number | null }>('SELECT * FROM event_packages WHERE studio_id = $studio AND id = $id AND active = 1', { id: b.packageId }) : undefined;
      if (b.packageId && !pkg) throw notFound('Ten pakiet nie jest już dostępny.');
      const err = validateEventRequest({ guests: b.guests, min: pkg?.min_guests ?? 2, max: pkg?.max_guests ?? 20, startsAt: b.startsAt, now: new Date(), minNoticeDays: studio.settings.events.minNoticeDays, termsAccepted: !!b.termsAccepted });
      if (err) throw badRequest(err);
      if (!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $t AND role = 'trainer'", { t: b.trainerId })) throw notFound('Nie znaleziono trenerki.');
      const duration = pkg?.duration_min ?? b.durationMin ?? 90;
      const start = new Date(b.startsAt);
      const end = new Date(start.getTime() + duration * 60_000);
      const date = localParts(start, studio.timezone).date;
      const taken = busy(scope, studio, date).some((x) => (x.zone_id === b.zoneId || x.trainer_id === b.trainerId) && x.start < end.toISOString() && start.toISOString() < x.end);
      if (taken) throw conflict('slot_taken', 'Ten termin właśnie się zajął. Wybierz inny.');
      const eid = id();
      const price = pkg?.price_grosze ?? null;
      const status: EventStatus = price ? 'offer' : 'inquiry';
      scope.run(
        `INSERT INTO private_events (id, studio_id, client_id, kind, package_id, trainer_id, zone_id, activity, starts_at, ends_at, guests, addons_json, client_note, status, price_grosze, deposit_grosze, payment_mode, invite_code, terms_accepted_at, history_json, created_at, updated_at)
         VALUES ($id, $studio, $c, $k, $p, $t, $z, $a, $s, $e, $g, $add, $note, $st, $price, $dep, $mode, $code, $now, $h, $now, $now)`,
        {
          id: eid,
          c: user.id,
          k: b.kind,
          p: pkg?.id ?? null,
          t: b.trainerId,
          z: b.zoneId,
          a: b.activity,
          s: start.toISOString(),
          e: end.toISOString(),
          g: b.guests,
          add: JSON.stringify((b.addons ?? []).filter((x) => EVENT_ADDONS.some((a) => a.id === x))),
          note: b.note?.slice(0, 1000) ?? null,
          st: status,
          price,
          dep: pkg?.deposit_grosze ?? null,
          mode: pkg?.deposit_grosze ? 'deposit' : 'on_site',
          code: `E${guestCode(7)}`,
          h: JSON.stringify([{ by: user.name ?? 'Klientka', text: price ? 'Rezerwacja z cennika' : 'Zapytanie o wydarzenie', at: nowIso() }]),
          now: nowIso(),
        },
      );
      for (const s of scope.all<{ user_id: string }>("SELECT DISTINCT user_id FROM memberships WHERE studio_id = $studio AND role IN ('reception', 'owner')")) {
        notify(scope, { userId: s.user_id, category: 'events', tz: studio.timezone, body: `${price ? 'Nowa rezerwacja' : 'Nowe zapytanie'}: ${EVENT_KINDS.find((k) => k.id === b.kind)!.label}, ${date}.`, action: 'staff/events' });
      }
      notify(scope, { userId: b.trainerId, category: 'events', tz: studio.timezone, body: `Wydarzenie ${date} (${b.guests} os.) – sprawdź szczegóły.`, action: 'staff/events' });
      return { id: eid, status, message: price ? 'Termin zarezerwowany. Opłać zaliczkę albo zapłać na miejscu – zgodnie z zasadami studia.' : 'Zapytanie wysłane. Studio przygotuje ofertę w aplikacji albo skontaktuje się z Tobą.' };
    },
  );

  const eventView = (scope: StudioScope, studio: Studio, e: EventRow, internal: boolean) => ({
    ...e,
    internal_note: internal ? e.internal_note : undefined,
    addons: JSON.parse(e.addons_json),
    history: internal ? JSON.parse(e.history_json) : (JSON.parse(e.history_json) as { by: string; text: string; at: string }[]).filter((h) => !h.text.startsWith('[wewn.]')),
    statusLabel: EVENT_STATUS_LABEL[e.status],
    kindLabel: EVENT_KINDS.find((k) => k.id === e.kind)?.label,
    price: e.price_grosze ? formatPLN(e.price_grosze) : null,
    deposit: e.deposit_grosze ? formatPLN(e.deposit_grosze) : null,
    trainer: e.trainer_id ? (scope.db.prepare('SELECT name FROM users WHERE id = ?').get(e.trainer_id) as { name: string }).name : null,
    client: (scope.db.prepare('SELECT name FROM users WHERE id = ?').get(e.client_id) as { name: string | null }).name,
    zone: e.zone_id ? scope.get<{ name: string }>('SELECT name FROM zones WHERE studio_id = $studio AND id = $z', { z: e.zone_id })?.name : null,
    guestsList: scope.all('SELECT id, name, rsvp, photo_consent FROM event_guests WHERE studio_id = $studio AND event_id = $e ORDER BY created_at', { e: e.id }),
    inviteLink: `${deps.publicUrl ?? ''}/zaproszenie/${e.invite_code}`,
    canCancel: canClientCancel(e.starts_at, new Date(), studio.settings.events.cancelDays) && ['inquiry', 'offer', 'confirmed', 'paid'].includes(e.status),
  });

  app.get('/api/my/events', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    return scope.all<EventRow>('SELECT * FROM private_events WHERE studio_id = $studio AND client_id = $u ORDER BY starts_at DESC', { u: user.id }).map((e) => eventView(scope, studio, e, false));
  });

  app.get<{ Params: { id: string } }>('/api/events/:id', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const e = scope.get<EventRow>('SELECT * FROM private_events WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    const staff = roles.some((r) => r === 'reception' || r === 'owner');
    if (!e || (e.client_id !== user.id && !staff && e.trainer_id !== user.id)) throw notFound();
    return eventView(scope, studio, e, staff);
  });

  // Klientka: zmiana godziny w ramach ustaleń, notatka dla trenerki, akceptacja oferty, zaliczka, odwołanie.
  app.post<{ Params: { id: string }; Body: { action: 'accept' | 'pay' | 'cancel' | 'note' | 'reschedule'; method?: PaymentMethod; note?: string; startsAt?: string } }>('/api/events/:id/client', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const e = scope.get<EventRow>('SELECT * FROM private_events WHERE studio_id = $studio AND id = $id AND client_id = $u', { id: req.params.id, u: user.id });
    if (!e) throw notFound();
    const b = req.body ?? ({} as typeof req.body);
    const set = (status: EventStatus, text: string, extra = '') =>
      scope.run(`UPDATE private_events SET status = $s, history_json = $h, updated_at = $now ${extra} WHERE studio_id = $studio AND id = $id`, { s: status, h: history(e, { by: user.name ?? 'Klientka', text }), now: nowIso(), id: e.id });
    if (b.action === 'note') {
      scope.run('UPDATE private_events SET client_note = $n, history_json = $h, updated_at = $now WHERE studio_id = $studio AND id = $id', { n: b.note?.slice(0, 1000) ?? null, h: history(e, { by: user.name ?? 'Klientka', text: 'Zaktualizowana notatka' }), now: nowIso(), id: e.id });
      if (e.trainer_id) notify(scope, { userId: e.trainer_id, category: 'events', tz: studio.timezone, body: 'Klientka dodała notatkę do wydarzenia (np. muzyka, imię solenizantki).', action: 'staff/events' });
      return { ok: true };
    }
    if (b.action === 'cancel') {
      if (!canClientCancel(e.starts_at, new Date(), studio.settings.events.cancelDays)) throw conflict('late', `Wydarzenie można odwołać najpóźniej ${studio.settings.events.cancelDays} dni przed terminem. Napisz do studia.`);
      set('cancelled', 'Odwołane przez klientkę');
      scope.run("UPDATE class_sessions SET status = 'cancelled' WHERE studio_id = $studio AND kind = 'event' AND title = $t", { t: `Wydarzenie prywatne ${e.invite_code}` });
      return { message: 'Wydarzenie odwołane.' };
    }
    if (b.action === 'reschedule') {
      // Zmiana godziny w ramach ustaleń: ten sam dzień, wolny slot sali i trenerki.
      if (!b.startsAt || localParts(new Date(b.startsAt), studio.timezone).date !== localParts(new Date(e.starts_at), studio.timezone).date) throw badRequest('Godzinę zmienisz w obrębie tego samego dnia. Inny dzień – napisz do studia.');
      const dur = Date.parse(e.ends_at) - Date.parse(e.starts_at);
      const s = new Date(b.startsAt);
      const en = new Date(s.getTime() + dur);
      const taken = busy(scope, studio, localParts(s, studio.timezone).date).some((x) => x.start !== e.starts_at && (x.zone_id === e.zone_id || x.trainer_id === e.trainer_id) && x.start < en.toISOString() && s.toISOString() < x.end);
      if (taken) throw conflict('slot_taken', 'Ta godzina jest zajęta.');
      scope.run('UPDATE private_events SET starts_at = $s, ends_at = $e, history_json = $h, updated_at = $now WHERE studio_id = $studio AND id = $id', { s: s.toISOString(), e: en.toISOString(), h: history(e, { by: user.name ?? 'Klientka', text: `Zmiana godziny na ${localParts(s, studio.timezone).time}` }), now: nowIso(), id: e.id });
      scope.run("UPDATE class_sessions SET starts_at = $s, ends_at = $e WHERE studio_id = $studio AND kind = 'event' AND title = $t", { s: s.toISOString(), e: en.toISOString(), t: `Wydarzenie prywatne ${e.invite_code}` });
      return { ok: true };
    }
    if (b.action === 'accept') {
      if (e.status !== 'offer') throw conflict('state', 'Nie ma oferty do akceptacji.');
      set('confirmed', 'Oferta zaakceptowana');
      blockSchedule(scope, { ...e, status: 'confirmed' });
      return { message: 'Potwierdzone! Do zobaczenia w studiu 🎉' };
    }
    if (b.action === 'pay') {
      if (!['offer', 'confirmed'].includes(e.status) || !e.price_grosze) throw conflict('state', 'To wydarzenie nie czeka na płatność.');
      if (!PAYMENT_METHODS.includes(b.method as (typeof PAYMENT_METHODS)[number])) throw badRequest('Wybierz metodę płatności.');
      const amount = e.payment_mode === 'deposit' && e.deposit_grosze ? e.deposit_grosze : e.price_grosze;
      const charge = await deps.payments.charge({ amountGrosze: amount, method: b.method!, description: `Wydarzenie ${e.invite_code}`, studioId: studio.id });
      if (charge.status !== 'paid') throw new HttpError(402, 'payment_failed', 'Płatność się nie powiodła.');
      scope.tx(() => {
        recordPayment(scope, { userId: user.id, kind: 'event', ref: e.id, amount, method: b.method!, providerRef: charge.ref, description: `${e.payment_mode === 'deposit' ? 'Zaliczka' : 'Opłata'}: wydarzenie ${e.invite_code}` });
        set('paid', e.payment_mode === 'deposit' ? `Zaliczka ${formatPLN(amount)}` : `Opłata ${formatPLN(amount)}`);
        blockSchedule(scope, e);
      });
      return { message: 'Opłacone. Dziękujemy!' };
    }
    throw badRequest('Nieznana akcja.');
  });

  // W4: zaproszenia dla gości i RSVP – link lub QR, dane gości usuwane po wydarzeniu (4.13.6).
  app.get<{ Params: { code: string } }>('/api/invite/:code', async (req) => {
    const e = db.prepare("SELECT e.id, e.kind, e.starts_at, e.activity, e.status, s.name AS studio, s.address, s.timezone, u.name AS host FROM private_events e JOIN studios s ON s.id = e.studio_id JOIN users u ON u.id = e.client_id WHERE e.invite_code = ? AND e.status IN ('offer', 'confirmed', 'paid')").get(req.params.code) as
      | { id: string; kind: string; starts_at: string; activity: string; studio: string; address: string | null; timezone: string; host: string | null }
      | undefined;
    if (!e) throw notFound('To zaproszenie wygasło.');
    const lp = localParts(new Date(e.starts_at), e.timezone);
    return { kind: EVENT_KINDS.find((k) => k.id === e.kind)?.label, date: lp.date, time: lp.time, activity: e.activity, studio: e.studio, address: e.address, host: e.host };
  });

  app.post<{ Params: { code: string }; Body: { name: string; contact?: string; rsvp: 'yes' | 'no'; photoConsent?: boolean } }>('/api/invite/:code', async (req) => {
    const e = db.prepare("SELECT id, studio_id, client_id, guests FROM private_events WHERE invite_code = ? AND status IN ('offer', 'confirmed', 'paid')").get(req.params.code) as { id: string; studio_id: string; client_id: string; guests: number } | undefined;
    if (!e) throw notFound('To zaproszenie wygasło.');
    const name = String(req.body?.name ?? '').trim().slice(0, 60);
    if (name.length < 2 || !['yes', 'no'].includes(req.body?.rsvp)) throw badRequest('Podaj imię i odpowiedź.');
    const scope = new StudioScope(db, e.studio_id);
    const yes = scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_guests WHERE studio_id = $studio AND event_id = $e AND rsvp = 'yes'", { e: e.id })!.n;
    if (req.body.rsvp === 'yes' && yes >= e.guests) throw conflict('full', 'Lista gości jest już pełna – daj znać organizatorce.');
    scope.run('INSERT INTO event_guests (id, studio_id, event_id, name, contact, rsvp, photo_consent, created_at) VALUES ($id, $studio, $e, $n, $c, $r, $p, $now)', {
      id: id(),
      e: e.id,
      n: name,
      c: req.body.contact?.slice(0, 80) ?? null,
      r: req.body.rsvp,
      p: Number(!!req.body.photoConsent),
      now: nowIso(),
    });
    notify(scope, { userId: e.client_id, category: 'events', tz: 'Europe/Warsaw', body: `${name} ${req.body.rsvp === 'yes' ? 'potwierdza obecność 🎉' : 'nie da rady przyjść'}.`, action: `event/${e.id}` });
    return { message: req.body.rsvp === 'yes' ? 'Dziękujemy! Do zobaczenia w studiu.' : 'Dziękujemy za odpowiedź.' };
  });

  // ——— Recepcja i właścicielka (4.13.4): lista, kalendarz, oferta, notatka wewnętrzna, historia ustaleń ———

  app.get('/api/staff/events', { preHandler: requireStudio(db, ['trainer', 'reception', 'owner']) }, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const internal = roles.some((r) => r === 'reception' || r === 'owner');
    const rows = scope.all<EventRow>(`SELECT * FROM private_events WHERE studio_id = $studio ${internal ? '' : 'AND trainer_id = $me'} ORDER BY status IN ('done', 'cancelled'), starts_at`, internal ? {} : { me: user.id });
    return rows.map((e) => eventView(scope, studio, e, internal));
  });

  app.post<{ Params: { id: string }; Body: { status?: EventStatus; price?: number; deposit?: number | null; paymentMode?: 'deposit' | 'on_site' | 'private'; offer?: string; internalNote?: string; trainerId?: string } }>('/api/staff/events/:id', manage, async (req) => {
    const { scope, studio, user } = ctx(req);
    const e = scope.get<EventRow>('SELECT * FROM private_events WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!e) throw notFound();
    const b = req.body ?? {};
    let h = e.history_json;
    const add = (text: string) => (h = history({ history_json: h }, { by: user.name ?? 'Studio', text }));
    if (b.status && b.status !== e.status && !eventTransitionOk(e.status, b.status)) throw conflict('transition', `Nie można przejść ze statusu „${EVENT_STATUS_LABEL[e.status]}” do „${EVENT_STATUS_LABEL[b.status]}”.`);
    if (b.price !== undefined && !(b.price >= 0)) throw badRequest('Nieprawidłowa cena.');
    if (b.trainerId && !scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $t AND role = 'trainer'", { t: b.trainerId })) throw notFound('Nie znaleziono trenerki.');
    if (b.offer) add(`Oferta: ${b.offer.slice(0, 300)}`);
    if (b.internalNote) add('[wewn.] notatka zaktualizowana');
    if (b.status) add(`Status: ${EVENT_STATUS_LABEL[b.status]}`);
    if (b.paymentMode === 'private') add('Ustalenia prywatne poza aplikacją');
    scope.run(
      `UPDATE private_events SET status = COALESCE($s, status), price_grosze = COALESCE($p, price_grosze), deposit_grosze = CASE WHEN $setd = 1 THEN $d ELSE deposit_grosze END,
       payment_mode = COALESCE($m, payment_mode), offer_text = COALESCE($o, offer_text), internal_note = COALESCE($n, internal_note), trainer_id = COALESCE($t, trainer_id), history_json = $h, updated_at = $now
       WHERE studio_id = $studio AND id = $id`,
      { s: b.status ?? (b.offer && e.status === 'inquiry' ? 'offer' : null), p: b.price ?? null, setd: Number(b.deposit !== undefined), d: b.deposit ?? null, m: b.paymentMode ?? null, o: b.offer ?? null, n: b.internalNote ?? null, t: b.trainerId ?? null, h, now: nowIso(), id: e.id },
    );
    const fresh = scope.get<EventRow>('SELECT * FROM private_events WHERE studio_id = $studio AND id = $id', { id: e.id })!;
    if (['confirmed', 'paid'].includes(fresh.status)) blockSchedule(scope, fresh);
    if (fresh.status === 'cancelled') scope.run("UPDATE class_sessions SET status = 'cancelled' WHERE studio_id = $studio AND kind = 'event' AND title = $t", { t: `Wydarzenie prywatne ${e.invite_code}` });
    if (b.offer || (b.status && b.status !== e.status)) {
      notify(scope, { userId: e.client_id, category: 'events', tz: studio.timezone, body: b.offer ? 'Studio przygotowało ofertę na Twoje wydarzenie 🎉' : `Twoje wydarzenie: ${EVENT_STATUS_LABEL[fresh.status]}.`, action: `event/${e.id}` });
    }
    audit(scope, { actorId: user.id, action: 'event.updated', entity: 'event', entityId: e.id, subjectUserId: e.client_id, details: { status: b.status } });
    return { ok: true };
  });

  // W2: cennik pakietów wydarzeń.
  app.get('/api/staff/event-packages', manage, async (req) => ctx(req).scope.all<{ kinds_json: string; addons_json: string }>('SELECT * FROM event_packages WHERE studio_id = $studio ORDER BY name').map((p) => ({ ...p, kinds: JSON.parse(p.kinds_json), addons: JSON.parse(p.addons_json) })));

  app.post<{ Body: { name: string; kinds: string[]; minGuests: number; maxGuests: number; durationMin: number; priceGrosze?: number | null; depositGrosze?: number | null; addons?: string[] } }>('/api/staff/event-packages', manage, async (req) => {
    const { scope, user } = ctx(req);
    const b = req.body;
    if (!b?.name?.trim() || !(b.minGuests >= 1) || !(b.maxGuests >= b.minGuests) || !(b.durationMin >= 30)) throw badRequest('Podaj nazwę, liczbę osób (min–max) i czas trwania.');
    scope.run('INSERT INTO event_packages (id, studio_id, name, kinds_json, min_guests, max_guests, duration_min, price_grosze, deposit_grosze, addons_json, active) VALUES ($id, $studio, $n, $k, $min, $max, $d, $p, $dep, $a, 1)', {
      id: id(),
      n: b.name.trim().slice(0, 60),
      k: JSON.stringify((b.kinds ?? []).filter((k) => EVENT_KINDS.some((x) => x.id === k))),
      min: b.minGuests,
      max: b.maxGuests,
      d: b.durationMin,
      p: b.priceGrosze ?? null,
      dep: b.depositGrosze ?? null,
      a: JSON.stringify(b.addons ?? []),
    });
    audit(scope, { actorId: user.id, action: 'event_package.created', entity: 'event_package' });
    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Body: { active: boolean } }>('/api/staff/event-packages/:id', manage, async (req) => {
    ctx(req).scope.run('UPDATE event_packages SET active = $a WHERE studio_id = $studio AND id = $id', { a: Number(!!req.body?.active), id: req.params.id });
    return { ok: true };
  });

}
