import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingWindow,
  cancellationOutcome,
  checkAccess,
  DEFAULT_POLICY,
  DEFAULT_PUSH_PREFS,
  describePass,
  goalCount,
  goalExtra,
  passMeter,
  describeRules,
  localParts,
  planSessions,
  takenKey,
  validateSlot,
  plural,
  pushDecision,
  seatDecision,
  validateRules,
  zonedToUtc,
  type Pass,
  type ProductRules,
} from '../src/index.ts';

const pass = (rules: ProductRules, balances: Record<string, number> = {}, extra: Partial<Pass> = {}): Pass => ({
  id: 'p1',
  productName: 'Karnet 9 wejść',
  rules,
  balances,
  validFrom: '2026-10-01T00:00:00Z',
  validUntil: '2026-11-30T22:00:00Z',
  status: 'active',
  ...extra,
});

const at = (date: string, time: string) => zonedToUtc(date, time);
const noUsage = { day: 0, week: 0 };

test('strefa czasowa: 18:00 w Warszawie przed i po zmianie czasu', () => {
  assert.equal(at('2026-10-14', '18:00').toISOString(), '2026-10-14T16:00:00.000Z'); // CEST
  assert.equal(at('2026-11-04', '18:00').toISOString(), '2026-11-04T17:00:00.000Z'); // CET
  assert.equal(localParts(new Date('2026-10-14T16:00:00Z')).time, '18:00');
});

test('odmiana: wejście / wejścia / wejść', () => {
  assert.deepEqual([1, 2, 4, 5, 12, 22, 25].map((n) => plural(n, 'a', 'b', 'c')), ['a', 'b', 'b', 'c', 'c', 'b', 'c']);
});

test('pula wejść: pokrywa wskazany typ, odmawia innym', () => {
  const p = pass({ validityDays: 90, pools: [{ id: 'r', label: 'Reformer', entries: 9, classTypeIds: ['reformer'] }] }, { r: 3 });
  const ok = checkAccess(p, { classTypeId: 'reformer', zoneId: 'pilates', startsAt: at('2026-10-14', '18:00'), usage: noUsage });
  assert.deepEqual(ok.ok && ok.poolId, 'r');
  const no = checkAccess(p, { classTypeId: 'stretch', zoneId: 'stretch', startsAt: at('2026-10-14', '18:00'), usage: noUsage });
  assert.equal(!no.ok && no.reason, 'not_covered');
});

test('pula: najpierw dedykowana, potem ogólna', () => {
  const p = pass(
    {
      validityDays: 30,
      pools: [
        { id: 'any', label: 'Dowolne', entries: 2, classTypeIds: 'all' },
        { id: 'r', label: 'Reformer', entries: 4, classTypeIds: ['reformer'] },
      ],
    },
    { any: 2, r: 1 },
  );
  const res = checkAccess(p, { classTypeId: 'reformer', zoneId: 'z', startsAt: at('2026-10-14', '18:00'), usage: noUsage });
  assert.equal(res.ok && res.poolId, 'r');
});

test('brak wejść, wygaśnięcie, zawieszenie', () => {
  const rules: ProductRules = { validityDays: 30, pools: [{ id: 'a', label: 'A', entries: 4, classTypeIds: 'all' }] };
  const ctx = { classTypeId: 'mat', zoneId: 'z', startsAt: at('2026-10-14', '18:00'), usage: noUsage };
  assert.equal((checkAccess(pass(rules, { a: 0 }), ctx) as { reason: string }).reason, 'no_entries');
  assert.equal((checkAccess(pass(rules, { a: 1 }, { validUntil: '2026-10-10T00:00:00Z' }), ctx) as { reason: string }).reason, 'expired');
  assert.equal((checkAccess(pass(rules, { a: 1 }, { status: 'frozen' }), ctx) as { reason: string }).reason, 'inactive');
});

