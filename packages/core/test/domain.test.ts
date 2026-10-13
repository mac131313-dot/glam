import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abVariant,
  activationValidity,
  applyCoupon,
  badgeAvailable,
  BADGES,
  blackFriday,
  calmDayUnlocked,
  can,
  canTransition,
  contrastRatio,
  classPackagePlans,
  coursePrice,
  cyclePhase,
  earnedBadges,
  easter,
  eventTransitionOk,
  featureEnabled,
  fill,
  freeSlots,
  holidaysOn,
  invoiceNumber,
  isAnniversary,
  journalWeek,
  lessonUnlocked,
  levelFor,
  medicalClaims,
  moderate,
  nps,
  parseCsv,
  passValidity,
  planFreeze,
  quizResult,
  resolveSettings,
  retention,
  revenueSplit,
  rewardCounter,
  rewardCounterCopy,
  scheduledTheme,
  SESSIONS,
  sentenceCount,
  stretchStepAt,
  STRETCH,
  takeStock,
  themeContrastErrors,
  toCsv,
  toIcs,
  TRIGGERS,
  PREVIEW_VARS,
  unlockedFrames,
  validNip,
  vatSplit,
  weeklyStreak,
  DEFAULT_SETTINGS,
  type ClientFacts,
  type Coupon,
} from '../src/index.ts';

const coupon: Coupon = { code: 'URODZINY', kind: 'percent', value: 20, appliesTo: 'pass', perUser: 1, active: true, validFrom: '2026-10-01', validTo: '2026-10-31' };
const ctx = { kind: 'pass' as const, amountGrosze: 26000, userId: 'u', usedTotal: 0, usedByUser: 0, isReturning: false, hasPurchased: true, today: '2026-10-13' };

test('kupony: procent, zakres dat, limit na osobę, tylko dla powracających', () => {
  assert.deepEqual(applyCoupon(coupon, ctx), { ok: true, discountGrosze: 5200, finalGrosze: 20800 });
  assert.equal(applyCoupon(coupon, { ...ctx, today: '2026-11-01' }).ok, false);
  assert.equal(applyCoupon(coupon, { ...ctx, usedByUser: 1 }).ok, false);
  assert.equal(applyCoupon({ ...coupon, returningOnly: true }, ctx).ok, false);
  assert.equal(applyCoupon(coupon, { ...ctx, kind: 'shop' }).ok, false);
  const amount = applyCoupon({ ...coupon, kind: 'amount', value: 99999 }, ctx);
  assert.equal(amount.ok && amount.finalGrosze, 0);
});

test('zawieszenie karnetu: limity razy i dni, przesunięcie ważności', () => {
  const state = { timesUsed: 0, daysUsed: 0, validUntil: '2026-11-30T00:00:00.000Z', status: 'active' };
  const ok = planFreeze({ maxTimes: 2, maxDays: 30 }, state, { from: '2026-10-20', to: '2026-10-29' }, '2026-10-13');
  assert.deepEqual(ok, { ok: true, days: 10, validUntil: '2026-12-10T00:00:00.000Z' });
  assert.equal(planFreeze({ maxTimes: 2, maxDays: 30 }, { ...state, daysUsed: 25 }, { from: '2026-10-20', to: '2026-10-29' }, '2026-10-13').ok, false);
  assert.equal(planFreeze({ maxTimes: 1, maxDays: 30 }, { ...state, timesUsed: 1 }, { from: '2026-10-20', to: '2026-10-21' }, '2026-10-13').ok, false);
  assert.equal(planFreeze({ maxTimes: 0, maxDays: 0 }, state, { from: '2026-10-20', to: '2026-10-21' }, '2026-10-13').ok, false);
});

test('ważność od aktywacji: czeka na pierwsze wejście, potem liczy się od zajęć', () => {
  const rules = { validityDays: 30, validFrom: 'activation' as const, pools: [] };
  const v = passValidity(rules, new Date('2026-10-01T10:00:00Z'));
  assert.ok(Date.parse(v.validUntil) - Date.parse(v.validFrom) > 100 * 86_400_000);
  assert.equal(activationValidity(rules, new Date('2026-10-20T18:00:00Z')).validUntil, '2026-11-19T00:00:00.000Z');
});

