// Publiczna strona sprzedażowa kursu: /s/:slug/kurs/:id (wzór: audyt landingu STRETCH&GLOW).
// Bez sesji, tylko to, co studio i tak pokazuje światu – jak routes/public.ts. Dwa kanały dostępu (decyzja B, 2026-10-15):
//   1) zakup pakietu na www – konto zakładane z numeru telefonu (+ e-mail), dostęp od razu w aplikacji /app
//      (logowanie kodem SMS na ten sam numer – strona nie wydaje sesji, bo nie sprawdza, czyj to numer);
//   2) dostęp w karnecie – istniejące passCoversCourse; strona pokazuje, które karnety go dają.
import type { FastifyInstance } from 'fastify';
import {
  averageMinutes,
  coursePrice,
  currentEdition,
  editionState,
  formatPLN,
  parseCoursePage,
  purchaseAccessUntil,
  tierComparison,
  trainingCalendar,
  type CourseEdition,
  type CourseTier,
} from '@glam/core';
import { normalizePhone } from '../auth.ts';
import type { Deps } from '../context.ts';
import { signStreamUrl } from '../crypto.ts';
import { id, nowIso, type Db } from '../db.ts';
import { HttpError, badRequest, conflict, notFound } from '../errors.ts';
import { StudioScope } from '../scope.ts';
import { PAYMENT_METHODS, type PaymentMethod } from '../sms.ts';
import { audit } from '../services/audit.ts';
import { notify } from '../services/notify.ts';
import { priceWithCoupon, recordPayment } from '../services/payments.ts';
import { loadStudio, logoInfo } from '../services/studio.ts';

type CourseRow = {
  id: string;
  author_id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  level: string;
  contraindications: string | null;
  access_days: number | null;
  drip_days: number;
  promo_pct: number;
  included_product_ids_json: string;
  cover_media_id: string | null;
  page_json: string | null;
};
type LessonRow = { id: string; module: string; title: string; kind: string; media_id: string | null; video_url: string | null; duration_sec: number; unlock_day: number; free_preview: number; person_id: string | null; sort: number };
type EditionRow = { id: string; name: string; theme: string | null; sales_from: string | null; sales_until: string | null; starts_at: string | null; access_until: string | null; news_json: string };
type TierRow = { id: string; name: string; price_grosze: number; features_json: string; highlight: number; seat_limit: number | null };
type PersonRow = { id: string; user_id: string | null; name: string; role: 'author' | 'trainer' | 'expert'; title: string | null; bio: string | null; photo_media_id: string | null; avatar_mime: string | null; avatar_version: number | null };

const editionOf = (e: EditionRow): CourseEdition => ({
  id: e.id,
  name: e.name,
  theme: e.theme,
  salesFrom: e.sales_from,
  salesUntil: e.sales_until,
  startsAt: e.starts_at,
  accessUntil: e.access_until,
  news: (JSON.parse(e.news_json) as { title: string; body: string }[]).filter((n) => n?.title),
});
const tierOf = (t: TierRow): CourseTier => ({ id: t.id, name: t.name, priceGrosze: t.price_grosze, features: JSON.parse(t.features_json), highlight: !!t.highlight, seatLimit: t.seat_limit });

/** Studio z publiczną stroną i kurs opublikowany – inaczej 404 (bez zdradzania, co istnieje). */
function load(db: Db, slug: string, courseId: string) {
  const row = db.prepare("SELECT id FROM studios WHERE slug = ? AND published = 1 AND status != 'suspended'").get(slug) as { id: string } | undefined;
  if (!row) throw notFound('Nie ma takiego studia.');
  const studio = loadStudio(db, row.id);
  if (!studio.has('courses')) throw notFound('Nie ma takiego kursu.');
  const scope = new StudioScope(db, studio.id);
  const course = scope.get<CourseRow>("SELECT * FROM courses WHERE studio_id = $studio AND id = $id AND status = 'published'", { id: courseId });
  if (!course) throw notFound('Nie ma takiego kursu.');
  const editions = scope.all<EditionRow>('SELECT * FROM course_editions WHERE studio_id = $studio AND course_id = $c', { c: course.id }).map(editionOf);
  const edition = currentEdition(editions, new Date());
  const tiers = scope.all<TierRow>('SELECT * FROM course_tiers WHERE studio_id = $studio AND course_id = $c AND active = 1 ORDER BY sort', { c: course.id }).map(tierOf);
  return { studio, scope, course, edition, tiers };
}