test('dostęp czasowy z oknem 6:00–22:00 i check-in bez typu zajęć', () => {
  const p = pass({ validityDays: 30, unlimited: { zoneIds: ['gym'], classTypeIds: 'all' }, window: { weekdays: [1, 2, 3, 4, 5, 6, 7], from: '06:00', to: '22:00' } });
  assert.equal(checkAccess(p, { classTypeId: null, zoneId: 'gym', startsAt: at('2026-10-14', '07:00'), usage: noUsage }).ok, true);
  const late = checkAccess(p, { classTypeId: null, zoneId: 'gym', startsAt: at('2026-10-14', '23:00'), usage: noUsage });
  assert.equal(!late.ok && late.reason, 'outside_window');
  assert.equal(checkAccess(p, { classTypeId: null, zoneId: 'pilates', startsAt: at('2026-10-14', '07:00'), usage: noUsage }).ok, false);
});

test('cel tygodnia: licznik nie przekracza celu, nadwyżka osobno', () => {
  assert.equal(goalCount(2, 3), '2/3');
  assert.equal(goalCount(3, 3), '3/3');
  assert.equal(goalCount(4, 3), '3/3');
  assert.equal(goalExtra(4, 3), ' +1');
  assert.equal(goalExtra(3, 3), '');
  assert.equal(goalCount(2, 0), '2');
});

test('opis karnetu: typy o tej samej nazwie wymienione raz', () => {
  const lines = describeRules(
    { validityDays: 30, pools: [{ id: 'p', label: 'P', entries: 4, classTypeIds: ['a', 'b', 'c'] }] },
    { classTypes: { a: 'Pilates Klasyczny', b: 'Pilates Klasyczny', c: 'Reformer Flow' }, zones: {} },
  );
  assert.equal(lines[0], '4 wejścia na Pilates Klasyczny i Reformer Flow');
});

test('karta karnetu: duża cyfra tylko, gdy stan mieści się w jednej liczbie', () => {
  const p = pass({ validityDays: 90, pools: [{ id: 'r', label: 'Reformer', entries: 8, classTypeIds: ['reformer'] }] }, { r: 2 });
  assert.deepEqual(passMeter(p), { value: '2', unit: 'z 8 wejść', until: 'ważny do 30.11' });
  assert.equal(passMeter(pass({ validityDays: 30, pools: [{ id: 'r', label: 'R', entries: 1, classTypeIds: 'all' }] }, { r: 1 }))?.unit, 'z 1 wejścia');
  assert.equal(passMeter(pass({ validityDays: 30, unlimited: { zoneIds: 'all', classTypeIds: 'all' } }, {}))?.value, '∞');
  assert.equal(passMeter({ ...p, status: 'frozen' }), null);
  const two = pass({ validityDays: 30, pools: [{ id: 'a', label: 'A', entries: 4, classTypeIds: 'all' }, { id: 'b', label: 'B', entries: 4, classTypeIds: 'all' }] }, { a: 1, b: 2 });
  assert.equal(passMeter(two), null);
});

test('limit tygodniowy (Mix 8: max 3 w tygodniu)', () => {
  const p = pass({ validityDays: 30, weeklyLimit: 3, pools: [{ id: 'm', label: 'Mix', entries: 8, classTypeIds: 'all' }] }, { m: 8 });
  const res = checkAccess(p, { classTypeId: 'mat', zoneId: 'z', startsAt: at('2026-10-14', '18:00'), usage: { day: 0, week: 3 } });
  assert.equal(!res.ok && res.reason, 'weekly_limit');
});

