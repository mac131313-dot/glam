// Zadania cykliczne – to, co „system robi sam” (sekcje 1, 4, 7, 8, 8.1). Uruchamiane co minutę dla każdego
// studia osobno. Każdy wyzwalacz jest idempotentny: job_runs albo dedupe_key powiadomienia pilnują, żeby
// nic nie poszło dwa razy, nawet po restarcie serwera.
import {
  addDays,
  fill,
  holidaysOn,
  initialBalances,
  isAnniversary,
  lessonUnlocked,
  localParts,
  passValidity,
  scheduledTheme,
  toMinutes,
  TRIGGERS,
  weekStart,
  weeklyStreak,
  WISHES,
  type ProductRules,
} from '@glam/core';
import type { Deps } from '../context.ts';
import { id, type Db } from '../db.ts';
import { StudioScope } from '../scope.ts';
import { bookSession } from './booking.ts';
import { awardPoints, grantBadge, onAttended } from './motivation.ts';
import { notify } from './notify.ts';
import { issuePass } from './passes.ts';
import { recordPayment } from './payments.ts';
import { fillSchedule } from './schedule.ts';
import { loadStudio, type Studio } from './studio.ts';
import { weekProgress } from './progress.ts';

type Ctx = { deps: Deps; scope: StudioScope; studio: Studio; now: Date; today: string; minutes: number; weekday: number };

/** Pierwsze wywołanie z danym kluczem zwraca true; kolejne – false. */
function once(scope: StudioScope, key: string, now: Date): boolean {
  return !!scope.run('INSERT OR IGNORE INTO job_runs (studio_id, key, ran_at) VALUES ($studio, $k, $now)', { k: key, now: now.toISOString() }).changes;
}

const atOrAfter = (c: Ctx, hhmm: string) => c.minutes >= toMinutes(hhmm);
const clients = (scope: StudioScope) =>
  scope.all<{ id: string; name: string | null; birthday: string | null; nameday: string | null; prefs_json: string | null; joined_at: string; trainer_id: string | null }>(
    `SELECT u.id, u.name, u.birthday, u.nameday, u.prefs_json, m.joined_at, m.trainer_id FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.studio_id = $studio AND m.role = 'client'`,
  );

export async function runJobs(deps: Deps, now = new Date()) {
  const studios = deps.db.prepare("SELECT id FROM studios WHERE status != 'suspended'").all() as { id: string }[];
  for (const { id: studioId } of studios) {
    const studio = loadStudio(deps.db, studioId);
    const scope = new StudioScope(deps.db, studioId);
    const lp = localParts(now, studio.timezone);
    const c: Ctx = { deps, scope, studio, now, today: lp.date, minutes: lp.minutes, weekday: lp.weekday };
    for (const job of JOBS) {
      try {
        job(c);
      } catch (err) {
        console.error(`job ${job.name} (${studioId})`, err);
      }
    }
    try {
      await renewals(c);
    } catch (err) {
      console.error(`renewals (${studioId})`, err);
    }
  }
  platformJobs(deps.db, now);
}

// ——— Grafik ———

function autofill(c: Ctx) {
  if (once(c.scope, `fill:${c.now.toISOString().slice(0, 13)}`, c.now)) fillSchedule(c.scope, c.studio, c.now);
}

/** Zajęcia minęły: zapisane → obecna (auto-zaliczenie) albo nieobecna, gdy studio robi check-in. */
function closeSessions(c: Ctx) {
  const rows = c.scope.all<{ id: string; user_id: string; guest_name: string | null }>(
    `SELECT b.id, b.user_id, b.guest_name FROM bookings b JOIN class_sessions s ON s.id = b.session_id
     WHERE b.studio_id = $studio AND b.status = 'booked' AND s.status = 'scheduled' AND s.ends_at < $cut`,
    { cut: new Date(c.now.getTime() - 30 * 60_000).toISOString() },
  );
  for (const b of rows) {
    c.scope.tx(() => {
      c.scope.run('UPDATE bookings SET status = $st, updated_at = $now WHERE studio_id = $studio AND id = $id', { st: c.studio.settings.autoAttend ? 'attended' : 'no_show', now: c.now.toISOString(), id: b.id });
      if (c.studio.settings.autoAttend && !b.guest_name) onAttended(c.scope, c.studio, b.user_id, b.id, c.now);
    });
  }
}

