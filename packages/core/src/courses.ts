// Kursy od instruktorek (5): dostęp (karnet / zakup / podgląd), drip content, postęp, certyfikat,
// opinie po 30% kursu, podział przychodów (decyzja B2: domyślnie 70/30), cena z promocją i zniżką.

export type CourseKind = 'video' | 'program' | 'mindbody' | 'live' | 'hybrid' | 'bundle';
export const COURSE_KIND_LABEL: Record<CourseKind, string> = {
  video: 'Wideo on-demand',
  program: 'Program tematyczny',
  mindbody: 'Ciało i głowa',
  live: 'Live z Q&A',
  hybrid: 'Stacjonarny + online',
  bundle: 'Pakiet kursów',
};

export type CourseStatus = 'draft' | 'beta' | 'pending' | 'published' | 'suspended' | 'archived';
export const COURSE_STATUS_LABEL: Record<CourseStatus, string> = {
  draft: 'szkic',
  beta: 'beta dla testerek',
  pending: 'czeka na akceptację',
  published: 'opublikowany',
  suspended: 'zawieszony',
  archived: 'w archiwum',
};

/** Dozwolone przejścia statusu (kto: autorka / właścicielka). */
export const COURSE_TRANSITIONS: Record<CourseStatus, { to: CourseStatus; by: 'author' | 'owner' }[]> = {
  draft: [{ to: 'beta', by: 'author' }, { to: 'pending', by: 'author' }],
  beta: [{ to: 'pending', by: 'author' }, { to: 'draft', by: 'author' }],
  pending: [{ to: 'published', by: 'owner' }, { to: 'draft', by: 'owner' }],
  published: [{ to: 'suspended', by: 'owner' }, { to: 'archived', by: 'owner' }],
  suspended: [{ to: 'published', by: 'owner' }, { to: 'archived', by: 'owner' }],
  archived: [],
};

export function canTransition(from: CourseStatus, to: CourseStatus, by: 'author' | 'owner'): boolean {
  return COURSE_TRANSITIONS[from].some((t) => t.to === to && (t.by === by || by === 'owner'));
}

/** Brak obietnic medycznych (5.6): proste wykrywanie zwrotów typu „wyleczy”. */
export function medicalClaims(text: string): string[] {
  const t = text.toLowerCase();
  return ['wyleczy', 'leczy', 'gwarantuje', 'na pewno pomoże', 'zlikwiduje ból', 'schudniesz', 'spalisz'].filter((w) => t.includes(w));
}

export type Lesson = { id: string; unlockDay: number; freePreview: boolean; durationSec: number; sort: number };

/** Drip content (K7): lekcja odblokowuje się w dniu `unlockDay` od rozpoczęcia (lub co tydzień przy dripDays). */
export function lessonUnlocked(lesson: Lesson, startedAt: string | null, now: Date, dripDays: number, index: number): boolean {
  if (lesson.freePreview) return true;
  if (!startedAt) return false;
  const day = lesson.unlockDay || (dripDays > 0 ? index * dripDays : 0);
  return (now.getTime() - Date.parse(startedAt)) / 86_400_000 >= day;
}

export function unlockDate(lesson: Lesson, startedAt: string, dripDays: number, index: number): string {
  const day = lesson.unlockDay || (dripDays > 0 ? index * dripDays : 0);
  return new Date(Date.parse(startedAt) + day * 86_400_000).toISOString();
}

export function courseProgress(lessons: Lesson[], completed: Set<string>): number {
  if (!lessons.length) return 0;
  return Math.round((lessons.filter((l) => completed.has(l.id)).length / lessons.length) * 100);
}

/** Opinię można wystawić po 30% kursu (5.4). */
export const canReview = (progressPct: number) => progressPct >= 30;
export const certificateReady = (progressPct: number) => progressPct >= 100;

/** Odtwarzacz: dozwolone tempa (5.3). */
export const PLAYBACK_RATES = [0.75, 1, 1.25] as const;

export type Access =
  | { ok: true; via: 'pass' | 'purchase' | 'free' | 'beta' | 'bundle'; expiresAt: string | null }
  | { ok: false; reason: 'not_enrolled' | 'expired' | 'not_published' };

export function courseAccess(input: {
  status: CourseStatus;
  enrollment: { source: 'pass' | 'purchase' | 'free' | 'beta' | 'bundle'; expires_at: string | null } | null;
  coveredByPass: boolean;
  isAuthorOrStaff: boolean;
  now: Date;
}): Access {
  if (input.isAuthorOrStaff) return { ok: true, via: 'free', expiresAt: null };
  if (input.status !== 'published' && !(input.status === 'beta' && input.enrollment?.source === 'beta')) return { ok: false, reason: 'not_published' };
  if (input.coveredByPass) return { ok: true, via: 'pass', expiresAt: null };
  if (!input.enrollment) return { ok: false, reason: 'not_enrolled' };
  if (input.enrollment.expires_at && Date.parse(input.enrollment.expires_at) < input.now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, via: input.enrollment.source, expiresAt: input.enrollment.expires_at };
}

/** Cena kursu: promocja zbiorcza i zniżka dla karnetowiczek (K14) – nie sumują się, wygrywa wyższa. */
export function coursePrice(priceGrosze: number, opts: { promoPct: number; passDiscountPct: number; hasActivePass: boolean }): { price: number; discountPct: number } {
  const pct = Math.max(opts.promoPct, opts.hasActivePass ? opts.passDiscountPct : 0);
  return { price: Math.round((priceGrosze * (100 - pct)) / 100), discountPct: pct };
}

/** Podział przychodów (K6): udział trenerki w %, reszta dla studia. */
export function revenueSplit(grossGrosze: number, trainerSharePct: number) {
  const trainer = Math.round((grossGrosze * trainerSharePct) / 100);
  return { trainer, studio: grossGrosze - trainer };
}

/** Dostęp czasowy: np. 90 dni od zakupu; null = dożywotni. */
export const accessUntil = (accessDays: number | null, from: Date) => (accessDays ? new Date(from.getTime() + accessDays * 86_400_000).toISOString() : null);

/** Numer certyfikatu: krótki, stały dla osoby i kursu. */
export function certificateNo(courseId: string, userId: string): string {
  let h = 0;
  for (const ch of `${courseId}|${userId}`) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return `GLAM-${Math.abs(h).toString(36).toUpperCase().padStart(7, '0')}`;
}