test('opis karnetu w języku klientki', () => {
  const p = pass({ validityDays: 90, pools: [{ id: 'r', label: 'Reformer', entries: 9, classTypeIds: ['reformer'] }] }, { r: 3 });
  assert.equal(describePass(p), 'Karnet 9 wejść – pozostały 3, ważny do 30.11');
  assert.equal(describePass({ ...p, balances: { r: 1 } }), 'Karnet 9 wejść – pozostało 1, ważny do 30.11');
  const lines = describeRules(
    { validityDays: 30, weeklyLimit: 3, pools: [{ id: 'm', label: 'Mix', entries: 8, classTypeIds: 'all' }] },
    { classTypes: {}, zones: {} },
  );
  assert.deepEqual(lines, ['8 wejść na dowolne zajęcia', 'Ważny 30 dni od zakupu', 'Max 3 wejścia w tygodniu']);
  const three = describeRules({ validityDays: 30, pools: [{ id: 'm', label: 'Mix', entries: 8, classTypeIds: ['r', 'm', 's'] }] }, { classTypes: { r: 'Reformer', m: 'Mat', s: 'Stretch' }, zones: {} });
  assert.equal(three[0], '8 wejść na Reformer, Mat i Stretch');
});

test('walidacja reguł', () => {
  assert.deepEqual(validateRules({ validityDays: 30, pools: [{ id: 'a', label: 'A', entries: 4, classTypeIds: 'all' }] }), []);
  assert.ok(validateRules({ validityDays: 0 }).length >= 2);
});

test('regulamin czasowy: zapis i odwołanie do 2 h przed', () => {
  const start = at('2026-10-14', '18:00');
  const h = (n: number) => new Date(start.getTime() - n * 3_600_000);
  assert.deepEqual(bookingWindow(DEFAULT_POLICY, start, h(3)), { ok: true });
  assert.deepEqual(bookingWindow(DEFAULT_POLICY, start, h(1)), { ok: false, reason: 'closed' });
  assert.deepEqual(bookingWindow(DEFAULT_POLICY, start, h(24 * 20)), { ok: false, reason: 'not_open_yet' });
  assert.equal(cancellationOutcome(DEFAULT_POLICY, start, h(3)), 'refund');
  assert.equal(cancellationOutcome(DEFAULT_POLICY, start, h(1)), 'late');
  assert.equal(cancellationOutcome(DEFAULT_POLICY, start, h(-1)), 'started');
  assert.equal(seatDecision(10, 10, true), 'waitlist');
  assert.equal(seatDecision(10, 10, false), 'full');
});

test('harmonogram: cykliczne sesje z wyjątkiem (święto)', () => {
  const tpl = { id: 't', classTypeId: 'reformer', zoneId: 'pilates', trainerId: 'm', weekday: 1, startTime: '18:00', durationMin: 55, capacity: 10, validFrom: '2026-01-01', validTo: null };
  const sessions = planSessions([tpl, { ...tpl, id: 't2', weekday: 3 }], [{ date: '2026-10-19', zoneId: null, reason: 'Święto' }], '2026-10-12', 14);
  assert.deepEqual(
    sessions.map((s) => s.startsAt),
    ['2026-10-12T16:00:00.000Z', '2026-10-14T16:00:00.000Z', '2026-10-21T16:00:00.000Z'],
  );
});

test('harmonogram: dzień zajęty przez szablon nie dostaje drugiej sesji; walidacja slotu', () => {
  const tpl = { id: 't', classTypeId: 'reformer', zoneId: 'pilates', trainerId: 'm', weekday: 1, startTime: '19:00', durationMin: 55, capacity: 10, validFrom: '2026-01-01', validTo: null };
  const sessions = planSessions([tpl], [], '2026-10-12', 14, undefined, new Set([takenKey('t', '2026-10-12')]));
  assert.deepEqual(sessions.map((s) => s.startsAt), ['2026-10-19T17:00:00.000Z']);
  assert.deepEqual(validateSlot({ weekdays: [1, 3], startTime: '07:30', durationMin: 55, capacity: 8 }), []);
  assert.equal(validateSlot({ weekdays: [], startTime: '7:30', durationMin: 5, capacity: 0 }).length, 4);
});