/** Przypomnienia 24 h i 2 h przed + prośba o potwierdzenie obecności (8). */
function classReminders(c: Ctx) {
  const rows = c.scope.all<{ id: string; user_id: string; confirmed_at: string | null; starts_at: string; class_name: string; trainer: string }>(
    `SELECT b.id, b.user_id, b.confirmed_at, s.starts_at, COALESCE(s.title, ct.name) AS class_name, u.name AS trainer
     FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id JOIN users u ON u.id = s.trainer_id
     WHERE b.studio_id = $studio AND b.status = 'booked' AND b.guest_name IS NULL AND s.status = 'scheduled' AND s.starts_at > $now AND s.starts_at <= $to`,
    { now: c.now.toISOString(), to: new Date(c.now.getTime() + 24 * 3_600_000).toISOString() },
  );
  const confirmMs = c.studio.settings.confirmBeforeMinutes * 60_000;
  for (const b of rows) {
    const left = Date.parse(b.starts_at) - c.now.getTime();
    const time = localParts(new Date(b.starts_at), c.studio.timezone).time;
    const vars = { time, class: b.class_name, trainer: b.trainer };
    if (left > confirmMs) {
      notify(c.scope, { userId: b.user_id, category: 'transactional', tz: c.studio.timezone, now: c.now, body: TRIGGERS.class_24h.text(vars), action: 'schedule', dedupeKey: `class_24h:${b.id}` });
    } else if (!b.confirmed_at) {
      notify(c.scope, { userId: b.user_id, category: 'transactional', tz: c.studio.timezone, now: c.now, body: TRIGGERS.confirm_2h.text(vars), action: `confirm/${b.id}`, dedupeKey: `confirm_2h:${b.id}` });
    } else {
      notify(c.scope, { userId: b.user_id, category: 'transactional', tz: c.studio.timezone, now: c.now, body: TRIGGERS.class_2h.text(vars), action: 'schedule', dedupeKey: `class_2h:${b.id}` });
    }
  }
}

/** Rezerwacja cykliczna „Pon/Śr 18:00 na stałe” (4.1): zapis, gdy tylko otworzą się zapisy. */
function recurring(c: Ctx) {
  const recs = c.scope.all<{ id: string; user_id: string; template_id: string }>('SELECT id, user_id, template_id FROM recurring_bookings WHERE studio_id = $studio AND active = 1');
  const horizon = new Date(c.now.getTime() + c.studio.policy.opensDaysAhead * 86_400_000).toISOString();
  for (const r of recs) {
    const sessions = c.scope.all<{ id: string; starts_at: string }>(
      `SELECT s.id, s.starts_at FROM class_sessions s WHERE s.studio_id = $studio AND s.template_id = $t AND s.status = 'scheduled' AND s.starts_at > $now AND s.starts_at <= $h
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.session_id = s.id AND b.user_id = $u AND b.guest_name IS NULL AND b.status IN ('booked', 'waitlist', 'attended', 'cancelled', 'late_cancel'))`,
      { t: r.template_id, now: new Date(c.now.getTime() + c.studio.policy.closesMinutesBefore * 60_000).toISOString(), h: horizon, u: r.user_id },
    );
    for (const s of sessions) {
      try {
        bookSession(c.scope, c.studio, r.user_id, s.id, c.now, { source: 'recurring', recurringId: r.id });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'no_pass') {
          notify(c.scope, { userId: r.user_id, category: 'transactional', tz: c.studio.timezone, now: c.now, action: 'passes', dedupeKey: `recurring_nopass:${s.id}`, body: 'Stała rezerwacja czeka, ale karnet się skończył. Przedłużysz, żeby nie stracić miejsca?' });
        }
      }
    }
  }
}

// ——— Karnety ———

function passExpiry(c: Ctx) {
  const rows = c.scope.all<{ id: string; user_id: string; valid_until: string; product_name: string }>(
    "SELECT id, user_id, valid_until, product_name FROM passes WHERE studio_id = $studio AND status = 'active' AND auto_renew = 0 AND valid_until > $now AND valid_until <= $to",
    { now: c.now.toISOString(), to: new Date(c.now.getTime() + 15 * 86_400_000).toISOString() },
  );
  for (const p of rows) {
    const days = Math.ceil((Date.parse(p.valid_until) - c.now.getTime()) / 86_400_000);
    const step = days <= 1 ? 1 : days <= 7 ? 7 : days <= 14 ? 14 : 0;
    if (!step) continue;
    const when = step === 1 ? 'jutro' : step === 7 ? 'za tydzień' : 'za dwa tygodnie';
    notify(c.scope, { userId: p.user_id, category: 'transactional', tz: c.studio.timezone, now: c.now, body: TRIGGERS.pass_expiring.text({ when }), action: 'passes', dedupeKey: `pass_exp:${p.id}:${step}` });
  }
  c.scope.run("UPDATE passes SET status = 'expired' WHERE studio_id = $studio AND status = 'active' AND valid_until < $now", { now: c.now.toISOString() });
}

