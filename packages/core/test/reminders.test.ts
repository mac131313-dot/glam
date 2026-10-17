import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classReminderOffsets, DEFAULT_CLASS_REMINDERS, dueClassReminder, reminderLead } from '../src/reminders.ts';

const start = new Date('2026-10-20T16:00:00Z');
const at = (minBefore: number) => new Date(start.getTime() - minBefore * 60_000);

test('przypomnienia: brak wyboru = dzień wcześniej i 2 h; pusta lista = wyłączone; nieznane offsety odpadają', () => {
  assert.deepEqual(classReminderOffsets(undefined), DEFAULT_CLASS_REMINDERS);
  assert.deepEqual(classReminderOffsets([]), []);
  assert.deepEqual(classReminderOffsets([60, 999, 60, 1440]), [1440, 60]);
});

test('przypomnienia: wysyłamy dopiero, gdy nadszedł moment, i tylko najbliższy startowi', () => {
  const offsets = [1440, 120, 60];
  const bookedAt = at(3 * 1440);
  assert.equal(dueClassReminder({ startsAt: start, bookedAt, now: at(1500), offsets }), null);
  assert.equal(dueClassReminder({ startsAt: start, bookedAt, now: at(1440), offsets }), 1440);
  assert.equal(dueClassReminder({ startsAt: start, bookedAt, now: at(100), offsets }), 120);
  // po przestoju serwera – jedno, aktualne
  assert.equal(dueClassReminder({ startsAt: start, bookedAt, now: at(30), offsets }), 60);
  assert.equal(dueClassReminder({ startsAt: start, bookedAt, now: at(-5), offsets }), null);
});

test('przypomnienia: nie przypominamy o czymś, na co ktoś właśnie się zapisał', () => {
  assert.equal(dueClassReminder({ startsAt: start, bookedAt: at(40), now: at(39), offsets: [1440, 120] }), null);
  assert.equal(dueClassReminder({ startsAt: start, bookedAt: at(90), now: at(60), offsets: [120, 60] }), 60);
});

test('przypomnienia: treść „za ile”', () => {
  assert.equal(reminderLead(120), 'za 2 godziny');
  assert.equal(reminderLead(60), 'za godzinę');
  assert.equal(reminderLead(30), 'za 30 minut');
});