const sold = (scope: StudioScope, tierId: string) => scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM course_enrollments WHERE studio_id = $studio AND tier_id = $t', { t: tierId })!.n;

export function coursePageRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;

  app.get<{ Params: { slug: string; id: string } }>('/api/public/studios/:slug/courses/:id', async (req) => {
    const { studio, scope, course, edition, tiers } = load(db, req.params.slug, req.params.id);
    const now = new Date();
    const lessons = scope.all<LessonRow>('SELECT id, module, title, kind, media_id, video_url, duration_sec, unlock_day, free_preview, person_id, sort FROM course_lessons WHERE studio_id = $studio AND course_id = $c ORDER BY sort', { c: course.id });
    const people = scope.all<PersonRow>(
      'SELECT p.id, p.user_id, p.name, p.role, p.title, p.bio, p.photo_media_id, u.avatar_mime, u.avatar_version FROM course_people p LEFT JOIN users u ON u.id = p.user_id WHERE p.studio_id = $studio AND p.course_id = $c ORDER BY p.sort',
      { c: course.id },
    );
    const page = parseCoursePage(course.page_json ? JSON.parse(course.page_json) : null);

    // Program moduł po module: liczba treningów, minuty i kto prowadzi (z lekcji).
    const modules = [...new Set(lessons.map((l) => l.module))].map((name) => {
      const ls = lessons.filter((l) => l.module === name);
      return {
        name,
        lessons: ls.length,
        minutes: Math.round(ls.reduce((s, l) => s + l.duration_sec, 0) / 60),
        people: [...new Set(ls.map((l) => l.person_id).filter((p): p is string => !!p))],
        titles: ls.map((l) => l.title),
      };
    });

    // Trailer = pierwsza darmowa lekcja, najlepiej z filmem (wgranym albo linkiem; podpisany link jak w odtwarzaczu).
    // Bez filmu strona pokazuje ją jako „darmową lekcję w aplikacji”.
    const free = lessons.find((l) => l.free_preview && (l.media_id || l.video_url)) ?? lessons.find((l) => l.free_preview);
    const state = editionState(edition, now);

    // Kanał „w karnecie”: produkty, które dają dostęp (klocek courseIds albo produkt wskazany w kursie).
    const included = JSON.parse(course.included_product_ids_json) as string[];
    const passProducts = scope
      .all<{ id: string; name: string; price_grosze: number; rules_json: string }>(
        'SELECT p.id, p.name, v.price_grosze, v.rules_json FROM products p JOIN product_versions v ON v.id = p.current_version_id WHERE p.studio_id = $studio AND p.published = 1 ORDER BY v.price_grosze',
      )
      .filter((p) => {
        const ids = (JSON.parse(p.rules_json) as { courseIds?: string[] | 'all' }).courseIds;
        return included.includes(p.id) || ids === 'all' || (Array.isArray(ids) && ids.includes(course.id));
      })
      .map((p) => ({ id: p.id, name: p.name, price: formatPLN(p.price_grosze) }));

    return {
      studio: {
        slug: studio.slug,
        name: studio.name,
        city: studio.city,
        look: studio.look,
        logo: studio.logo,
        ...logoInfo(studio),
        email: studio.email,
        phone: studio.phone,
        address: studio.address,
        nip: studio.nip,
        timezone: studio.timezone,
        regulations: studio.regulations,
      },
      course: {
        id: course.id,
        title: course.title,
        subtitle: course.subtitle,
        description: course.description,
        level: course.level,
        contraindications: course.contraindications,
        coverUrl: course.cover_media_id ? `/api/public-media/${course.cover_media_id}` : null,
        lessons: lessons.length,
        minutes: Math.round(lessons.reduce((s, l) => s + l.duration_sec, 0) / 60),
        averageMinutes: averageMinutes(lessons.map((l) => ({ durationSec: l.duration_sec }))),
        accessDays: course.access_days,
      },
      page,
      edition: edition ? { ...edition, state } : null,
      salesOpen: state === 'on_sale',
      trailer: free ? { title: free.title, url: free.media_id ? signStreamUrl(free.media_id) : free.video_url ?? null, minutes: Math.round(free.duration_sec / 60) } : null,
      modules,
      calendar: trainingCalendar(
        lessons.map((l) => ({ id: l.id, title: l.title, module: l.module, unlockDay: l.unlock_day, durationSec: l.duration_sec, sort: l.sort })),
        course.drip_days,
      ).map((d) => ({ day: d.day, minutes: d.minutes, lessons: d.lessons.map((l) => l.title) })),
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        title: p.title,
        bio: p.bio,
        photoUrl: p.photo_media_id ? `/api/public-media/${p.photo_media_id}` : p.user_id && p.avatar_mime ? `/api/users/${p.user_id}/avatar?v=${p.avatar_version}` : null,
      })),
      tiers: tiers.map((t) => {
        const price = coursePrice(t.priceGrosze, { promoPct: course.promo_pct, passDiscountPct: 0, hasActivePass: false });
        return {
          id: t.id,
          name: t.name,
          features: t.features,
          highlight: t.highlight,
          price: formatPLN(price.price),
          fullPrice: price.discountPct ? formatPLN(t.priceGrosze) : null,
          grosze: price.price,
          seatsLeft: t.seatLimit ? Math.max(0, t.seatLimit - sold(scope, t.id)) : null,
        };
      }),
      comparison: tierComparison(tiers),
      passProducts,
      paymentMethods: PAYMENT_METHODS,
    };
  });

  // Zakup pakietu na www. Kolejność: wycena (kod) → płatność w bramce studia → w jednej transakcji konto,
  // członkostwo, płatność i dostęp. Konto bez sesji: wejście do /app kodem SMS na podany numer.
  app.post<{
    Params: { slug: string; id: string };
    Body: { tierId: string; name: string; phone: string; email?: string; couponCode?: string; method: PaymentMethod; acceptTerms: boolean; waiveWithdrawal: boolean };
  }>('/api/public/studios/:slug/courses/:id/purchase', async (req) => {
    const { studio, scope, course, edition, tiers } = load(db, req.params.slug, req.params.id);
    const b = req.body ?? ({} as typeof req.body);
    const now = new Date();
    const state = editionState(edition, now);
    if (state === 'upcoming') throw conflict('not_yet', 'Sprzedaż tej edycji jeszcze się nie zaczęła.');
    if (state === 'closed') throw conflict('closed', 'Sprzedaż tej edycji jest zakończona.');
    const tier = tiers.find((t) => t.id === b.tierId);
    if (!tier) throw badRequest('Wybierz pakiet.');
    if (tier.seatLimit && sold(scope, tier.id) >= tier.seatLimit) throw conflict('full', 'Ten pakiet jest już wyprzedany.');

    const name = String(b.name ?? '').trim().slice(0, 80);
    if (name.length < 2) throw badRequest('Podaj imię i nazwisko.');
    const phone = normalizePhone(b.phone);
    const email = String(b.email ?? '').trim().slice(0, 120) || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Sprawdź adres e-mail.');
    if (!PAYMENT_METHODS.includes(b.method as (typeof PAYMENT_METHODS)[number])) throw badRequest('Wybierz metodę płatności.');
    if (!b.acceptTerms) throw badRequest('Zaakceptuj regulamin sprzedaży.');
    // 5.6: treść cyfrowa od razu = utrata prawa odstąpienia – świadoma zgoda, jak przy zakupie w aplikacji.
    if (!b.waiveWithdrawal) throw badRequest('Potwierdź, że chcesz dostęp od razu i wiesz, że tracisz wtedy prawo odstąpienia od umowy.');

    const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
    const userId = existing?.id ?? id();
    if (existing && scope.get('SELECT 1 FROM course_enrollments WHERE studio_id = $studio AND course_id = $c AND user_id = $u', { c: course.id, u: userId }))
      throw conflict('enrolled', 'Ten numer ma już dostęp do kursu. Zaloguj się w aplikacji kodem SMS.');

    const base = coursePrice(tier.priceGrosze, { promoPct: course.promo_pct, passDiscountPct: 0, hasActivePass: false }).price;
    const priced = priceWithCoupon(scope, studio, { code: b.couponCode, userId, kind: 'course', amountGrosze: base });
    const description = `Kurs: ${course.title} – ${tier.name}`;
    const charge = priced.final > 0 ? await deps.payments.charge({ amountGrosze: priced.final, method: b.method, description, studioId: studio.id }) : { status: 'paid' as const, ref: 'free' };
    if (charge.status !== 'paid') throw new HttpError(402, 'payment_failed', 'Płatność się nie powiodła. Spróbuj ponownie.');

    scope.tx(() => {
      if (!existing) db.prepare('INSERT INTO users (id, phone, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, phone, name, email, nowIso());
      // Istniejące konto: nie nadpisujemy imienia ani e-maila danymi z formularza (mógł je wpisać ktoś inny).
      else db.prepare('UPDATE users SET name = COALESCE(name, ?), email = COALESCE(email, ?) WHERE id = ?').run(name, email, userId);
      scope.run("INSERT OR IGNORE INTO memberships (studio_id, user_id, role, joined_at) VALUES ($studio, $u, 'client', $now)", { u: userId, now: nowIso() });
      scope.run("INSERT OR REPLACE INTO consents (user_id, studio_id, kind, granted, updated_at) VALUES ($u, $studio, 'course_terms', 1, $now)", { u: userId, now: nowIso() });
      recordPayment(scope, { userId, kind: 'course', ref: course.id, amount: priced.final, discount: priced.discount, method: b.method, providerRef: charge.ref, description, couponId: priced.coupon?.id });
      scope.run(
        `INSERT INTO course_enrollments (studio_id, course_id, user_id, source, price_paid_grosze, withdrawal_waived_at, started_at, expires_at, tier_id, edition_id)
         VALUES ($studio, $c, $u, 'purchase', $p, $now, $start, $exp, $t, $e)`,
        {
          c: course.id,
          u: userId,
          p: priced.final,
          now: now.toISOString(),
          // Edycja z datą startu: kalendarz (drip) liczy się od startu edycji, nie od dnia zakupu.
          start: edition?.startsAt && Date.parse(edition.startsAt) > now.getTime() ? edition.startsAt : now.toISOString(),
          exp: purchaseAccessUntil(edition, course.access_days, now),
          t: tier.id,
          e: edition?.id ?? null,
        },
      );
      audit(scope, { actorId: userId, action: 'course.purchased_web', entity: 'course', entityId: course.id, subjectUserId: userId, details: { tier: tier.name } });
    });
    notify(scope, { userId: course.author_id, category: 'courses', tz: studio.timezone, body: `Nowa uczestniczka kursu „${course.title}” (${tier.name}).`, action: 'staff/courses' });
    return {
      message: `Gotowe. „${course.title}” (${tier.name}) czeka w aplikacji.`,
      next: `Zaloguj się w aplikacji numerem ${phone.replace(/^(\+\d{2})(\d{3})(\d{3})(\d+)$/, '$1 $2 $3 $4')} – wyślemy kod SMS.`,
      appUrl: '/app',
      paid: formatPLN(priced.final),
    };
  });
}