test('push: ciche godziny, limity, potrzebuję ciszy', () => {
  const night = at('2026-10-14', '23:30');
  const d = pushDecision({ category: 'wellbeing', now: night, prefs: DEFAULT_PUSH_PREFS, sentToday: {} });
  assert.equal(d.send, false);
  assert.equal(!d.send && d.reason === 'quiet_hours' && d.deferUntil.toISOString(), at('2026-10-15', '07:00').toISOString());
  assert.equal(pushDecision({ category: 'transactional', now: night, prefs: DEFAULT_PUSH_PREFS, sentToday: {} }).send, true);
  const noon = at('2026-10-14', '12:00');
  assert.deepEqual(pushDecision({ category: 'reactivation', now: noon, prefs: DEFAULT_PUSH_PREFS, sentToday: { marketing: 1, shop: 1 } }), { send: false, reason: 'daily_limit' });
  assert.deepEqual(pushDecision({ category: 'occasional', now: noon, prefs: { ...DEFAULT_PUSH_PREFS, needQuiet: true }, sentToday: {} }), { send: false, reason: 'need_quiet' });
});

test('oddech: fazy, poziom koła i zatrzymania', async () => {
  const { breathAt, patternById, promptAt, sessionById } = await import('../src/mindful.ts');
  const calm = patternById('calm'); // 4 wdech + 6 wydech
  assert.equal(breathAt(calm, 0).phase.kind, 'in');
  assert.equal(breathAt(calm, 0).level, 0);
  assert.equal(breathAt(calm, 4000).phase.kind, 'out');
  assert.ok(Math.abs(breathAt(calm, 4000).level - 1) < 1e-9, 'po wdechu koło pełne');
  assert.equal(breathAt(calm, 10_000).cycle, 1);
  assert.equal(breathAt(calm, 1000).secondsLeft, 3);

  const box = patternById('box');
  assert.equal(breathAt(box, 5000).phase.kind, 'hold');
  assert.equal(breathAt(box, 5000).level, 1, 'zatrzymanie po wdechu = pełne koło');
  assert.equal(breathAt(box, 13_000).level, 0, 'zatrzymanie po wydechu = puste koło');

  // Wiatr na łące: wydech mocniej niż wdech, na granicy faz tylko spokojne tło.
  const { windAt, WIND_CALM } = await import('../src/mindful.ts');
  assert.ok(Math.abs(windAt(calm, 0) - WIND_CALM) < 1e-9, 'start = cisza');
  assert.ok(Math.abs(windAt(calm, 4000) - WIND_CALM) < 1e-9, 'granica wdech/wydech = cisza');
  assert.ok(windAt(calm, 7000) > windAt(calm, 2000), 'szczyt wydechu mocniejszy niż szczyt wdechu');
  assert.ok(Math.abs(windAt(calm, 7000) - 1) < 1e-9, 'szczyt wydechu = pełny podmuch');
  assert.ok(Math.abs(windAt(box, 6000) - WIND_CALM) < 1e-9, 'zatrzymanie = cisza');

  const morning = sessionById('morning')!;
  assert.equal(promptAt(morning, 0)?.text, 'Usiądź wygodnie. Nigdzie się nie spieszysz.');
  assert.equal(promptAt(morning, 71)?.at, 70);
});

test('rytuał oddechu: seria dni, tydzień, myśl dnia', async () => {
  const { breathRitual, affirmationFor } = await import('../src/mindful.ts');
  // 2026-10-15 to czwartek
  const r = breathRitual(['2026-10-12', '2026-10-13', '2026-10-14'], '2026-10-15');
  assert.equal(r.today, false);
  assert.equal(r.streak, 3, 'dzień, który trwa, nie przerywa serii');
  assert.deepEqual(r.week, [true, true, true, false, false, false, false]);
  assert.equal(breathRitual(['2026-10-13', '2026-10-15'], '2026-10-15').streak, 1);
  assert.equal(breathRitual(['2026-10-12'], '2026-10-15').streak, 0);
  assert.equal(breathRitual([], '2026-10-15').total, 0);
  assert.deepEqual(breathRitual(['2026-10-14', '2026-10-12', '2026-10-14'], '2026-10-15').days, ['2026-10-12', '2026-10-14']);
  assert.equal(affirmationFor('2026-10-15'), affirmationFor('2026-10-15'));
  assert.notEqual(affirmationFor('2026-10-15'), affirmationFor('2026-10-16'));
});