/** Plan miesięczny z automatycznym odnawianiem (C9): nowy okres pobierany z zapisanej metody płatności. */
async function renewals(c: Ctx) {
  const due = c.scope.all<{ id: string; user_id: string; product_version_id: string | null; product_name: string; rules_json: string; valid_until: string; status: string }>(
    "SELECT * FROM passes WHERE studio_id = $studio AND auto_renew = 1 AND status IN ('active', 'used', 'expired') AND valid_until <= $to",
    { to: new Date(c.now.getTime() + 3_600_000).toISOString() },
  );
  for (const p of due) {
    if (!once(c.scope, `renew:${p.id}`, c.now)) continue;
    // Odnowienie w cenie bieżącej wersji produktu – zmiana cennika dotyczy nowych okresów (C5).
    const product = p.product_version_id
      ? c.scope.get<{ product_id: string; price_grosze: number; rules_json: string; current: string }>(
          'SELECT v.product_id, cv.price_grosze, cv.rules_json, cv.id AS current FROM product_versions v JOIN products pr ON pr.id = v.product_id JOIN product_versions cv ON cv.id = pr.current_version_id WHERE v.studio_id = $studio AND v.id = $v',
          { v: p.product_version_id },
        )
      : undefined;
    if (!product) continue;
    const charge = await c.deps.payments.charge({ amountGrosze: product.price_grosze, method: 'saved', description: `${p.product_name} – odnowienie`, studioId: c.studio.id });
    c.scope.tx(() => {
      c.scope.run('UPDATE passes SET auto_renew = 0 WHERE studio_id = $studio AND id = $id', { id: p.id });
      if (charge.status !== 'paid') {
        notify(c.scope, { userId: p.user_id, category: 'transactional', tz: c.studio.timezone, now: c.now, body: 'Nie udało się odnowić karnetu. Sprawdź płatność w Profilu – miejsce na zajęciach czeka.', action: 'profile/passes' });
        return;
      }
      const rules = JSON.parse(product.rules_json) as ProductRules;
      const start = new Date(Math.max(Date.parse(p.valid_until), c.now.getTime()));
      const v = passValidity(rules, start);
      const passId = issuePass(c.scope, { userId: p.user_id, versionId: product.current, name: p.product_name, rules, balances: initialBalances(rules), validFrom: v.validFrom, validUntil: v.validUntil, source: 'renewal', autoRenew: true });
      recordPayment(c.scope, { userId: p.user_id, kind: 'renewal', ref: passId, amount: product.price_grosze, method: 'saved', providerRef: charge.ref, description: `${p.product_name} – odnowienie` });
      notify(c.scope, { userId: p.user_id, category: 'transactional', tz: c.studio.timezone, now: c.now, body: `${p.product_name} odnowiony. Dziękujemy, że jesteś z nami 💛`, action: 'profile/passes' });
    });
  }
}

/** Zawieszenia: start i koniec okresu, wsparcie po 7 dniach – tylko gdy klientka o nie poprosiła (8.1.4). */
function freezes(c: Ctx) {
  const rows = c.scope.all<{ id: string; pass_id: string; user_id: string; date_from: string; date_to: string; wants_support: number; created_at: string }>(
    'SELECT * FROM pass_freezes WHERE studio_id = $studio AND ended_at IS NULL',
  );
  for (const f of rows) {
    if (f.date_from <= c.today && c.today <= f.date_to) c.scope.run("UPDATE passes SET status = 'frozen', frozen_until = $to WHERE studio_id = $studio AND id = $id AND status = 'active'", { id: f.pass_id, to: f.date_to });
    if (c.today > f.date_to) {
      c.scope.run("UPDATE passes SET status = 'active', frozen_until = NULL WHERE studio_id = $studio AND id = $id AND status = 'frozen'", { id: f.pass_id });
      c.scope.run('UPDATE pass_freezes SET ended_at = $now WHERE studio_id = $studio AND id = $id', { id: f.id, now: c.now.toISOString() });
      notify(c.scope, { userId: f.user_id, category: 'transactional', tz: c.studio.timezone, now: c.now, body: 'Twój karnet znów działa. Witaj z powrotem – zaczynamy spokojnie 🌿', action: 'schedule', dedupeKey: `unfreeze:${f.id}` });
    }
    if (f.wants_support && c.now.getTime() - Date.parse(f.created_at) >= 7 * 86_400_000 && atOrAfter(c, c.studio.settings.greetingsHour)) {
      notify(c.scope, { userId: f.user_id, category: 'occasional', occasion: 'support', tz: c.studio.timezone, now: c.now, body: WISHES.support, dedupeKey: `support:${f.id}` });
    }
  }
}

// ——— Dobrostan i motywacja ———