test('faktury i sklep: VAT z brutto, numeracja, stany magazynowe', () => {
  assert.deepEqual(vatSplit(10800, 8), { net: 10000, vat: 800, gross: 10800 });
  assert.equal(invoiceNumber('FV', '2026-10-13', 7), 'FV/2026/10/0007');
  const v = takeStock([{ id: 's', size: 'S', stock: 1 }], 's', 1);
  assert.equal(v[0].stock, 0);
  assert.throws(() => takeStock(v, 's', 1), /wyprzedany/);
});

test('motywacja: seria tygodni, odznaki, poziomy, nagroda po 10, ramki', () => {
  assert.equal(weeklyStreak(['2026-10-13', '2026-10-06', '2026-09-29', '2026-09-15'], '2026-10-14'), 3);
  assert.equal(weeklyStreak(['2026-10-06', '2026-09-29'], '2026-10-14'), 2); // bieżący tydzień jeszcze trwa
  assert.deepEqual(
    earnedBadges({ attended: 10, streakWeeks: 4, daysSinceJoin: 40, mindfulSessions: 1, journalEntries: 0, calmCourseDone: false, friendsBrought: 1, themesSeen: 3 }).sort(),
    ['collector', 'first_class', 'first_meditation', 'first_month', 'friend', 'streak_4', 'ten_classes'],
  );
  const levels = DEFAULT_SETTINGS.loyalty.levels;
  assert.equal(levelFor(350, levels).current.name, 'Flow');
  assert.equal(levelFor(350, levels).toNext, 650);
  assert.deepEqual(rewardCounter(7, 10), { left: 3, milestone: 10, reached: 0 });
  assert.equal(rewardCounterCopy(3), 'Do nagrody zostały 3 treningi');
  assert.ok(unlockedFrames({ badges: ['ten_classes'], levelId: 'flow', levels }).includes('flow'));
  assert.ok(!unlockedFrames({ badges: [], levelId: 'start', levels }).includes('queen'));
  const ghost = BADGES.find((b) => b.code === 'ghost')!;
  assert.equal(badgeAvailable(ghost, '2026-10-31'), true);
  assert.equal(badgeAvailable(ghost, '2026-12-01'), false);
});

test('okazje: Wielkanoc, Black Friday, święta, rocznice, szablony', () => {
  assert.equal(easter(2027), '2027-03-28');
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(blackFriday(2026), '2026-11-27');
  assert.deepEqual(holidaysOn('2027-03-08').map((h) => h.id), ['dzien_kobiet']);
  assert.equal(isAnniversary('2025-10-13', '2026-10-13'), 1);
  assert.equal(isAnniversary('2024-02-29', '2025-02-28'), 1);
  assert.equal(fill('Wszystkiego dobrego, {imię}!', { imię: 'Magda' }), 'Wszystkiego dobrego, Magda!');
  assert.equal(fill('Spokojnych Świąt, {imię}.', {}), 'Spokojnych Świąt.');
});

test('push: każdy wyzwalacz ma max 2 zdania', () => {
  for (const [id, t] of Object.entries(TRIGGERS)) assert.ok(sentenceCount(t.text(PREVIEW_VARS)) <= 2, id);
});

test('moderacja: wulgaryzmy (także zamaskowane), ocenianie ciała, linki', () => {
  assert.equal(moderate('Super zajęcia, dziękuję!').ok, true);
  assert.deepEqual(moderate('kurrrwa'), { ok: false, reason: 'profanity' });
  assert.deepEqual(moderate('ch.uj'), { ok: false, reason: 'profanity' });
  assert.deepEqual(moderate('ile spalić kalorie?'), { ok: false, reason: 'body_shaming' });
  assert.deepEqual(moderate('zobacz www.spam.pl'), { ok: false, reason: 'links' });
  assert.deepEqual(medicalClaims('Ten kurs wyleczy ból pleców'), ['wyleczy', 'leczy']);
});