test('logo: rozstrzygnięcie trybu automatycznego', async () => {
  const { resolveLogoDisplay, DEFAULT_LOGO_STYLE } = await import('../src/look.ts');
  assert.deepEqual([resolveLogoDisplay(DEFAULT_LOGO_STYLE, true).shape, resolveLogoDisplay(DEFAULT_LOGO_STYLE, true).showName], ['free', false]);
  assert.deepEqual([resolveLogoDisplay(DEFAULT_LOGO_STYLE, false).shape, resolveLogoDisplay(DEFAULT_LOGO_STYLE, false).showName], ['circle', true]);
  assert.equal(resolveLogoDisplay({ ...DEFAULT_LOGO_STYLE, shape: 'rounded', showName: 'no' }, true).showName, false);
});

test('kwadrat oddechu: kropka obiega kwadrat w rytmie box, inny rytm chodzi po pionowej linii', async () => {
  const { patternById, squarePoint, visualFor } = await import('../src/mindful.ts');
  const box = patternById('box');
  assert.equal(visualFor(box), 'square');
  assert.equal(visualFor(patternById('calm')), 'bloom');
  assert.deepEqual(squarePoint(box, 0, 0), { x: 0, y: 1, fromX: 0, fromY: 1 }, 'wdech startuje w lewym dolnym rogu');
  assert.deepEqual(squarePoint(box, 0, 0.5), { x: 0, y: 0.5, fromX: 0, fromY: 1 }, 'wdech idzie w górę');
  assert.deepEqual(squarePoint(box, 1, 1), { x: 1, y: 0, fromX: 0, fromY: 0 }, 'przytrzymanie po wdechu: górny bok');
  assert.deepEqual(squarePoint(box, 3, 1), { x: 0, y: 1, fromX: 1, fromY: 1 }, 'koniec cyklu wraca do startu');
  const calm = patternById('calm');
  assert.equal(squarePoint(calm, 0, 1).y, 0, 'wdech kończy się u góry linii');
  assert.equal(squarePoint(calm, 1, 1).y, 1, 'wydech kończy się na dole');
  const night = patternById('night');
  assert.equal(squarePoint(night, 1, 0.5).y, 0, 'przytrzymanie po wdechu stoi u góry');
});

test('kod wejścia na żywo: SHA-256/HMAC jak w node:crypto, nowy kod co 30 s', async () => {
  const { createHash, createHmac } = await import('node:crypto');
  const { acceptCheckinStep, CHECKIN_STEP_MS, checkinStep, hmacSha256Hex, liveCheckinCode, sha256 } = await import('../src/checkin.ts');
  for (const n of [0, 55, 56, 64, 65, 200]) {
    const s = 'ż'.repeat(n);
    assert.equal(Buffer.from(sha256(new TextEncoder().encode(s))).toString('hex'), createHash('sha256').update(s).digest('hex'));
    assert.equal(hmacSha256Hex('k'.repeat(n), s), createHmac('sha256', 'k'.repeat(n)).update(s).digest('hex'));
  }
  const seed = { user: 'u_1', date: '2026-10-20', seed: 'abc' };
  const t = Date.parse('2026-10-20T10:00:00Z');
  assert.equal(checkinStep(t), checkinStep(t + CHECKIN_STEP_MS - 1));
  assert.notEqual(liveCheckinCode(seed, checkinStep(t)), liveCheckinCode(seed, checkinStep(t + CHECKIN_STEP_MS)));
  assert.match(liveCheckinCode(seed, 1), /^GLAM2\.u_1\.2026-10-20\.1\.[0-9a-f]{16}$/);
  assert.equal(acceptCheckinStep(100, 100), true);
  assert.equal(acceptCheckinStep(96, 100), false, 'kod sprzed 2 minut już nie przechodzi');
});