function wellbeing(c: Ctx) {
  for (const u of clients(c.scope)) {
    const prefs = u.prefs_json ? JSON.parse(u.prefs_json) : {};
    const restDay = c.scope.db.prepare('SELECT rest_day FROM users WHERE id = ?').get(u.id) as { rest_day: string | null };
    if (restDay?.rest_day === c.today) continue; // „Dziś odpoczywam” – znika presja (7.5)
    if (prefs.reminderTime && c.weekday <= 5 && atOrAfter(c, prefs.reminderTime)) {
      notify(c.scope, { userId: u.id, category: 'wellbeing', tz: c.studio.timezone, now: c.now, body: TRIGGERS.morning_ritual.text({ name: u.name ?? '' }).replace(', ☀️', ' ☀️'), action: 'forme', dedupeKey: `ritual:${c.today}` });
    }
    if (Array.isArray(prefs.eveningDays) && prefs.eveningDays.includes(c.weekday) && atOrAfter(c, '20:30')) {
      notify(c.scope, { userId: u.id, category: 'wellbeing', tz: c.studio.timezone, now: c.now, body: TRIGGERS.evening_me_time.text({}), action: 'forme', dedupeKey: `evening:${c.today}` });
    }
    for (const t of (prefs.microBreaks ?? []) as string[]) {
      if (c.weekday <= 5 && atOrAfter(c, t) && c.minutes < toMinutes(t) + 30) {
        notify(c.scope, { userId: u.id, category: 'wellbeing', tz: c.studio.timezone, now: c.now, body: TRIGGERS.micro_break.text({}), action: 'forme', dedupeKey: `micro:${c.today}:${t}` });
      }
    }
    const progress = weekProgress(c.scope, c.studio, u.id, c.now);
    // Piątek 17:00: w tym tygodniu bez zajęć → propozycja medytacji na weekend.
    if (c.weekday === 5 && atOrAfter(c, '17:00') && progress.done.trainings === 0) {
      notify(c.scope, { userId: u.id, category: 'wellbeing', tz: c.studio.timezone, now: c.now, body: TRIGGERS.no_visits_friday.text({}), action: 'forme', dedupeKey: `nv:${weekStart(c.today)}` });
    }
    if (c.weekday === 3 && atOrAfter(c, '18:00') && progress.done.trainings > 0 && progress.done.trainings * 2 >= progress.goal.trainings && progress.done.trainings < progress.goal.trainings) {
      notify(c.scope, { userId: u.id, category: 'motivation', tz: c.studio.timezone, now: c.now, body: TRIGGERS.week_goal_half.text({ done: String(progress.done.trainings), target: String(progress.goal.trainings) }), action: 'start', dedupeKey: `goal_half:${weekStart(c.today)}` });
    }
    if (c.weekday === 7 && atOrAfter(c, '19:00') && progress.achieved) {
      grantBadge(c.scope, u.id, 'week_goal', c.now);
      notify(c.scope, { userId: u.id, category: 'motivation', tz: c.studio.timezone, now: c.now, body: TRIGGERS.week_goal_done.text({}), action: 'profile/badges', dedupeKey: `goal_done:${weekStart(c.today)}` });
    }
    // Seria: sobota, w tym tygodniu jeszcze bez ruchu, a seria trwa ≥ 2 tygodnie – delikatnie, bez presji.
    if (c.weekday === 6 && atOrAfter(c, '10:00') && progress.done.trainings === 0) {
      const weeks = weeklyStreak(progress.visitDates, c.today);
      if (weeks >= 2) {
        notify(c.scope, { userId: u.id, category: 'motivation', tz: c.studio.timezone, now: c.now, body: TRIGGERS.streak.text({ weeks: `${weeks} tygodni` }), action: 'schedule', dedupeKey: `streak:${weekStart(c.today)}` });
      }
    }
  }
}

function challengesStart(c: Ctx) {
  if (c.weekday !== 1 || !atOrAfter(c, '09:00')) return;
  const starting = c.scope.all<{ id: string; title: string }>('SELECT id, title FROM challenges WHERE studio_id = $studio AND starts_on >= $from AND starts_on <= $to', {
    from: c.today,
    to: addDays(c.today, 6),
  });
  for (const ch of starting) {
    if (!once(c.scope, `challenge_start:${ch.id}`, c.now)) continue;
    for (const u of clients(c.scope)) notify(c.scope, { userId: u.id, category: 'community', tz: c.studio.timezone, now: c.now, body: TRIGGERS.new_challenge.text({ title: ch.title }), action: `community/challenge/${ch.id}` });
  }
}

// ——— Motywy (M1) ———

function themes(c: Ctx) {
  const rows = c.scope.all<{ id: string; name: string; tagline: string | null; starts_on: string | null; ends_on: string | null; auto: number; is_active: number; segment: string | null; pack_json: string | null }>(
    'SELECT id, name, tagline, starts_on, ends_on, auto, is_active, segment, pack_json FROM themes WHERE studio_id = $studio',
  );
  const target = scheduledTheme(
    rows.map((t) => ({ id: t.id, startsOn: t.starts_on, endsOn: t.ends_on, auto: !!t.auto, isActive: !!t.is_active, segment: t.segment })),
    c.today,
  );
  const active = rows.find((t) => t.is_active);
  if (target !== (active?.id ?? null) && (!active || active.auto)) {
    c.scope.tx(() => {
      c.scope.run('UPDATE themes SET is_active = 0 WHERE studio_id = $studio AND is_active = 1');
      if (target) c.scope.run('UPDATE themes SET is_active = 1 WHERE studio_id = $studio AND id = $id', { id: target });
    });
  }
  const current = rows.find((t) => t.id === (target ?? active?.id));
  if (!current || !atOrAfter(c, '09:00')) return;
  const pack = current.pack_json ? JSON.parse(current.pack_json) : {};
  if (current.auto && current.starts_on === c.today) {
    for (const u of clients(c.scope)) {
      notify(c.scope, { userId: u.id, category: 'theme', tz: c.studio.timezone, now: c.now, body: TRIGGERS.theme_start.text({ tagline: current.tagline ?? '', name: current.name }), action: 'start', dedupeKey: `theme_start:${current.id}:${c.today}` });
    }
  }
  if (pack.badge && current.ends_on && addDays(current.ends_on, -1) === c.today) {
    for (const u of clients(c.scope)) {
      if (c.scope.get('SELECT 1 FROM user_badges WHERE studio_id = $studio AND user_id = $u AND code = $b', { u: u.id, b: pack.badge })) continue;
      notify(c.scope, { userId: u.id, category: 'theme', tz: c.studio.timezone, now: c.now, body: TRIGGERS.badge_last_chance.text({}), action: 'community', dedupeKey: `badge_last:${current.id}` });
    }
  }
}