test('analityka: retencja, NPS, A/B stabilne dla osoby', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const base: Omit<ClientFacts, 'userId' | 'joinedAt' | 'visits'> = { lastVisit: null, referralsConverted: 0, lastNps: null, hasActivePass: true, passEndsInDays: 10, lateCancels30d: 0, revenueGrosze: 0 };
  const clients: ClientFacts[] = [
    { ...base, userId: 'a', joinedAt: '2026-07-01T00:00:00Z', visits: ['2026-08-15T00:00:00Z'] },
    { ...base, userId: 'b', joinedAt: '2026-07-01T00:00:00Z', visits: ['2026-07-02T00:00:00Z'] },
    { ...base, userId: 'c', joinedAt: '2026-10-10T00:00:00Z', visits: [] },
  ];
  assert.equal(retention(clients, 30, now), 50);
  assert.equal(nps([10, 9, 8, 3]), 25);
  assert.equal(abVariant('u1', 'c1', 2), abVariant('u1', 'c1', 2));
});

test('dobrostan: 20+ medytacji, 7 dni spokoju, stretch, dziennik, quiz, cykl', () => {
  assert.ok(SESSIONS.length >= 20);
  assert.equal(calmDayUnlocked([{ day: 1, doneOn: '2026-10-12' }], 2, '2026-10-13'), true);
  assert.equal(calmDayUnlocked([{ day: 1, doneOn: '2026-10-13' }], 2, '2026-10-13'), false);
  const office = STRETCH.find((r) => r.id === 'office5')!;
  assert.equal(stretchStepAt(office, 0)!.index, 0);
  assert.equal(stretchStepAt(office, 9999), null);
  const week = journalWeek([
    { date: '2026-10-12', mood: 4, energy: 3, sleep: 2 },
    { date: '2026-10-13', mood: 5, energy: 4, sleep: 2, gratitude: 'Kawa z siostrą' },
  ]);
  assert.equal(week.mood, 4.5);
  assert.equal(week.bestDay, '2026-10-13');
  assert.match(week.note, /Sen/);
  const q = quizResult({ dayPart: 'evening', energy: 'low', minutes: 15, goal: 'calm', reminders: 'gentle' });
  assert.equal(q.reminderTime, '19:30');
  assert.equal(q.meditation, 'sleep-5');
  assert.equal(cyclePhase('2026-10-01', '2026-10-03').phase, 'menstrual');
  assert.equal(cyclePhase('2026-10-01', '2026-10-25').phase, 'luteal');
});

test('kursy: drip, cena z promocją, podział 70/30, przejścia statusu', () => {
  const lesson = { id: 'l2', unlockDay: 0, freePreview: false, durationSec: 600, sort: 2 };
  const now = new Date('2026-10-13T12:00:00Z');
  assert.equal(lessonUnlocked(lesson, '2026-10-10T12:00:00Z', now, 7, 1), false);
  assert.equal(lessonUnlocked(lesson, '2026-10-01T12:00:00Z', now, 7, 1), true);
  assert.equal(lessonUnlocked({ ...lesson, freePreview: true }, null, now, 7, 1), true);
  assert.deepEqual(coursePrice(20000, { promoPct: 25, passDiscountPct: 20, hasActivePass: true }), { price: 15000, discountPct: 25 });
  assert.deepEqual(revenueSplit(10000, 70), { trainer: 7000, studio: 3000 });
  assert.equal(canTransition('pending', 'published', 'author'), false);
  assert.equal(canTransition('pending', 'published', 'owner'), true);
});

test('pakiet zajęć: rok wychodzi taniej na tydzień, jednorazowy się nie odnawia', () => {
  const plans = classPackagePlans([
    { id: 'y', name: 'Rok', priceGrosze: 159900, validityDays: 365, billing: 'year', lines: [] },
    { id: 'w', name: 'Tydzień', priceGrosze: 7900, validityDays: 7, billing: 'week', lines: [] },
    { id: 'o', name: 'Mix 8', priceGrosze: 40000, validityDays: 30, billing: 'once', lines: ['8 wejść na Reformer, Mat i Stretch'] },
    { id: 'x', name: 'Siłownia', priceGrosze: 14900, validityDays: 30, lines: ['Bez limitu'] },
  ]);
  assert.deepEqual(
    plans.map((p) => p.billing),
    ['year', 'week', 'once'],
  );
  assert.equal(plans[0].savePct, 61);
  assert.equal(plans[0].priceMain, '30,67 zł / tydzień');
  assert.equal(plans[0].priceSub, 'tylko 1599 zł / rok');
  assert.equal(plans[0].autoRenew, true);
  assert.equal(plans[1].priceMain, '79 zł / tydzień');
  assert.equal(plans[1].savePct, null);
  assert.equal(plans[2].autoRenew, false);
  assert.equal(plans[2].priceMain, '400 zł');
  assert.equal(plans[2].caption, '8 wejść na Reformer, Mat i Stretch');
  assert.equal(classPackagePlans([{ id: 'y', name: 'Rok', priceGrosze: 159900, validityDays: 365, billing: 'year', lines: [] }])[0].savePct, null);
});

