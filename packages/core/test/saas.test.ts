import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessFromBilling, planById, planUsage, smsAllowed, type BillingFacts, type Usage } from '../src/index.ts';

const now = new Date('2026-11-10T12:00:00Z');
const none: BillingFacts = { state: 'none', currentPeriodEnd: null, pastDueSince: null, manualSuspension: null };

test('dostęp: trwający okres próbny bez subskrypcji to trial', () => {
  assert.equal(accessFromBilling('2026-11-20T00:00:00Z', none, now), 'trial');
});

test('dostęp: po końcu triala bez subskrypcji studio jest zawieszone', () => {
  assert.equal(accessFromBilling('2026-11-01T00:00:00Z', none, now), 'suspended');
});

test('dostęp: po końcu triala z aktywną subskrypcją studio jest aktywne', () => {
  assert.equal(accessFromBilling('2026-11-01T00:00:00Z', { ...none, state: 'active' }, now), 'active');
});

test('dostęp: karta dodana w trakcie triala nie kończy triala', () => {
  assert.equal(accessFromBilling('2026-11-20T00:00:00Z', { ...none, state: 'active' }, now), 'trial');
});

test('dostęp: zaległa płatność ma 7 dni karencji', () => {
  const inGrace = { ...none, state: 'past_due' as const, pastDueSince: '2026-11-05T12:00:00Z' };
  const afterGrace = { ...none, state: 'past_due' as const, pastDueSince: '2026-11-02T12:00:00Z' };
  assert.equal(accessFromBilling('2026-11-01T00:00:00Z', inGrace, now), 'active');
  assert.equal(accessFromBilling('2026-11-01T00:00:00Z', afterGrace, now), 'suspended');
});

test('dostęp: anulowana subskrypcja działa do końca opłaconego okresu', () => {
  const open = { ...none, state: 'canceled' as const, currentPeriodEnd: '2026-11-15T00:00:00Z' };
  const closed = { ...none, state: 'canceled' as const, currentPeriodEnd: '2026-11-09T00:00:00Z' };
  assert.equal(accessFromBilling('2026-11-01T00:00:00Z', open, now), 'active');
  assert.equal(accessFromBilling('2026-11-01T00:00:00Z', closed, now), 'suspended');
});

test('dostęp: ręczne zawieszenie wygrywa z aktywną subskrypcją', () => {
  const facts = { ...none, state: 'active' as const, manualSuspension: 'Nieopłacone faktury' };
  assert.equal(accessFromBilling('2026-11-01T00:00:00Z', facts, now), 'suspended');
});

const usage: Usage = { activeClients: 121, smsThisMonth: 310, storageMb: 10, staff: 5, facilities: 1 };

test('limity planu: pozycje w stałej kolejności z polskimi nazwami', () => {
  const rows = planUsage(usage, planById('start'));
  assert.deepEqual(
    rows.map((r) => [r.key, r.label]),
    [
      ['activeClients', 'Aktywne klientki'],
      ['smsPerMonth', 'SMS w miesiącu'],
      ['videoMb', 'Wideo (MB)'],
      ['staff', 'Zespół'],
      ['facilities', 'Obiekty'],
    ],
  );
});

test('limity planu: stan ok, blisko (od 80%) i przekroczony', () => {
  const rows = planUsage(usage, planById('start'));
  const state = (key: string) => rows.find((r) => r.key === key)?.state;
  assert.equal(state('activeClients'), 'near'); // 121/150
  assert.equal(state('smsPerMonth'), 'over'); // 310/300
  assert.equal(state('videoMb'), 'ok'); // 10/500
  assert.equal(state('staff'), 'near'); // 5/5 to granica, nie przekroczenie
  assert.equal(state('facilities'), 'near'); // 1/1
});

test('limity planu: zużycie i limit trafiają do pozycji', () => {
  const sms = planUsage(usage, planById('start')).find((r) => r.key === 'smsPerMonth');
  assert.equal(sms?.used, 310);
  assert.equal(sms?.limit, 300);
});

test('SMS: wysyłka dozwolona do wyczerpania miesięcznego limitu', () => {
  const start = planById('start');
  assert.equal(smsAllowed(299, start), true);
  assert.equal(smsAllowed(300, start), false);
  assert.equal(smsAllowed(299, start, 2), false);
});