// ——— Okolicznościowe (8.1) ———

function occasions(c: Ctx) {
  const g = c.studio.settings.greetings;
  if (!atOrAfter(c, c.studio.settings.greetingsHour)) return;
  const md = c.today.slice(5);
  const all = clients(c.scope);
  for (const u of all) {
    const vars = { imię: u.name ?? '' };
    if (g.birthday && u.birthday === md) {
      const trainer = u.trainer_id ? (c.scope.get<{ name: string; prefs_json: string | null }>("SELECT u.name, m.prefs_json FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.user_id = $t AND m.role = 'trainer'", { t: u.trainer_id })) : undefined;
      const personal = trainer?.prefs_json ? JSON.parse(trainer.prefs_json).birthdayWishes : false;
      const body = personal ? fill(WISHES.birthdayTrainer, { ...vars, trenerka: trainer!.name }) : fill(WISHES.birthday, vars);
      const sent = notify(c.scope, { userId: u.id, category: 'occasional', occasion: 'birthday', tz: c.studio.timezone, now: c.now, body, action: 'profile/gifts', dedupeKey: `birthday:${c.today}` });
      // Jeden delikatny prezent w aplikacji: osobisty kod rabatowy + punkty.
      if (sent?.send && g.birthdayGiftPct > 0) birthdayGift(c, u.id);
      awardPoints(c.scope, c.studio, u.id, 'birthday', c.today.slice(0, 4), c.studio.settings.loyalty.points.birthday, c.now);
    }
    if (g.nameday && u.nameday === md) {
      notify(c.scope, { userId: u.id, category: 'occasional', occasion: 'birthday', tz: c.studio.timezone, now: c.now, body: WISHES.nameday, dedupeKey: `nameday:${c.today}` });
    }
    if (g.anniversary) {
      const first = c.scope.get<{ t: string | null }>(
        "SELECT MIN(s.starts_at) AS t FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND b.user_id = $u AND b.status = 'attended'",
        { u: u.id },
      )?.t;
      if (first && isAnniversary(localParts(new Date(first), c.studio.timezone).date, c.today)) {
        grantBadge(c.scope, u.id, 'anniversary', c.now);
        notify(c.scope, { userId: u.id, category: 'occasional', occasion: 'anniversary', tz: c.studio.timezone, now: c.now, body: WISHES.anniversary, dedupeKey: `anniv:${c.today}` });
      }
    }
    for (const h of holidaysOn(c.today)) {
      if (!g.holidays.includes(h.id) || !atOrAfter(c, h.time)) continue;
      notify(c.scope, { userId: u.id, category: 'occasional', occasion: 'holiday', tz: c.studio.timezone, now: c.now, body: fill(h.body, vars), dedupeKey: `holiday:${h.id}:${c.today}` });
    }
    if (g.studioAnniversary && c.studio.founded_on && c.studio.founded_on.slice(5) === md && c.studio.founded_on < c.today) {
      notify(c.scope, { userId: u.id, category: 'occasional', occasion: 'anniversary', tz: c.studio.timezone, now: c.now, body: WISHES.studioAnniversary, dedupeKey: `studio_anniv:${c.today}` });
    }
  }
}

function birthdayGift(c: Ctx, userId: string) {
  const code = `URODZINY-${userId.slice(-4).toUpperCase()}-${c.today.slice(0, 4)}`;
  c.scope.run(
    `INSERT OR IGNORE INTO coupons (id, studio_id, code, label, kind, value, applies_to, max_uses, per_user, only_user_id, valid_from, valid_to, active, created_at)
     VALUES ($id, $studio, $code, 'Prezent urodzinowy', 'percent', $v, 'all', 1, 1, $u, $from, $to, 1, $now)`,
    { id: id(), code, v: c.studio.settings.greetings.birthdayGiftPct, u: userId, from: c.today, to: addDays(c.today, c.studio.settings.greetings.birthdayGiftDays), now: c.now.toISOString() },
  );
}

// ——— Reaktywacja (4.10) i feedback ———