test('wydarzenia: wolne sloty bez kolizji z salą i trenerką, przejścia statusu', () => {
  const slots = freeSlots({
    dayStartIso: '2026-10-20T08:00:00.000Z',
    dayEndIso: '2026-10-20T12:00:00.000Z',
    durationMin: 90,
    busyZone: [{ start: '2026-10-20T09:00:00.000Z', end: '2026-10-20T10:00:00.000Z' }],
    busyTrainer: [],
  });
  assert.deepEqual(slots, ['2026-10-20T10:00:00.000Z', '2026-10-20T10:30:00.000Z']);
  assert.equal(eventTransitionOk('inquiry', 'offer'), true);
  assert.equal(eventTransitionOk('done', 'cancelled'), false);
});

test('formaty: iCalendar, CSV w obie strony, NIP', () => {
  const ics = toIcs('Moje zajęcia', [{ uid: 'b1', start: '2026-10-14T16:00:00.000Z', end: '2026-10-14T16:55:00.000Z', title: 'Reformer; prowadzi Marzena' }]);
  assert.match(ics, /DTSTART:20261014T160000Z/);
  assert.match(ics, /SUMMARY:Reformer\\; prowadzi Marzena/);
  const csv = toCsv([{ imię: 'Ewa', notatka: 'a;b "c"' }]);
  assert.deepEqual(parseCsv(csv), [{ imię: 'Ewa', notatka: 'a;b "c"' }]);
  assert.deepEqual(parseCsv('telefon,imię\n500600700,Ola\n'), [{ telefon: '500600700', imię: 'Ola' }]);
  assert.equal(validNip('5260250274'), true);
  assert.equal(validNip('5260250275'), false);
});

test('motywy: harmonogram (krótszy wygrywa), ręczny ma pierwszeństwo, kontrast WCAG', () => {
  const themes = [
    { id: 'oct', startsOn: '2026-10-01', endsOn: '2026-10-31', auto: true, isActive: false, segment: null },
    { id: 'hal', startsOn: '2026-10-31', endsOn: '2026-10-31', auto: true, isActive: false, segment: null },
  ];
  assert.equal(scheduledTheme(themes, '2026-10-13'), 'oct');
  assert.equal(scheduledTheme(themes, '2026-10-31'), 'hal');
  assert.equal(scheduledTheme([...themes, { id: 'man', startsOn: null, endsOn: null, auto: false, isActive: true, segment: null }], '2026-10-31'), 'man');
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.deepEqual(themeContrastErrors({ ink: '#cccccc', bg: '#ffffff' }), ['Za mały kontrast: tekst na tle (min. 4,5:1).']);
});

test('role i SaaS: siatka uprawnień, koordynatorka bez finansów, plany i flagi, ustawienia', () => {
  assert.equal(can(['coordinator'], 'community.moderate'), true);
  assert.equal(can(['coordinator'], 'finance.view'), false);
  assert.equal(can(['coordinator'], 'campaigns.edit'), false);
  assert.equal(can(['trainer'], 'notes.write'), true);
  assert.equal(can(['client'], 'schedule.view'), false);
  assert.equal(featureEnabled('start', {}, 'courses'), false);
  assert.equal(featureEnabled('start', { courses: true }, 'courses'), true);
  assert.equal(featureEnabled('studio', { shop: false }, 'shop'), false);
  const s = resolveSettings({ freeze: { maxDays: 90 }, support: { faq: [] } });
  assert.equal(s.freeze.maxDays, 90);
  assert.equal(s.freeze.maxTimes, 2);
  assert.deepEqual(s.support.faq, []);
});
