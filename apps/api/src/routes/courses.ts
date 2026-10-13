// Kursy od instruktorek (5, K1–K16). Decyzja B: na start kursy są w karnecie (klocek „dostęp do kursów”)
// albo częścią kursu stacjonarnego; płatna sprzedaż cyfrowa za flagą „courses_paid” (po weryfikacji zasad sklepów).
import type { FastifyInstance } from 'fastify';
import {
  accessUntil,
  canReview,
  canTransition,
  certificateNo,
  certificateReady,
  COURSE_KIND_LABEL,
  courseAccess,
  coursePrice,
  courseProgress,
  formatPLN,
  lessonUnlocked,
  localParts,
  medicalClaims,
  moderate,
  MODERATION_COPY,
  MILESTONES,
  revenueSplit,
  unlockDate,
  type CourseStatus,
} from '@glam/core';
import { assertFeature, ctx, isStaff, requirePerm, requireStudio, type Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { PAYMENT_METHODS, type PaymentMethod } from '../sms.ts';
import { audit } from '../services/audit.ts';
import { storeMedia } from '../services/media.ts';
import { awardPoints, grantBadge } from '../services/motivation.ts';
import { notify } from '../services/notify.ts';
import { loadPasses } from '../services/passes.ts';
import { priceWithCoupon, recordPayment } from '../services/payments.ts';
import { segmentsForUser } from '../services/segments.ts';
import type { Studio } from '../services/studio.ts';

type CourseRow = {
  id: string;
  author_id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  kind: string;
  level: string;
  goal: string | null;
  day_part: string | null;
  contraindications: string | null;
  price_grosze: number | null;
  access_days: number | null;
  seller: string;
  trainer_share: number;
  pass_discount: number;
  included_product_ids_json: string;
  bundle_ids_json: string;
  drip_days: number;
  seat_limit: number | null;
  segment: string | null;
  promo_pct: number;
  status: CourseStatus;
  review_note: string | null;
  cover_media_id: string | null;
  created_at: string;
};

type LessonRow = { id: string; course_id: string; module: string; title: string; kind: string; body: string | null; media_id: string | null; video_url: string | null; captions: string | null; attachment_id: string | null; duration_sec: number; unlock_day: number; free_preview: number; live_at: string | null; sort: number };

const lessonOf = (l: LessonRow) => ({ id: l.id, unlockDay: l.unlock_day, freePreview: !!l.free_preview, durationSec: l.duration_sec, sort: l.sort });

/** Czy aktywny karnet klientki daje dostęp do kursu (klocek „courseIds” albo produkt wskazany w kursie). */
export function passCoversCourse(scope: StudioScope, userId: string, course: Pick<CourseRow, 'id' | 'included_product_ids_json'>): boolean {
  const included = JSON.parse(course.included_product_ids_json) as string[];
  const passes = loadPasses(scope, userId).filter((p) => p.status === 'active' || p.status === 'used');
  if (passes.some((p) => p.rules.courseIds === 'all' || (Array.isArray(p.rules.courseIds) && p.rules.courseIds.includes(course.id)))) return true;
  if (!included.length) return false;
  return !!scope.get(
    `SELECT 1 FROM passes ps JOIN product_versions pv ON pv.id = ps.product_version_id WHERE ps.studio_id = $studio AND ps.user_id = $u AND ps.status IN ('active', 'used') AND ps.valid_until > $now AND pv.product_id IN (${included.map((_, i) => `$p${i}`).join(',')})`,
    { u: userId, now: nowIso(), ...Object.fromEntries(included.map((p, i) => [`p${i}`, p])) },
  );
}

function access(scope: StudioScope, userId: string, course: CourseRow, staff: boolean) {
  const enrollment = scope.get<{ source: 'pass' | 'purchase' | 'free' | 'beta' | 'bundle'; expires_at: string | null; started_at: string; completed_at: string | null }>(
    'SELECT source, expires_at, started_at, completed_at FROM course_enrollments WHERE studio_id = $studio AND course_id = $c AND user_id = $u',
    { c: course.id, u: userId },
  );
  const res = courseAccess({ status: course.status, enrollment: enrollment ?? null, coveredByPass: passCoversCourse(scope, userId, course), isAuthorOrStaff: staff || course.author_id === userId, now: new Date() });
  return { res, enrollment };
}

/** Plik lekcji (wideo, PDF) – tylko z dostępem do kursu albo w darmowym podglądzie. */
export function lessonAccess(scope: StudioScope, userId: string, mediaId: string): boolean {
  const l = scope.get<LessonRow>('SELECT * FROM course_lessons WHERE studio_id = $studio AND (media_id = $m OR attachment_id = $m)', { m: mediaId });
  if (!l) return false;
  if (l.free_preview) return true;
  const c = scope.get<CourseRow>('SELECT * FROM courses WHERE studio_id = $studio AND id = $id', { id: l.course_id });
  return !!c && access(scope, userId, c, false).res.ok;
}

function stats(scope: StudioScope, courseId: string) {
  const s = scope.get<{ buyers: number; completed: number; rating: number | null; reviews: number; revenue: number }>(
    `SELECT (SELECT COUNT(*) FROM course_enrollments WHERE studio_id = $studio AND course_id = $c) AS buyers,
            (SELECT COUNT(*) FROM course_enrollments WHERE studio_id = $studio AND course_id = $c AND completed_at IS NOT NULL) AS completed,
            (SELECT ROUND(AVG(rating), 1) FROM course_reviews WHERE studio_id = $studio AND course_id = $c AND hidden = 0) AS rating,
            (SELECT COUNT(*) FROM course_reviews WHERE studio_id = $studio AND course_id = $c AND hidden = 0) AS reviews,
            (SELECT COALESCE(SUM(price_paid_grosze), 0) FROM course_enrollments WHERE studio_id = $studio AND course_id = $c) AS revenue`,
    { c: courseId },
  )!;
  const topModule = scope.get<{ module: string; views: number }>(
    'SELECT l.module, COUNT(p.user_id) AS views FROM course_lessons l LEFT JOIN lesson_progress p ON p.lesson_id = l.id WHERE l.studio_id = $studio AND l.course_id = $c GROUP BY l.module ORDER BY views DESC LIMIT 1',
    { c: courseId },
  );
  return { ...s, topModule: topModule?.module ?? null };
}

function cardView(scope: StudioScope, studio: Studio, userId: string, c: CourseRow, staff: boolean, segments: string[]) {
  const a = access(scope, userId, c, staff);
  const lessons = scope.all<LessonRow>('SELECT * FROM course_lessons WHERE studio_id = $studio AND course_id = $c ORDER BY sort', { c: c.id });
  const done = new Set(scope.all<{ lesson_id: string }>('SELECT lesson_id FROM lesson_progress WHERE studio_id = $studio AND user_id = $u AND completed_at IS NOT NULL', { u: userId }).map((r) => r.lesson_id));
  const hasPass = loadPasses(scope, userId).some((p) => p.status === 'active');
  const price = c.price_grosze ? coursePrice(c.price_grosze, { promoPct: c.promo_pct, passDiscountPct: c.pass_discount, hasActivePass: hasPass }) : null;
  const author = scope.get<{ name: string }>('SELECT name FROM users WHERE id = $id AND $studio = $studio', { id: c.author_id });
  const s = stats(scope, c.id);
  return {
    id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    kind: c.kind,
    kindLabel: COURSE_KIND_LABEL[c.kind as keyof typeof COURSE_KIND_LABEL],
    level: c.level,
    goal: c.goal,
    dayPart: c.day_part,
    contraindications: c.contraindications,
    author: author?.name ?? '',
    authorId: c.author_id,
    minutes: Math.round(lessons.reduce((acc, l) => acc + l.duration_sec, 0) / 60),
    lessons: lessons.length,
    modules: [...new Set(lessons.map((l) => l.module))],
    coverUrl: c.cover_media_id ? `/api/public-media/${c.cover_media_id}` : null,
    status: c.status,
    access: a.res.ok ? a.res.via : null,
    accessReason: a.res.ok ? null : a.res.reason,
    enrolled: !!a.enrollment,
    expiresAt: a.enrollment?.expires_at ?? null,
    progress: courseProgress(lessons.map(lessonOf), done),
    price: price ? { full: formatPLN(c.price_grosze!), final: formatPLN(price.price), discountPct: price.discountPct, grosze: price.price } : null,
    accessDays: c.access_days,
    paidSales: studio.has('courses_paid'),
    rating: s.rating,
    reviews: s.reviews,
    recommended: !!c.segment && segments.includes(c.segment),
    seatsLeft: c.seat_limit ? Math.max(0, c.seat_limit - s.buyers) : null,
  };
}

export function courseRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const member = { preHandler: requireStudio(db) };
  const creator = requirePerm(db, 'courses.create', 'courses.approve');
  const approve = requirePerm(db, 'courses.approve');

  const loadCourse = (scope: StudioScope, courseId: string) => {
    const c = scope.get<CourseRow>('SELECT * FROM courses WHERE studio_id = $studio AND id = $id', { id: courseId });
    if (!c) throw notFound('Nie znaleziono kursu.');
    return c;
  };

  // ——— Katalog (K1) z filtrami: poziom, czas, trenerka, cel, pora dnia ———

  app.get('/api/courses', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    assertFeature(studio, 'courses');
    const segments = segmentsForUser(scope, user.id);
    const rows = scope.all<CourseRow>(
      `SELECT c.* FROM courses c WHERE c.studio_id = $studio AND (c.status = 'published'
         OR (c.status = 'beta' AND EXISTS (SELECT 1 FROM course_enrollments e WHERE e.course_id = c.id AND e.user_id = $u AND e.source = 'beta')))
       ORDER BY c.created_at DESC`,
      { u: user.id },
    );
    return rows.map((c) => cardView(scope, studio, user.id, c, isStaff(roles), segments));
  });

  app.get('/api/my/courses', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    if (!studio.has('courses')) return [];
    const rows = scope.all<CourseRow>('SELECT c.* FROM courses c JOIN course_enrollments e ON e.course_id = c.id WHERE c.studio_id = $studio AND e.user_id = $u ORDER BY e.started_at DESC', { u: user.id });
    return rows.map((c) => cardView(scope, studio, user.id, c, isStaff(roles), []));
  });

  app.get<{ Params: { id: string } }>('/api/courses/:id', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    assertFeature(studio, 'courses');
    const c = loadCourse(scope, req.params.id);
    const staff = isStaff(roles);
    if (c.status !== 'published' && c.status !== 'beta' && !staff && c.author_id !== user.id) throw notFound();
    const a = access(scope, user.id, c, staff);
    const lessons = scope.all<LessonRow>('SELECT * FROM course_lessons WHERE studio_id = $studio AND course_id = $c ORDER BY sort', { c: c.id });
    const progress = new Map(scope.all<{ lesson_id: string; position_sec: number; completed_at: string | null }>('SELECT lesson_id, position_sec, completed_at FROM lesson_progress WHERE studio_id = $studio AND user_id = $u', { u: user.id }).map((p) => [p.lesson_id, p]));
    const started = a.enrollment?.started_at ?? (a.res.ok && a.res.via === 'pass' ? c.created_at : null);
    const now = new Date();
    const done = new Set([...progress.values()].filter((p) => p.completed_at).map((p) => p.lesson_id));
    const pct = courseProgress(lessons.map(lessonOf), done);
    return {
      ...cardView(scope, studio, user.id, c, staff, segmentsForUser(scope, user.id)),
      description: c.description,
      dripDays: c.drip_days,
      lessonsList: lessons.map((l, i) => {
        const open = (a.res.ok && (staff || c.author_id === user.id || lessonUnlocked(lessonOf(l), started, now, c.drip_days, i))) || !!l.free_preview;
        const p = progress.get(l.id);
        return {
          id: l.id,
          module: l.module,
          title: l.title,
          kind: l.kind,
          durationSec: l.duration_sec,
          freePreview: !!l.free_preview,
          liveAt: l.live_at,
          unlocked: open,
          unlocksAt: !open && started ? unlockDate(lessonOf(l), started, c.drip_days, i) : null,
          body: open ? l.body : null,
          videoUrl: open ? (l.media_id ? `/api/media/${l.media_id}` : l.video_url) : null,
          captions: open ? l.captions : null,
          attachmentUrl: open && l.attachment_id ? `/api/media/${l.attachment_id}` : null,
          position: p?.position_sec ?? 0,
          completed: !!p?.completed_at,
          questions: open
            ? scope.all<{ user_id: string }>(
                'SELECT q.id, q.body, q.answer, q.created_at, q.user_id, u.name, a.name AS answered_by_name FROM course_questions q JOIN users u ON u.id = q.user_id LEFT JOIN users a ON a.id = q.answered_by WHERE q.studio_id = $studio AND q.lesson_id = $l AND (q.hidden = 0 OR $staff = 1) ORDER BY q.created_at',
                { l: l.id, staff: Number(staff) },
              ).map((q) => ({ ...q, mine: q.user_id === user.id }))
            : [],
        };
      }),
      reviewsList: scope.all('SELECT r.rating, r.body, r.created_at, u.name FROM course_reviews r JOIN users u ON u.id = r.user_id WHERE r.studio_id = $studio AND r.course_id = $c AND r.hidden = 0 ORDER BY r.created_at DESC LIMIT 20', { c: c.id }),
      myReview: scope.get('SELECT rating, body FROM course_reviews WHERE studio_id = $studio AND course_id = $c AND user_id = $u', { c: c.id, u: user.id }) ?? null,
      canReview: canReview(pct) && a.res.ok,
      certificate: certificateReady(pct) && a.res.ok ? { no: certificateNo(c.id, user.id), url: `/api/courses/${c.id}/certificate` } : null,
      bundle: c.kind === 'bundle' ? scope.all('SELECT id, title FROM courses WHERE studio_id = $studio AND id IN (SELECT value FROM json_each($ids))', { ids: c.bundle_ids_json }) : [],
    };
  });

  // K2: dołączenie – przez karnet, za darmo albo zakup (z akceptacją utraty prawa odstąpienia – 5.6).
  app.post<{ Params: { id: string }; Body: { method?: PaymentMethod; couponCode?: string; waiveWithdrawal?: boolean } }>('/api/courses/:id/enroll', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    assertFeature(studio, 'courses');
    const c = loadCourse(scope, req.params.id);
    if (c.status !== 'published') throw conflict('not_published', 'Ten kurs nie jest teraz dostępny.');
    if (scope.get('SELECT 1 FROM course_enrollments WHERE studio_id = $studio AND course_id = $c AND user_id = $u', { c: c.id, u: user.id })) return { message: 'Masz już ten kurs.' };
    const s = stats(scope, c.id);
    if (c.seat_limit && s.buyers >= c.seat_limit) throw conflict('full', 'Brak wolnych miejsc w tym kursie.');
    let source: 'pass' | 'free' | 'purchase' = 'free';
    let paid = 0;
    if (passCoversCourse(scope, user.id, c) || isStaff(roles)) source = 'pass';
    else if (c.price_grosze && c.price_grosze > 0) {
      if (!studio.has('courses_paid')) throw new HttpError(402, 'course_in_pass', 'Ten kurs jest dostępny w ramach karnetu studia.', { suggestions: true });
      if (!PAYMENT_METHODS.includes(req.body?.method as (typeof PAYMENT_METHODS)[number])) throw badRequest('Wybierz metodę płatności.');
      if (!req.body.waiveWithdrawal) throw badRequest('Potwierdź, że chcesz dostęp od razu i wiesz, że tracisz wtedy prawo odstąpienia od umowy.');
      const hasPass = loadPasses(scope, user.id).some((p) => p.status === 'active');
      const base = coursePrice(c.price_grosze, { promoPct: c.promo_pct, passDiscountPct: c.pass_discount, hasActivePass: hasPass }).price;
      const priced = priceWithCoupon(scope, studio, { code: req.body.couponCode, userId: user.id, kind: 'course', amountGrosze: base });
      const charge = await deps.payments.charge({ amountGrosze: priced.final, method: req.body.method!, description: `Kurs: ${c.title}`, studioId: studio.id });
      if (charge.status !== 'paid') throw new HttpError(402, 'payment_failed', 'Płatność się nie powiodła.');
      recordPayment(scope, { userId: user.id, kind: 'course', ref: c.id, amount: priced.final, discount: priced.discount, method: req.body.method!, providerRef: charge.ref, description: `Kurs: ${c.title}`, couponId: priced.coupon?.id });
      source = 'purchase';
      paid = priced.final;
    }
    const now = new Date();
    const ids = c.kind === 'bundle' ? (JSON.parse(c.bundle_ids_json) as string[]) : [];
    scope.tx(() => {
      const enroll = (courseId: string, src: string, price: number) =>
        scope.run(
          'INSERT OR IGNORE INTO course_enrollments (studio_id, course_id, user_id, source, price_paid_grosze, withdrawal_waived_at, started_at, expires_at) VALUES ($studio, $c, $u, $s, $p, $w, $now, $exp)',
          { c: courseId, u: user.id, s: src, p: price, w: source === 'purchase' ? now.toISOString() : null, now: now.toISOString(), exp: source === 'pass' ? null : accessUntil(c.access_days, now) },
        );
      enroll(c.id, source, paid);
      for (const b of ids) enroll(b, 'bundle', 0);
    });
    return { message: source === 'purchase' ? `Kurs „${c.title}” jest Twój. Miłej nauki!` : `Dołączyłaś do kursu „${c.title}”.` };
  });

  // K3: zapis postępu i wznowienie od miejsca przerwy.
  app.post<{ Params: { id: string }; Body: { position: number; completed?: boolean } }>('/api/lessons/:id/progress', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const l = scope.get<LessonRow>('SELECT * FROM course_lessons WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!l) throw notFound();
    const c = loadCourse(scope, l.course_id);
    if (!access(scope, user.id, c, isStaff(roles)).res.ok && !l.free_preview) throw forbidden();
    const pos = Math.max(0, Number(req.body?.position) || 0);
    scope.run(
      `INSERT INTO lesson_progress (studio_id, user_id, lesson_id, position_sec, completed_at, updated_at) VALUES ($studio, $u, $l, $p, $done, $now)
       ON CONFLICT (user_id, lesson_id) DO UPDATE SET position_sec = $p, completed_at = COALESCE(completed_at, $done), updated_at = $now`,
      { u: user.id, l: l.id, p: pos, done: req.body?.completed ? nowIso() : null, now: nowIso() },
    );
    // Kurs pod pas: gratulacje, odznaka, punkty, certyfikat (8.1.3, K10).
    const lessons = scope.all<LessonRow>('SELECT * FROM course_lessons WHERE studio_id = $studio AND course_id = $c', { c: c.id });
    const done = new Set(scope.all<{ lesson_id: string }>('SELECT lesson_id FROM lesson_progress WHERE studio_id = $studio AND user_id = $u AND completed_at IS NOT NULL', { u: user.id }).map((r) => r.lesson_id));
    const pct = courseProgress(lessons.map(lessonOf), done);
    if (pct >= 100) {
      const r = scope.run('UPDATE course_enrollments SET completed_at = $now WHERE studio_id = $studio AND course_id = $c AND user_id = $u AND completed_at IS NULL', { c: c.id, u: user.id, now: nowIso() });
      if (r.changes) {
        grantBadge(scope, user.id, 'course');
        awardPoints(scope, studio, user.id, 'challenge', `course:${c.id}`, studio.settings.loyalty.points.challenge);
        notify(scope, { userId: user.id, category: 'occasional', occasion: 'milestone', tz: studio.timezone, body: MILESTONES.course(`„${c.title}”`), action: `course/${c.id}` });
      }
    }
    return { progress: pct };
  });

  // K8: pytania pod lekcją (moderacja: autorka kursu i właścicielka – decyzja 5).
  app.post<{ Params: { id: string }; Body: { body: string } }>('/api/lessons/:id/questions', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const l = scope.get<LessonRow>('SELECT * FROM course_lessons WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!l) throw notFound();
    const c = loadCourse(scope, l.course_id);
    if (!access(scope, user.id, c, isStaff(roles)).res.ok) throw forbidden();
    const m = moderate(req.body?.body, { maxLength: 800 });
    if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
    scope.run('INSERT INTO course_questions (id, studio_id, lesson_id, user_id, body, created_at) VALUES ($id, $studio, $l, $u, $b, $now)', { id: id(), l: l.id, u: user.id, b: req.body.body.trim(), now: nowIso() });
    notify(scope, { userId: c.author_id, category: 'courses', tz: studio.timezone, body: `Nowe pytanie pod lekcją „${l.title}”.`, action: 'staff/courses' });
    return { ok: true };
  });

  // K9: opinie i oceny – po 30% kursu.
  app.put<{ Params: { id: string }; Body: { rating: number; body?: string } }>('/api/courses/:id/review', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const c = loadCourse(scope, req.params.id);
    if (!access(scope, user.id, c, isStaff(roles)).res.ok) throw forbidden();
    const lessons = scope.all<LessonRow>('SELECT * FROM course_lessons WHERE studio_id = $studio AND course_id = $c', { c: c.id });
    const done = new Set(scope.all<{ lesson_id: string }>('SELECT lesson_id FROM lesson_progress WHERE studio_id = $studio AND user_id = $u AND completed_at IS NOT NULL', { u: user.id }).map((r) => r.lesson_id));
    if (!canReview(courseProgress(lessons.map(lessonOf), done))) throw conflict('too_early', 'Opinię możesz wystawić po 30% kursu.');
    const r = req.body?.rating;
    if (!Number.isInteger(r) || r < 1 || r > 5) throw badRequest('Ocena od 1 do 5.');
    if (req.body.body) {
      const m = moderate(req.body.body, { maxLength: 800 });
      if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
    }
    scope.run('INSERT OR REPLACE INTO course_reviews (studio_id, course_id, user_id, rating, body, hidden, created_at) VALUES ($studio, $c, $u, $r, $b, 0, $now)', { c: c.id, u: user.id, r, b: req.body.body?.trim() || null, now: nowIso() });
    awardPoints(scope, studio, user.id, 'review', `course:${c.id}`, studio.settings.loyalty.points.review);
    return { ok: true };
  });

  // K10: certyfikat ukończenia (PDF przez druk) + odznaka.
  app.get<{ Params: { id: string } }>('/api/courses/:id/certificate', member, async (req, reply) => {
    const { scope, studio, user } = ctx(req);
    const c = loadCourse(scope, req.params.id);
    const e = scope.get<{ completed_at: string | null }>('SELECT completed_at FROM course_enrollments WHERE studio_id = $studio AND course_id = $c AND user_id = $u', { c: c.id, u: user.id });
    if (!e?.completed_at) throw notFound('Certyfikat pojawi się po ukończeniu kursu.');
    const author = (db.prepare('SELECT name FROM users WHERE id = ?').get(c.author_id) as { name: string }).name;
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
    const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Certyfikat – ${esc(c.title)}</title>
<style>@page{size:A4 landscape;margin:0}body{margin:0;font-family:Georgia,serif;background:#f3f0ea;color:#1b1715}.c{margin:40px auto;max-width:900px;aspect-ratio:1.414;border:1px solid #c9bfb1;border-radius:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;background:#fbfaf7}h1{font-style:italic;font-weight:400;font-size:56px;margin:0}p{font-family:system-ui,sans-serif;letter-spacing:.04em}.n{font-size:13px;color:#5e554c;text-transform:uppercase;letter-spacing:.2em}@media print{button{display:none}.c{margin:0;border:0;border-radius:0;height:100vh;max-width:none}}</style></head>
<body><button onclick="print()" style="margin:16px">Drukuj / zapisz PDF</button><div class="c"><p class="n">Certyfikat ukończenia</p><h1>${esc(user.name ?? '')}</h1>
<p>ukończyła kurs</p><h2 style="font-weight:400">${esc(c.title)}</h2><p>prowadzi ${esc(author)} · ${esc(studio.name)}</p><p class="n">${esc(e.completed_at.slice(0, 10))} · nr ${certificateNo(c.id, user.id)}</p></div></body></html>`;
    return reply.header('content-type', 'text/html; charset=utf-8').send(html);
  });

  // ——— Creator Studio (5.4, K4) ———

  app.get('/api/creator/courses', creator, async (req) => {
    const { scope, user, roles } = ctx(req);
    const all = roles.includes('owner');
    return scope
      .all<CourseRow>(`SELECT * FROM courses WHERE studio_id = $studio ${all ? '' : 'AND author_id = $me'} ORDER BY updated_at DESC`, all ? {} : { me: user.id })
      .map((c) => ({ ...c, stats: stats(scope, c.id), lessons: scope.all('SELECT id, module, title, kind, duration_sec, unlock_day, free_preview, live_at, sort, media_id, video_url, attachment_id FROM course_lessons WHERE studio_id = $studio AND course_id = $c ORDER BY sort', { c: c.id }) }));
  });

  const validateCourse = (b: any) => {
    if (!b.title?.trim()) throw badRequest('Podaj tytuł kursu.');
    if (!['video', 'program', 'mindbody', 'live', 'hybrid', 'bundle'].includes(b.kind)) throw badRequest('Wybierz typ kursu.');
    if (!b.level?.trim()) throw badRequest('Oznacz poziom kursu (5.6).');
    const claims = medicalClaims(`${b.title} ${b.subtitle ?? ''} ${b.description ?? ''}`);
    if (claims.length) throw badRequest(`Bez obietnic medycznych (5.6): usuń „${claims[0]}”.`);
    if (b.price !== undefined && b.price !== null && !(b.price >= 0)) throw badRequest('Nieprawidłowa cena.');
  };

  app.post<{ Body: any }>('/api/creator/courses', creator, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'courses');
    const b: any = req.body ?? {};
    validateCourse(b);
    const cid = id();
    scope.run(
      `INSERT INTO courses (id, studio_id, author_id, title, subtitle, description, kind, level, goal, day_part, contraindications, price_grosze, access_days, seller, trainer_share, pass_discount,
         included_product_ids_json, bundle_ids_json, drip_days, seat_limit, segment, status, created_at, updated_at)
       VALUES ($id, $studio, $a, $t, $st, $d, $k, $l, $g, $dp, $ci, $p, $ad, $seller, $share, $pd, $inc, $bundle, $drip, $seats, $seg, 'draft', $now, $now)`,
      {
        id: cid,
        a: user.id,
        t: b.title.trim().slice(0, 80),
        st: b.subtitle?.slice(0, 120) ?? null,
        d: b.description?.slice(0, 4000) ?? null,
        k: b.kind,
        l: b.level.trim(),
        g: b.goal ?? null,
        dp: b.dayPart ?? null,
        ci: b.contraindications?.slice(0, 500) ?? null,
        p: b.price ?? null,
        ad: b.accessDays ?? null,
        seller: b.seller === 'trainer' ? 'trainer' : 'studio',
        // Decyzja B2: domyślnie 70% dla trenerki; studio zmienia per kurs.
        share: 70,
        pd: Math.min(90, Math.max(0, b.passDiscount ?? 0)),
        inc: JSON.stringify(b.includedProductIds ?? []),
        bundle: JSON.stringify(b.bundleIds ?? []),
        drip: Math.max(0, b.dripDays ?? 0),
        seats: b.seatLimit ?? null,
        seg: b.segment ?? null,
        now: nowIso(),
      },
    );
    return { id: cid };
  });

  const ownCourse = (scope: StudioScope, courseId: string, userId: string, roles: string[]) => {
    const c = loadCourse(scope, courseId);
    if (c.author_id !== userId && !roles.includes('owner')) throw forbidden();
    return c;
  };

  app.put<{ Params: { id: string }; Body: any }>('/api/creator/courses/:id', creator, async (req) => {
    const { scope, user, roles } = ctx(req);
    const c = ownCourse(scope, req.params.id, user.id, roles);
    const b: any = { ...c, ...(req.body as object), title: (req.body as any)?.title ?? c.title, kind: (req.body as any)?.kind ?? c.kind, level: (req.body as any)?.level ?? c.level };
    validateCourse(b);
    scope.run(
      `UPDATE courses SET title = $t, subtitle = $st, description = $d, kind = $k, level = $l, goal = $g, day_part = $dp, contraindications = $ci, price_grosze = $p, access_days = $ad,
         pass_discount = $pd, included_product_ids_json = $inc, bundle_ids_json = $bundle, drip_days = $drip, seat_limit = $seats, segment = $seg, updated_at = $now WHERE studio_id = $studio AND id = $id`,
      {
        id: c.id,
        t: b.title.trim().slice(0, 80),
        st: b.subtitle ?? null,
        d: b.description ?? null,
        k: b.kind,
        l: b.level,
        g: b.goal ?? null,
        dp: b.dayPart ?? b.day_part ?? null,
        ci: b.contraindications ?? null,
        p: b.price !== undefined ? b.price : c.price_grosze,
        ad: b.accessDays !== undefined ? b.accessDays : c.access_days,
        pd: b.passDiscount ?? c.pass_discount,
        inc: JSON.stringify(b.includedProductIds ?? JSON.parse(c.included_product_ids_json)),
        bundle: JSON.stringify(b.bundleIds ?? JSON.parse(c.bundle_ids_json)),
        drip: b.dripDays ?? c.drip_days,
        seats: b.seatLimit !== undefined ? b.seatLimit : c.seat_limit,
        seg: b.segment !== undefined ? b.segment : c.segment,
        now: nowIso(),
      },
    );
    return { ok: true };
  });

  app.put<{ Params: { id: string }; Body: { dataUrl: string } }>('/api/creator/courses/:id/cover', { ...creator, bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const c = ownCourse(scope, req.params.id, user.id, roles);
    const m = storeMedia(scope, studio, { dataUrl: req.body?.dataUrl, kind: 'cover', ownerId: user.id, allow: ['image'] });
    scope.run('UPDATE courses SET cover_media_id = $m WHERE studio_id = $studio AND id = $id', { m: m.id, id: c.id });
    return { url: `/api/public-media/${m.id}` };
  });

  // Lekcja: wideo (wgrane lub link – live / zewnętrzny odtwarzacz), tekst, zadanie domowe, spotkanie stacjonarne; materiały PDF.
  app.post<{ Params: { id: string }; Body: { module: string; title: string; kind: string; body?: string; video?: { dataUrl: string; durationSec: number } | null; videoUrl?: string; captions?: string; attachment?: string | null; durationSec?: number; unlockDay?: number; freePreview?: boolean; liveAt?: string | null } }>(
    '/api/creator/courses/:id/lessons',
    { ...creator, bodyLimit: 60 * 1024 * 1024 },
    async (req) => {
      const { scope, studio, user, roles } = ctx(req);
      const c = ownCourse(scope, req.params.id, user.id, roles);
      const b = req.body ?? ({} as typeof req.body);
      if (!b.title?.trim() || !b.module?.trim()) throw badRequest('Podaj moduł i tytuł lekcji.');
      if (!['video', 'text', 'live', 'homework', 'stationary'].includes(b.kind)) throw badRequest('Wybierz rodzaj lekcji.');
      if (b.videoUrl && !/^https:\/\//.test(b.videoUrl)) throw badRequest('Link do wideo musi zaczynać się od https://');
      if (b.captions && !/^WEBVTT/.test(b.captions.trim())) throw badRequest('Napisy w formacie WebVTT (zaczynają się od „WEBVTT”).');
      const media = b.video ? storeMedia(scope, studio, { dataUrl: b.video.dataUrl, kind: 'course', ownerId: user.id, durationSec: b.video.durationSec, allow: ['video'] }) : null;
      const attachment = b.attachment ? storeMedia(scope, studio, { dataUrl: b.attachment, kind: 'attachment', ownerId: user.id, allow: ['pdf', 'image'] }) : null;
      const lid = id();
      scope.run(
        `INSERT INTO course_lessons (id, studio_id, course_id, module, title, kind, body, media_id, video_url, captions, attachment_id, duration_sec, unlock_day, free_preview, live_at, sort)
         VALUES ($id, $studio, $c, $m, $t, $k, $b, $media, $url, $cap, $att, $dur, $unlock, $free, $live, (SELECT COALESCE(MAX(sort), 0) + 1 FROM course_lessons WHERE studio_id = $studio AND course_id = $c))`,
        {
          id: lid,
          c: c.id,
          m: b.module.trim().slice(0, 60),
          t: b.title.trim().slice(0, 80),
          k: b.kind,
          b: b.body?.slice(0, 8000) ?? null,
          media: media?.id ?? null,
          url: b.videoUrl ?? null,
          cap: b.captions ?? null,
          att: attachment?.id ?? null,
          dur: Math.round(b.video?.durationSec ?? b.durationSec ?? 0),
          unlock: Math.max(0, b.unlockDay ?? 0),
          free: Number(!!b.freePreview),
          live: b.liveAt ?? null,
        },
      );
      scope.run('UPDATE courses SET updated_at = $now WHERE studio_id = $studio AND id = $id', { id: c.id, now: nowIso() });
      return { id: lid };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/creator/lessons/:id', creator, async (req) => {
    const { scope, user, roles } = ctx(req);
    const l = scope.get<LessonRow>('SELECT * FROM course_lessons WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!l) throw notFound();
    ownCourse(scope, l.course_id, user.id, roles);
    scope.tx(() => {
      scope.run('DELETE FROM lesson_progress WHERE studio_id = $studio AND lesson_id = $id', { id: l.id });
      scope.run('DELETE FROM course_questions WHERE studio_id = $studio AND lesson_id = $id', { id: l.id });
      scope.run('DELETE FROM course_lessons WHERE studio_id = $studio AND id = $id', { id: l.id });
    });
    return { ok: true };
  });

  // Statusy: szkic → beta dla testerek → akceptacja właścicielki → publikacja (K5).
  app.post<{ Params: { id: string }; Body: { to: CourseStatus; note?: string; testerIds?: string[] } }>('/api/creator/courses/:id/status', creator, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const c = ownCourse(scope, req.params.id, user.id, roles);
    const to = req.body?.to;
    const by = roles.includes('owner') ? 'owner' : 'author';
    if (!canTransition(c.status, to, by)) throw conflict('transition', 'Tej zmiany statusu nie można teraz zrobić.');
    if (to === 'pending' && !scope.get('SELECT 1 FROM course_lessons WHERE studio_id = $studio AND course_id = $c', { c: c.id })) throw badRequest('Dodaj co najmniej jedną lekcję.');
    scope.run('UPDATE courses SET status = $s, review_note = $n, updated_at = $now WHERE studio_id = $studio AND id = $id', { s: to, n: req.body.note ?? null, id: c.id, now: nowIso() });
    if (to === 'beta') {
      for (const t of req.body.testerIds ?? []) {
        if (!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: t })) continue;
        scope.run("INSERT OR IGNORE INTO course_enrollments (studio_id, course_id, user_id, source, started_at) VALUES ($studio, $c, $u, 'beta', $now)", { c: c.id, u: t, now: nowIso() });
        notify(scope, { userId: t, category: 'courses', tz: studio.timezone, body: `Zostałaś testerką kursu „${c.title}” 🎬 Daj znać, jak Ci się podoba.`, action: `course/${c.id}` });
      }
    }
    if (to === 'pending') {
      for (const o of scope.all<{ user_id: string }>("SELECT user_id FROM memberships WHERE studio_id = $studio AND role = 'owner'")) notify(scope, { userId: o.user_id, category: 'courses', tz: studio.timezone, body: `Kurs „${c.title}” czeka na akceptację.`, action: 'staff/courses' });
    }
    if (to === 'published' || (to === 'draft' && c.status === 'pending')) {
      notify(scope, { userId: c.author_id, category: 'courses', tz: studio.timezone, body: to === 'published' ? `Kurs „${c.title}” jest opublikowany 🎉` : `Kurs „${c.title}” wrócił do poprawki${req.body.note ? `: ${req.body.note}` : '.'}`, action: 'staff/courses' });
    }
    // Usunięcie kursu przez studio: informacja dla uczestniczek, dostęp do materiałów zostaje (5.6).
    if (to === 'archived' || to === 'suspended') {
      for (const e of scope.all<{ user_id: string }>('SELECT user_id FROM course_enrollments WHERE studio_id = $studio AND course_id = $c', { c: c.id })) {
        notify(scope, { userId: e.user_id, category: 'courses', tz: studio.timezone, body: `Kurs „${c.title}” nie będzie już rozwijany. Twój dostęp do nagranych lekcji zostaje.`, action: `course/${c.id}` });
      }
    }
    audit(scope, { actorId: user.id, action: `course.${to}`, entity: 'course', entityId: c.id, details: { note: req.body.note } });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { answer: string } }>('/api/creator/questions/:id/answer', creator, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const q = scope.get<{ lesson_id: string; user_id: string }>('SELECT lesson_id, user_id FROM course_questions WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!q) throw notFound();
    const l = scope.get<{ course_id: string }>('SELECT course_id FROM course_lessons WHERE studio_id = $studio AND id = $id', { id: q.lesson_id })!;
    const c = ownCourse(scope, l.course_id, user.id, roles);
    const answer = String(req.body?.answer ?? '').trim();
    if (!answer) throw badRequest('Napisz odpowiedź.');
    scope.run('UPDATE course_questions SET answer = $a, answered_by = $me WHERE studio_id = $studio AND id = $id', { a: answer.slice(0, 2000), me: user.id, id: req.params.id });
    notify(scope, { userId: q.user_id, category: 'courses', tz: studio.timezone, body: `Odpowiedź na Twoje pytanie w kursie „${c.title}” 💬`, action: `course/${c.id}` });
    return { ok: true };
  });

  app.get('/api/creator/questions', creator, async (req) => {
    const { scope, user, roles } = ctx(req);
    const all = roles.includes('owner');
    return scope.all(
      `SELECT q.id, q.body, q.answer, q.hidden, q.created_at, u.name, l.title AS lesson, c.title AS course FROM course_questions q JOIN course_lessons l ON l.id = q.lesson_id JOIN courses c ON c.id = l.course_id JOIN users u ON u.id = q.user_id
       WHERE q.studio_id = $studio ${all ? '' : 'AND c.author_id = $me'} ORDER BY q.answer IS NOT NULL, q.created_at DESC LIMIT 100`,
      all ? {} : { me: user.id },
    );
  });

  // Raport przychodów i wypłat (5.4, K6): udział trenerki wg podziału studia (domyślnie 70/30).
  app.get<{ Querystring: { month?: string } }>('/api/creator/payouts', creator, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const month = req.query.month && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : localParts(new Date(), studio.timezone).date.slice(0, 7);
    const all = roles.includes('owner');
    const rows = scope.all<{ course_id: string; title: string; author_id: string; author: string; trainer_share: number; seller: string; sales: number; gross: number }>(
      `SELECT c.id AS course_id, c.title, c.author_id, u.name AS author, c.trainer_share, c.seller, COUNT(e.user_id) AS sales, COALESCE(SUM(e.price_paid_grosze), 0) AS gross
       FROM courses c JOIN users u ON u.id = c.author_id LEFT JOIN course_enrollments e ON e.course_id = c.id AND substr(e.started_at, 1, 7) = $m
       WHERE c.studio_id = $studio ${all ? '' : 'AND c.author_id = $me'} GROUP BY c.id`,
      { m: month, ...(all ? {} : { me: user.id }) },
    );
    return {
      month,
      rows: rows.map((r) => {
        const split = revenueSplit(r.gross, r.trainer_share);
        return { ...r, grossLabel: formatPLN(r.gross), trainer: formatPLN(split.trainer), studio: formatPLN(split.studio) };
      }),
      note: 'GLAM liczy raport – wypłaty realizuje studio (decyzja 23). Model rozliczeń do potwierdzenia z księgową (5.7).',
    };
  });

  // ——— Właścicielka (5.5): akceptacja, udział trenerki, promocje zbiorcze, moderacja opinii ———

  app.put<{ Params: { id: string }; Body: { trainerShare?: number; promoPct?: number; seller?: 'studio' | 'trainer' } }>('/api/owner/courses/:id', approve, async (req) => {
    const { scope, user } = ctx(req);
    const b: any = req.body ?? {};
    if (b.trainerShare !== undefined && !(b.trainerShare >= 0 && b.trainerShare <= 100)) throw badRequest('Udział trenerki 0–100%.');
    if (b.promoPct !== undefined && !(b.promoPct >= 0 && b.promoPct <= 90)) throw badRequest('Promocja 0–90%.');
    scope.run('UPDATE courses SET trainer_share = COALESCE($s, trainer_share), promo_pct = COALESCE($p, promo_pct), seller = COALESCE($seller, seller), updated_at = $now WHERE studio_id = $studio AND id = $id', {
      s: b.trainerShare ?? null,
      p: b.promoPct ?? null,
      seller: b.seller ?? null,
      id: req.params.id,
      now: nowIso(),
    });
    audit(scope, { actorId: user.id, action: 'course.terms', entity: 'course', entityId: req.params.id, details: b });
    return { ok: true };
  });

  // Promocja zbiorcza („Tydzień kursów -25%”).
  app.post<{ Body: { pct: number } }>('/api/owner/courses/promo', approve, async (req) => {
    const { scope, user } = ctx(req);
    const pct = Number(req.body?.pct);
    if (!(pct >= 0 && pct <= 90)) throw badRequest('Promocja 0–90%.');
    scope.run("UPDATE courses SET promo_pct = $p WHERE studio_id = $studio AND status = 'published'", { p: pct });
    audit(scope, { actorId: user.id, action: 'course.promo', entity: 'course', details: { pct } });
    return { message: pct ? `Wszystkie kursy –${pct}%.` : 'Promocja zakończona.' };
  });

}