function dormant(c: Ctx) {
  const cfg = c.studio.settings.dormant;
  if (!atOrAfter(c, '10:00')) return;
  const rows = c.scope.all<{ user_id: string; last: string | null; upcoming: number }>(
    `SELECT m.user_id,
            (SELECT MAX(s.starts_at) FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND b.user_id = m.user_id AND b.status = 'attended') AS last,
            (SELECT COUNT(*) FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND b.user_id = m.user_id AND b.status IN ('booked', 'waitlist') AND s.starts_at > $now) AS upcoming
     FROM memberships m WHERE m.studio_id = $studio AND m.role = 'client'`,
    { now: c.now.toISOString() },
  );
  for (const r of rows) {
    if (!r.last || r.upcoming > 0) continue;
    const frozen = c.scope.get("SELECT 1 FROM passes WHERE studio_id = $studio AND user_id = $u AND status = 'frozen'", { u: r.user_id });
    if (frozen) continue; // zawieszony karnet = świadoma przerwa, nie pytamy
    const days = (c.now.getTime() - Date.parse(r.last)) / 86_400_000;
    const period = r.last.slice(0, 10);
    if (days >= cfg.surveyAfterDays && days < cfg.offerAfterDays) {
      const created = c.scope.run(
        `INSERT INTO dormant_surveys (id, studio_id, user_id, status, created_at)
         SELECT $id, $studio, $u, 'sent', $now WHERE NOT EXISTS (SELECT 1 FROM dormant_surveys WHERE studio_id = $studio AND user_id = $u AND created_at > $last)`,
        { id: id(), u: r.user_id, now: c.now.toISOString(), last: r.last },
      );
      if (created.changes) notify(c.scope, { userId: r.user_id, category: 'reactivation', tz: c.studio.timezone, now: c.now, body: TRIGGERS.dormant_survey.text({}), action: 'survey/dormant', dedupeKey: `dormant:${period}` });
    }
    if (days >= cfg.offerAfterDays && days < cfg.offerAfterDays + 30 && cfg.offerPercent > 0) {
      const code = `WRACAM-${r.user_id.slice(-4).toUpperCase()}-${period.replace(/-/g, '').slice(2)}`;
      const created = c.scope.run(
        `INSERT OR IGNORE INTO coupons (id, studio_id, code, label, kind, value, applies_to, max_uses, per_user, only_user_id, valid_from, valid_to, active, created_at)
         VALUES ($id, $studio, $code, 'Powrót po przerwie', 'percent', $v, 'pass', 1, 1, $u, $from, $to, 1, $now)`,
        { id: id(), code, v: cfg.offerPercent, u: r.user_id, from: c.today, to: addDays(c.today, 30), now: c.now.toISOString() },
      );
      if (created.changes) notify(c.scope, { userId: r.user_id, category: 'reactivation', tz: c.studio.timezone, now: c.now, body: TRIGGERS.reactivation.text({ percent: String(cfg.offerPercent), code }), action: 'passes', dedupeKey: `reactivation:${period}` });
    }
  }
}

/** NPS po pierwszym miesiącu (4.9) i kartka od trenerki po pierwszym miesiącu (4.12.1). */
function firstMonth(c: Ctx) {
  const rows = c.scope.all<{ user_id: string; trainer_id: string | null; first: string }>(
    `SELECT b.user_id, m.trainer_id, MIN(s.starts_at) AS first FROM bookings b JOIN class_sessions s ON s.id = b.session_id
     JOIN memberships m ON m.studio_id = b.studio_id AND m.user_id = b.user_id AND m.role = 'client'
     WHERE b.studio_id = $studio AND b.status = 'attended' AND b.guest_name IS NULL GROUP BY b.user_id`,
  );
  for (const r of rows) {
    const days = (c.now.getTime() - Date.parse(r.first)) / 86_400_000;
    if (days < 30) continue;
    if (c.studio.settings.nps.afterFirstMonth) {
      c.scope.run("INSERT OR IGNORE INTO nps_responses (id, studio_id, user_id, trigger, created_at) VALUES ($id, $studio, $u, 'first_month', $now)", { id: id(), u: r.user_id, now: c.now.toISOString() });
    }
    if (c.studio.settings.cards.enabled && days < 120) {
      // Trenerka: przypisana albo ta, u której klientka była najczęściej.
      const trainer =
        r.trainer_id ??
        c.scope.get<{ t: string }>(
          "SELECT s.trainer_id AS t FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND b.user_id = $u AND b.status = 'attended' GROUP BY s.trainer_id ORDER BY COUNT(*) DESC LIMIT 1",
          { u: r.user_id },
        )?.t ??
        null;
      const hasAddress = !!(c.scope.db.prepare('SELECT address_enc FROM users WHERE id = ?').get(r.user_id) as { address_enc: string | null }).address_enc;
      c.scope.run(
        `INSERT OR IGNORE INTO card_tasks (id, studio_id, trainer_id, client_id, due_on, delivery, status, created_at, updated_at)
         VALUES ($id, $studio, $t, $u, $due, $del, 'todo', $now, $now)`,
        { id: id(), t: trainer, u: r.user_id, due: addDays(localParts(new Date(r.first), c.studio.timezone).date, c.studio.settings.cards.afterDays), del: hasAddress ? 'post' : 'pickup', now: c.now.toISOString() },
      );
    }
  }
}

// ——— Kursy ———

