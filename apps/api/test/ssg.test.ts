import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { checkAccess, initialBalances, nextReceptionLabel, receptionOpen, type Pass, type ProductRules } from '@glam/core';
import { openDb } from '../src/db.ts';
import { seed } from '../src/seed.ts';
import { SSG_STUDIO } from '../src/seed-ssg.ts';
import { loadStudio } from '../src/services/studio.ts';

const db = openDb(':memory:');
const NOW = new Date('2026-10-13T10:00:00Z');

before(() => {
  const warn = console.warn;
  console.warn = () => {};
  seed(db, NOW);
  console.warn = warn;
});

function passFor(productId: string): Pass {
  const row = db.prepare('SELECT p.name, v.rules_json FROM products p JOIN product_versions v ON v.id = p.current_version_id WHERE p.id = ?').get(productId) as { name: string; rules_json: string };
  const rules = JSON.parse(row.rules_json) as ProductRules;
  return { id: productId, productName: row.name, rules, balances: initialBalances(rules), validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-12-31T00:00:00Z', status: 'active' };
}

const at = (classTypeId: string | null, zoneId: string) => ({ classTypeId, zoneId, startsAt: new Date('2026-10-20T16:00:00Z'), usage: { day: 0, week: 0 } });

test('SS&G: grafik reformerów i zajęć grupowych z materiałów studia', () => {
  const count = (zone: string) =>
    (db.prepare('SELECT COUNT(*) AS n FROM schedule_templates t JOIN class_types c ON c.id = t.class_type_id WHERE t.studio_id = ? AND c.zone_id = ?').get(SSG_STUDIO, zone) as { n: number }).n;
  assert.equal(count('z_ss_reformer'), 20);
  assert.equal(count('z_ss_group'), 14);
  const sessions = (db.prepare("SELECT COUNT(*) AS n FROM class_sessions WHERE studio_id = ? AND starts_at > ?").get(SSG_STUDIO, NOW.toISOString()) as { n: number }).n;
  assert.ok(sessions > 100, `sesje na 4 tygodnie do przodu (${sessions})`);
});

test('SS&G: Open obejmuje zajęcia grupowe i siłownię, ale nie reformery', () => {
  const open = passFor('ss_open');
  assert.equal(checkAccess(open, at('ss_girly', 'z_ss_group')).ok, true);
  assert.equal(checkAccess(open, at(null, 'z_ss_gym')).ok, true);
  assert.equal(checkAccess(open, at('ss_flow', 'z_ss_reformer')).ok, false);
});

test('SS&G: pojedyncze wejście 80 zł – zajęcia grupowe albo siłownia, bez reformera', () => {
  const single = passFor('ss_single');
  assert.equal(checkAccess(single, at('ss_split', 'z_ss_group')).ok, true);
  assert.equal(checkAccess(single, at(null, 'z_ss_gym')).ok, true);
  assert.equal(checkAccess(single, at('ss_hips', 'z_ss_reformer')).ok, false);
});

test('SS&G: Kurs Szpagatu raz w tygodniu, Flexy bez ograniczeń grupowych i na 6 tygodni', () => {
  const basic = passFor('ss_split8');
  const flexy = passFor('ss_flexy');
  const secondThisWeek = { ...at('ss_split', 'z_ss_group'), usage: { day: 0, week: 1 } };
  assert.deepEqual(checkAccess(basic, secondThisWeek), { ok: false, pass: basic, reason: 'weekly_limit' });
  assert.equal(checkAccess(flexy, secondThisWeek).ok, true);
  assert.equal(flexy.rules.validityDays, 42);
  assert.equal(checkAccess(flexy, at('ss_girly', 'z_ss_group')).ok, false);
});

test('SS&G: siłownia dla klubowiczów tylko w recepcji', () => {
  const ch = (id: string) => JSON.parse((db.prepare('SELECT channels_json FROM products WHERE id = ?').get(id) as { channels_json: string }).channels_json);
  assert.deepEqual(ch('ss_gym_club'), ['desk']);
  assert.deepEqual(ch('ss_gym'), ['app', 'desk']);
});

test('SS&G: godziny recepcji – kilka okien dziennie i najbliższe otwarcie', () => {
  const { support } = loadStudio(db, SSG_STUDIO).settings;
  const tz = 'Europe/Warsaw';
  // wtorek 13.10: 07:30–10:15 i 16:30–21:15
  assert.equal(receptionOpen(support.hours, new Date('2026-10-13T06:00:00Z'), tz), true);
  assert.equal(receptionOpen(support.hours, new Date('2026-10-13T10:00:00Z'), tz), false);
  assert.equal(nextReceptionLabel(support.hours, new Date('2026-10-13T10:00:00Z'), tz), 'dziś 16:30–21:15');
  // sobota po 11:15 → niedziela nieczynna → poniedziałek
  assert.equal(nextReceptionLabel(support.hours, new Date('2026-10-17T10:00:00Z'), tz), 'w poniedziałek 17:30–21:15');
  assert.equal(nextReceptionLabel(support.hours, new Date('2026-10-18T10:00:00Z'), tz), 'jutro 17:30–21:15');
});

test('godziny recepcji bez slotów działają jak dotąd (jedno okno w wybrane dni)', () => {
  const hours = loadStudio(db, 'st_rzeszow').settings.support.hours;
  assert.deepEqual(hours.slots, []);
  assert.equal(receptionOpen(hours, new Date('2026-10-13T10:00:00Z')), true);
  assert.equal(receptionOpen(hours, new Date('2026-10-18T10:00:00Z')), false, 'niedziela');
});
