import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanAudience, cleanFit, cleanWindow, daysLabel, DAY_FROM, DAY_TO, FIT_THRESHOLD, fitGoalLabel, fitScore, levelFromText, windowLabel, type ClassFit, type ClassWhen } from '../src/classfit.ts';

const beginner: ClassFit = { level: 'beginner', focus: ['stretch'], forWhom: [], days: [], from: 17 * 60, to: 21 * 60 };
/** wtorek 18:00–19:00 i 9:00–10:00 */
const evening: ClassWhen = { weekday: 2, start: 18 * 60, end: 19 * 60 };
const morning: ClassWhen = { weekday: 2, start: 9 * 60, end: 10 * 60 };

test('dopasowanie: poziom, cel i pora podnoszą wynik; zaawansowane nie trafiają do początkującej', () => {
  const match = fitScore({ level: 'beginner', focus: ['stretch'], forWhom: [] }, beginner, evening);
  assert.ok(match >= FIT_THRESHOLD);
  assert.equal(fitScore({ level: 'advanced', focus: ['stretch'], forWhom: [] }, beginner, evening), 0);
  assert.ok(fitScore({ level: 'all', focus: ['energy'], forWhom: [] }, beginner, morning) < FIT_THRESHOLD);
});

test('dopasowanie: zajęcia tylko dla kobiet w ciąży podpowiadamy wyłącznie im', () => {
  const prenatal = { level: 'all' as const, focus: ['stretch' as const], forWhom: ['pregnancy' as const] };
  assert.equal(fitScore(prenatal, beginner, evening), 0);
  assert.ok(fitScore(prenatal, { ...beginner, forWhom: ['pregnancy'] }, evening) >= FIT_THRESHOLD);
  // grupa specjalna obok zwykłej nie wyklucza innych
  assert.ok(fitScore({ level: 'all', focus: ['stretch'], forWhom: ['gentle', 'back'] }, beginner, evening) > 0);
});

test('dopasowanie: stare poziomy tekstem, śmieci z formularza', () => {
  assert.equal(levelFromText('średniozaawansowany'), 'intermediate');
  assert.equal(levelFromText('podstawowy'), 'beginner');
  assert.equal(levelFromText('wszystkie poziomy'), 'all');
  assert.deepEqual(cleanAudience({ level: 'x', focus: ['stretch', 'hack'], forWhom: 'no' }, 'początkujące'), { level: 'beginner', focus: ['stretch'], forWhom: [] });
  assert.equal(cleanFit({ focus: ['stretch'] }), null);
});

test('dopasowanie: dawne „50+” czytamy jako spokojne tempo, a „dla kogo” nie trafia do celu trenerki', () => {
  assert.deepEqual(cleanFit({ level: 'beginner', forWhom: ['senior', 'back'] })?.forWhom, ['gentle', 'back']);
  assert.equal(fitGoalLabel({ ...beginner, focus: [], forWhom: ['pregnancy'] }), undefined);
});

test('preferencje czasu: dzień i całe zajęcia w oknie, poza nim nie podpowiadamy', () => {
  const stretch = { level: 'beginner' as const, focus: ['stretch' as const], forWhom: [] };
  assert.equal(fitScore(stretch, beginner, morning), 0);
  // kończą się po 21:00 – nie zdąży
  assert.equal(fitScore(stretch, beginner, { weekday: 2, start: 20 * 60 + 30, end: 21 * 60 + 30 }), 0);
  assert.equal(fitScore(stretch, { ...beginner, days: [6, 0] }, evening), 0);
  assert.ok(fitScore(stretch, { ...beginner, days: [2] }, evening) >= FIT_THRESHOLD);
  // bez zawężenia pora nie ma znaczenia
  const anytime = { ...beginner, from: DAY_FROM, to: DAY_TO };
  assert.equal(fitScore(stretch, anytime, morning), fitScore(stretch, anytime, evening));
});

test('preferencje czasu: formularz sam pilnuje okna, stare pory zamieniamy na dni i godziny', () => {
  assert.deepEqual(cleanWindow(20 * 60, 18 * 60), { from: 20 * 60, to: 21 * 60 });
  assert.deepEqual(cleanWindow(3 * 60 + 10, 'x'), { from: DAY_FROM, to: DAY_TO });
  assert.deepEqual(cleanWindow(17 * 60 + 20, 23 * 60), { from: 17 * 60 + 30, to: DAY_TO });
  const legacy = cleanFit({ level: 'beginner', times: ['morning', 'evening'] });
  assert.deepEqual([legacy?.days, legacy?.from, legacy?.to], [[], 6 * 60, 22 * 60]);
  assert.deepEqual(cleanFit({ level: 'beginner', times: ['weekend'] })?.days, [6, 0]);
  assert.deepEqual(cleanFit({ level: 'beginner', days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 0 })?.days, []);
  assert.deepEqual(cleanFit({ level: 'beginner', days: [5, 1, 9, 'x'] })?.days, [1, 5]);
});

test('preferencje czasu: krótkie podpisy', () => {
  assert.equal(daysLabel([1, 2, 3, 4, 5]), 'pn–pt');
  assert.equal(daysLabel([0, 6]), 'weekend');
  assert.equal(daysLabel([5, 1, 3]), 'pn, śr, pt');
  assert.equal(daysLabel([]), 'każdy dzień');
  assert.equal(windowLabel({ from: 17 * 60 + 30, to: 21 * 60 }), '17:30–21:00');
  assert.equal(windowLabel({ from: DAY_FROM, to: DAY_TO }), 'o każdej porze');
});