function courses(c: Ctx) {
  const rows = c.scope.all<{ user_id: string; course_id: string; started_at: string; expires_at: string | null; title: string; drip_days: number }>(
    `SELECT e.user_id, e.course_id, e.started_at, e.expires_at, co.title, co.drip_days FROM course_enrollments e JOIN courses co ON co.id = e.course_id
     WHERE e.studio_id = $studio AND co.status = 'published' AND e.completed_at IS NULL`,
  );
  for (const e of rows) {
    const lessons = c.scope.all<{ id: string; unlock_day: number; free_preview: number; duration_sec: number; sort: number; live_at: string | null; title: string }>(
      'SELECT id, unlock_day, free_preview, duration_sec, sort, live_at, title FROM course_lessons WHERE studio_id = $studio AND course_id = $c ORDER BY sort',
      { c: e.course_id },
    );
    lessons.forEach((l, i) => {
      const lesson = { id: l.id, unlockDay: l.unlock_day, freePreview: !!l.free_preview, durationSec: l.duration_sec, sort: l.sort };
      const before = lessonUnlocked(lesson, e.started_at, new Date(c.now.getTime() - 86_400_000), e.drip_days, i);
      if (i > 0 && !before && lessonUnlocked(lesson, e.started_at, c.now, e.drip_days, i)) {
        notify(c.scope, { userId: e.user_id, category: 'courses', tz: c.studio.timezone, now: c.now, body: TRIGGERS.course_lesson.text({ course: e.title }), action: `course/${e.course_id}`, dedupeKey: `lesson:${l.id}` });
      }
      if (l.live_at) {
        const left = Date.parse(l.live_at) - c.now.getTime();
        if (left > 0 && left <= 3_600_000) notify(c.scope, { userId: e.user_id, category: 'courses', tz: c.studio.timezone, now: c.now, body: `Za godzinę live: „${l.title}”. Pytania możesz zadać na żywo 🎬`, action: `course/${e.course_id}`, dedupeKey: `live:${l.id}` });
      }
    });
    if (e.expires_at) {
      const left = (Date.parse(e.expires_at) - c.now.getTime()) / 86_400_000;
      if (left > 0 && left <= 3) notify(c.scope, { userId: e.user_id, category: 'courses', tz: c.studio.timezone, now: c.now, body: TRIGGERS.course_ending.text({ course: e.title }), action: `course/${e.course_id}`, dedupeKey: `course_end:${e.course_id}` });
    }
  }
}

// ——— Powitania (6, decyzja 3): przypomnienia dla trenerki, powitanie zapasowe od studia, publikacja zaplanowanych ———

function welcomes(c: Ctx) {
  c.scope
    .all<{ id: string; client_id: string }>("SELECT id, client_id FROM welcome_messages WHERE studio_id = $studio AND status = 'scheduled' AND publish_at <= $now", { now: c.now.toISOString() })
    .forEach((w) => {
      c.scope.run("UPDATE welcome_messages SET status = 'published' WHERE studio_id = $studio AND id = $id", { id: w.id });
      notify(c.scope, { userId: w.client_id, category: 'courses', tz: c.studio.timezone, now: c.now, body: TRIGGERS.trainer_message.text({}), action: 'start' });
    });

  // Pierwsze zajęcia nowych klientek w najbliższych 48 h, a powitania od trenerki brak.
  const firsts = c.scope.all<{ user_id: string; name: string | null; trainer_id: string; starts_at: string }>(
    `SELECT b.user_id, u.name, s.trainer_id, s.starts_at FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN users u ON u.id = b.user_id
     WHERE b.studio_id = $studio AND b.status = 'booked' AND b.guest_name IS NULL AND s.starts_at > $now AND s.starts_at <= $to
       AND NOT EXISTS (SELECT 1 FROM bookings p WHERE p.studio_id = $studio AND p.user_id = b.user_id AND p.status = 'attended')
       AND NOT EXISTS (SELECT 1 FROM welcome_messages w WHERE w.studio_id = $studio AND w.client_id = b.user_id AND w.kind = 'trainer')`,
    { now: c.now.toISOString(), to: new Date(c.now.getTime() + 48 * 3_600_000).toISOString() },
  );
  const fb = c.studio.settings.fallbackWelcome;
  for (const f of firsts) {
    const hours = (Date.parse(f.starts_at) - c.now.getTime()) / 3_600_000;
    const who = f.name ?? 'nowej klientki';
    if (hours <= 48 && hours > 24) notify(c.scope, { userId: f.trainer_id, category: 'courses', tz: c.studio.timezone, now: c.now, body: `Napisz powitanie dla: ${who}. Pierwsze zajęcia za mniej niż 2 dni.`, action: 'staff/welcomes', dedupeKey: `welcome48:${f.user_id}` });
    if (hours <= 24 && hours > fb.hoursBefore) notify(c.scope, { userId: f.trainer_id, category: 'courses', tz: c.studio.timezone, now: c.now, body: `Przypomnienie: powitanie dla: ${who}. Pierwsze zajęcia jutro.`, action: 'staff/welcomes', dedupeKey: `welcome24:${f.user_id}` });
    if (fb.enabled && hours <= fb.hoursBefore) {
      // Powitanie zapasowe podpisane „Od studia” – nie udajemy osobistego kontaktu (6.6).
      const r = c.scope.run(
        `INSERT OR IGNORE INTO welcome_messages (id, studio_id, trainer_id, client_id, kind, body, status, created_at)
         VALUES ($id, $studio, NULL, $c, 'studio', $body, 'published', $now)`,
        { id: id(), c: f.user_id, body: fill(fb.body, { imię: f.name ?? '' }), now: c.now.toISOString() },
      );
      if (r.changes) notify(c.scope, { userId: f.user_id, category: 'courses', tz: c.studio.timezone, now: c.now, body: 'Mamy dla Ciebie kilka słów przed pierwszymi zajęciami 💛', action: 'start' });
    }
  }
}

