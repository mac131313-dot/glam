import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanAudience, cleanFit, dayTimesOf, FIT_THRESHOLD, fitGoalLabel, fitScore, levelFromText, type ClassFit } from '../src/classfit.ts';

const beginner: ClassFit = { level: 'beginner', focus: ['stretch'], forWhom: [], times: ['evening'] };

test('dopasowanie: poziom, cel i pora podnoszą wynik; zaawansowane nie trafiają do początkującej', () => {
  const match = fitScore({ level: 'beginner', focus: ['stretch'], forWhom: [] }, beginner, ['evening']);
  assert.ok(match >= FIT_THRESHOLD);
  assert.equal(fitScore({ level: 'advanced', focus: ['stretch'], forWhom: [] }, beginner, ['evening']), 0);
  assert.ok(fitScore({ level: 'all', focus: ['energy'], forWhom: [] }, beginner, ['morning']) < FIT_THRESHOLD);
});

test('dopasowanie: zajęcia tylko dla kobiet w ciąży podpowiadamy wyłącznie im', () => {
  const prenatal = { level: 'all' as const, focus: ['stretch' as const], forWhom: ['pregnancy' as const] };
  assert.equal(fitScore(prenatal, beginner, ['evening']), 0);
  assert.ok(fitScore(prenatal, { ...beginner, forWhom: ['pregnancy'] }, ['evening']) >= FIT_THRESHOLD);
  // grupa specjalna obok zwykłej nie wyklucza innych
  assert.ok(fitScore({ level: 'all', focus: ['stretch'], forWhom: ['gentle', 'back'] }, beginner, ['evening']) > 0);
});

test('dopasowanie: stare poziomy tekstem, śmieci z formularza i pory dnia', () => {
  assert.equal(levelFromText('średniozaawansowany'), 'intermediate');
  assert.equal(levelFromText('podstawowy'), 'beginner');
  assert.equal(levelFromText('wszystkie poziomy'), 'all');
  assert.deepEqual(cleanAudience({ level: 'x', focus: ['stretch', 'hack'], forWhom: 'no' }, 'początkujące'), { level: 'beginner', focus: ['stretch'], forWhom: [] });
  assert.equal(cleanFit({ focus: ['stretch'] }), null);
  assert.deepEqual(dayTimesOf(18, 6), ['weekend', 'evening']);
  assert.deepEqual(dayTimesOf(9, 2), ['morning']);
});

test('dopasowanie: dawne „50+” czytamy jako spokojne tempo, a „dla kogo” nie trafia do celu trenerki', () => {
  assert.deepEqual(cleanFit({ level: 'beginner', forWhom: ['senior', 'back'] })?.forWhom, ['gentle', 'back']);
  assert.equal(fitGoalLabel({ ...beginner, focus: [], forWhom: ['pregnancy'] }), undefined);
});