// ——— Sklep, wydarzenia, wejściówki ———

function shopAndPasses(c: Ctx) {
  const expired = c.scope.all<{ id: string; items_json: string }>("SELECT id, items_json FROM shop_orders WHERE studio_id = $studio AND status IN ('reserved', 'ready') AND kind = 'pickup' AND expires_at < $today", { today: c.today });
  for (const o of expired) {
    c.scope.tx(() => {
      for (const it of JSON.parse(o.items_json) as { productId: string; variantId: string; qty: number }[]) {
        const p = c.scope.get<{ variants_json: string }>('SELECT variants_json FROM shop_products WHERE studio_id = $studio AND id = $id', { id: it.productId });
        if (!p) continue;
        const variants = (JSON.parse(p.variants_json) as { id: string; stock: number }[]).map((v) => (v.id === it.variantId ? { ...v, stock: v.stock + it.qty } : v));
        c.scope.run("UPDATE shop_products SET variants_json = $v, status = CASE WHEN status = 'sold_out' THEN 'available' ELSE status END WHERE studio_id = $studio AND id = $id", { v: JSON.stringify(variants), id: it.productId });
      }
      c.scope.run("UPDATE shop_orders SET status = 'expired', updated_at = $now WHERE studio_id = $studio AND id = $id", { id: o.id, now: c.now.toISOString() });
    });
  }
  c.scope.run("UPDATE guest_passes SET status = 'expired' WHERE studio_id = $studio AND status = 'sent' AND expires_at < $now", { now: c.now.toISOString() });
}

function privateEvents(c: Ctx) {
  const rows = c.scope.all<{ id: string; client_id: string; kind: string; starts_at: string; ends_at: string; status: string }>(
    "SELECT id, client_id, kind, starts_at, ends_at, status FROM private_events WHERE studio_id = $studio AND status IN ('confirmed', 'paid', 'offer')",
  );
  for (const e of rows) {
    const eventDay = localParts(new Date(e.starts_at), c.studio.timezone).date;
    if (addDays(eventDay, -1) === c.today && atOrAfter(c, '18:00') && e.status !== 'offer') {
      const what = e.kind === 'birthday' ? 'Twoje urodziny' : 'Twoje wydarzenie';
      notify(c.scope, { userId: e.client_id, category: 'events', tz: c.studio.timezone, now: c.now, body: TRIGGERS.event_tomorrow.text({ what }), action: `event/${e.id}`, dedupeKey: `event_tomorrow:${e.id}` });
    }
    if (Date.parse(e.ends_at) < c.now.getTime() && e.status !== 'offer') {
      c.scope.run("UPDATE private_events SET status = 'done', updated_at = $now WHERE studio_id = $studio AND id = $id", { id: e.id, now: c.now.toISOString() });
      grantBadge(c.scope, e.client_id, 'event', c.now);
      notify(c.scope, { userId: e.client_id, category: 'events', tz: c.studio.timezone, now: c.now, body: 'Dziękujemy za wspólne świętowanie 💛 Odznaka „Wydarzeniowa” czeka w profilu.', action: 'profile/badges', dedupeKey: `event_done:${e.id}` });
    }
  }
  // RODO: dane gości usuwamy dzień po wydarzeniu (4.13.6).
  c.scope.run(
    "DELETE FROM event_guests WHERE studio_id = $studio AND event_id IN (SELECT id FROM private_events WHERE studio_id = $studio AND status IN ('done', 'cancelled') AND ends_at < $cut)",
    { cut: new Date(c.now.getTime() - 86_400_000).toISOString() },
  );
}

/** Zaplanowane kampanie (4.11) – wysyłka o czasie. */
function campaigns(c: Ctx) {
  const due = c.scope.all<{ id: string }>("SELECT id FROM campaigns WHERE studio_id = $studio AND status = 'scheduled' AND scheduled_at <= $now", { now: c.now.toISOString() });
  for (const x of due) sendCampaignHook?.(c.scope, c.studio, x.id, c.now);
}

let sendCampaignHook: ((scope: StudioScope, studio: Studio, campaignId: string, now: Date) => void) | null = null;
export const registerCampaignSender = (fn: typeof sendCampaignHook) => {
  sendCampaignHook = fn;
};

const JOBS = [autofill, closeSessions, classReminders, recurring, passExpiry, freezes, wellbeing, challengesStart, themes, occasions, dormant, firstMonth, courses, welcomes, shopAndPasses, privateEvents, campaigns];

// ——— Platforma: okres próbny, kopie zapasowe ———

function platformJobs(db: Db, now: Date) {
  // Koniec okresu próbnego bez opłaconego abonamentu → studio zawieszone (personel nadal wchodzi do panelu).
  db.prepare("UPDATE studios SET status = 'suspended' WHERE status = 'trial' AND trial_ends_at < ?").run(now.toISOString());
}

