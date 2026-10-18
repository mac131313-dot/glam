// Dane demo: dwa studia (izolacja), klientka Magda w obu, produkty z tabeli 1.1.4,
// historia wizyt (pulpit, segmenty uśpionych), pełne zajęcia (lista oczekujących).
import { existsSync, rmSync } from 'node:fs';
import { initialBalances, localParts, passValidity, type ProductRules } from '@glam/core';
import { DB_FILE, openDb, type Db } from './db.ts';
import { backup } from './services/dispatch.ts';
import { seedExtras } from './seed-extras.ts';
import { SSG, SSG_STUDIO, seedSsg } from './seed-ssg.ts';
import { StudioScope } from './scope.ts';
import { bookSession } from './services/booking.ts';
import { consumeEntry, loadPass } from './services/passes.ts';
import { fillSchedule } from './services/schedule.ts';
import { loadStudio } from './services/studio.ts';

const DAY = 86_400_000;

export const DEMO = {
  owner: '+48500000001',
  marzena: '+48500000002',
  ola: '+48500000003',
  reception: '+48500000004',
  magda: '+48500000005',
  ania: '+48500000006',
  krakowOwner: '+48500000007',
  iza: '+48500000008',
  platformAdmin: '+48500000009',
  zuza: '+48500000010',
};

export function seed(db: Db, now = new Date()) {
  const iso = (d: Date) => d.toISOString();
  const users = new Map<string, string>();
  const user = (phone: string, name: string, extra: { birthday?: string } = {}) => {
    const id = `u_${phone.slice(-3)}`;
    db.prepare('INSERT INTO users (id, phone, name, birthday, created_at) VALUES (?, ?, ?, ?, ?)').run(id, phone, name, extra.birthday ?? null, iso(new Date(now.getTime() - 60 * DAY)));
    users.set(phone, id);
    return id;
  };
  const member = (studio: string, userId: string, role: string, joinedDaysAgo = 50, extra: { bio?: string; goal?: string } = {}) =>
    db
      .prepare('INSERT INTO memberships (studio_id, user_id, role, bio, goal, joined_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(studio, userId, role, extra.bio ?? null, extra.goal ?? null, iso(new Date(now.getTime() - joinedDaysAgo * DAY)));

  // ——— Studio 1: obiekt z siłownią, stretchingiem i salą pilates (przykład z 1.1.4) ———
  const R = 'st_rzeszow';
  db.prepare(
    `INSERT INTO studios (id, name, slug, invite_code, city, tagline, accent, look_json, logo, phone, policy_json, guest_pass_price, welcome_approval, created_at)
     VALUES (?, 'Centrum Ruchu', 'centrum-ruchu', 'RUCH24', 'Rzeszów', 'Pilates, stretch i siłownia', '#9b8570', ?, 'C', '+48 17 000 00 00', ?, 4900, 0, ?)`,
  ).run(R, JSON.stringify({ palette: 'biel', fonts: { display: 'cormorant', head: 'outfit', body: 'rethink' }, softness: 'softer' }), JSON.stringify({ opensDaysAhead: 14, closesMinutesBefore: 120, cancelMinutesBefore: 120, waitlist: true }), iso(now));

  const owner = user(DEMO.owner, 'Joanna');
  const marzena = user(DEMO.marzena, 'Marzena');
  const ola = user(DEMO.ola, 'Ola');
  const kasia = user(DEMO.reception, 'Kasia');
  const magda = user(DEMO.magda, 'Magda', { birthday: '03-14' });
  const ania = user(DEMO.ania, 'Ania');
  user(DEMO.platformAdmin, 'Zespół GLAM');

  member(R, owner, 'owner', 400);
  member(R, marzena, 'trainer', 300, { bio: 'Reformer i mat. Spokojnie, technicznie, z uśmiechem 🌿' });
  member(R, ola, 'trainer', 200, { bio: 'Stretch i mobilność. Kocham poranne zajęcia ☀️' });
  member(R, kasia, 'reception', 200);
  member(R, magda, 'client', 45, { goal: 'Silny kręgosłup i chwila dla siebie' });
  member(R, ania, 'client', 3, { goal: 'Wrócić do ruchu po przerwie' });

  db.prepare("INSERT INTO facilities (id, studio_id, name, address) VALUES ('f_rz', ?, 'Centrum Ruchu Rzeszów', 'ul. Słoneczna 7, Rzeszów')").run(R);
  const zone = db.prepare("INSERT INTO zones (id, studio_id, facility_id, name, access) VALUES (?, ?, 'f_rz', ?, ?)");
  zone.run('z_gym', R, 'Siłownia', 'checkin');
  zone.run('z_stretch', R, 'Sala stretchingu', 'reserved');
  zone.run('z_pilates', R, 'Sala Pilates', 'reserved');

  const ct = db.prepare('INSERT INTO class_types (id, studio_id, zone_id, name, level, color, description) VALUES (?, ?, ?, ?, ?, ?, ?)');
  ct.run('ct_reformer', R, 'z_pilates', 'Reformer', 'wszystkie poziomy', '#e8b4c4', 'Pilates na maszynie Reformer – siła głębokich mięśni i kontrola.');
  ct.run('ct_mat', R, 'z_pilates', 'Mat', 'początkujące', '#cfc3ea', 'Pilates na macie. Wystarczy wygodny strój.');
  ct.run('ct_stretch', R, 'z_stretch', 'Stretch', 'wszystkie poziomy', '#bfd8c2', 'Rozciąganie i oddech – regeneracja po pracy.');
  ct.run('ct_pt', R, 'z_gym', 'Trening z trenerką na siłowni', 'średnie', '#f2d3a7', 'Mała grupa, technika ćwiczeń z obciążeniem.');

  const tpl = db.prepare(
    "INSERT INTO schedule_templates (id, studio_id, class_type_id, trainer_id, weekday, start_time, duration_min, capacity, valid_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01')",
  );
  const T: [string, string, string, number, string, number, number][] = [
    ['t1', 'ct_reformer', marzena, 1, '18:00', 55, 8],
    ['t2', 'ct_reformer', marzena, 3, '18:00', 55, 8],
    ['t3', 'ct_reformer', ola, 2, '07:30', 50, 8],
    ['t4', 'ct_reformer', ola, 4, '07:30', 50, 6],
    ['t5', 'ct_mat', ola, 2, '18:30', 55, 12],
    ['t6', 'ct_mat', ola, 4, '18:30', 55, 12],
    ['t7', 'ct_mat', marzena, 6, '10:00', 55, 12],
    ['t8', 'ct_stretch', ola, 1, '19:15', 45, 10],
    ['t9', 'ct_stretch', ola, 3, '19:15', 45, 10],
    ['t10', 'ct_stretch', marzena, 5, '17:30', 45, 10],
    ['t11', 'ct_stretch', marzena, 7, '10:30', 60, 10],
    ['t12', 'ct_pt', marzena, 2, '17:00', 50, 4],
    ['t13', 'ct_reformer', marzena, 5, '08:00', 55, 8],
    ['t14', 'ct_mat', ola, 3, '12:15', 30, 10],
  ];
  for (const [id, c, tr, wd, time, dur, cap] of T) tpl.run(id, R, c, tr, wd, time, dur, cap);

  // Produkty z tabeli 1.1.4
  const product = (studio: string, id: string, name: string, price: number, rules: ProductRules, desc: string, sort: number) => {
    db.prepare('INSERT INTO products (id, studio_id, name, description, current_version_id, published, sort) VALUES (?, ?, ?, ?, ?, 1, ?)').run(id, studio, name, desc, `${id}_v1`, sort);
    db.prepare('INSERT INTO product_versions (id, studio_id, product_id, version, price_grosze, rules_json, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)').run(
      `${id}_v1`,
      studio,
      id,
      price,
      JSON.stringify(rules),
      iso(new Date(now.getTime() - 120 * DAY)),
    );
  };
  const GROUP = ['ct_reformer', 'ct_mat', 'ct_stretch'];
  product(R, 'pr_start', 'Pierwsze 3 zajęcia', 9900, { validityDays: 30, introOnly: true, pools: [{ id: 'all', label: 'Zajęcia', entries: 3, classTypeIds: GROUP }] }, 'Pakiet startowy – spróbuj wszystkiego.', 1);
  product(R, 'pr_p4', 'Pilates 4 zajęcia', 26000, { validityDays: 30, pools: [{ id: 'p', label: 'Pilates', entries: 4, classTypeIds: ['ct_reformer', 'ct_mat'] }] }, 'Lekkie tempo: raz w tygodniu.', 2);
  product(R, 'pr_r9', 'Pilates Reformer 9', 52000, { validityDays: 90, pools: [{ id: 'r', label: 'Reformer', entries: 9, classTypeIds: ['ct_reformer'] }] }, 'Rozwój na Reformerze.', 3);
  product(R, 'pr_mix8', 'Mix 8', 40000, { validityDays: 30, weeklyLimit: 3, billing: 'once', pools: [{ id: 'mix', label: 'Mix', entries: 8, classTypeIds: GROUP }] }, 'Różnorodność: dowolne zajęcia grupowe. Płatność raz, bez odnowienia.', 4);
  product(R, 'pr_gym', 'Siłownia miesięczna', 14900, { validityDays: 30, unlimited: { zoneIds: ['z_gym'], classTypeIds: 'all' }, window: { weekdays: [1, 2, 3, 4, 5, 6, 7], from: '06:00', to: '22:00' } }, 'Trening samodzielny, wejście z QR.', 5);
  product(R, 'pr_pro', 'Stretch + Siłownia Pro', 22900, { validityDays: 30, unlimited: { zoneIds: ['z_gym', 'z_stretch'], classTypeIds: 'all' } }, 'Regeneracja i siła bez limitu.', 6);
  const membership = { weeklyLimit: 3, unlimited: { zoneIds: 'all' as const, classTypeIds: GROUP } };
  product(R, 'pr_sub_year', 'Pakiet zajęć · rok', 159900, { ...membership, validityDays: 365, autoRenew: true, billing: 'year' }, 'Zajęcia grupowe, do 3 w tygodniu. Odnawia się co rok.', 7);
  product(R, 'pr_sub_week', 'Pakiet zajęć · tydzień', 7900, { ...membership, validityDays: 7, autoRenew: true, billing: 'week' }, 'To samo na jeden tydzień. Odnawia się co tydzień.', 8);

  // ——— Studio 2: osobny najemca – Magda ma tu osobny karnet i historię ———
  const K = 'st_krakow';
  db.prepare(
    `INSERT INTO studios (id, name, slug, invite_code, city, tagline, accent, look_json, logo, phone, policy_json, guest_pass_price, welcome_approval, created_at)
     VALUES (?, 'Flow Pilates', 'flow-pilates', 'FLOW77', 'Kraków', 'Butikowe studio pilates na Kazimierzu', '#b1a497', ?, 'F', '+48 12 000 00 00', ?, 5900, 1, ?)`,
  ).run(K, JSON.stringify({ palette: 'unbound', fonts: { display: 'bodoni', head: 'urbanist', body: 'dmsans' }, softness: 'softest' }), JSON.stringify({ opensDaysAhead: 21, closesMinutesBefore: 60, cancelMinutesBefore: 720, waitlist: true }), iso(now));
  const beata = user(DEMO.krakowOwner, 'Beata');
  const iza = user(DEMO.iza, 'Iza');
  member(K, beata, 'owner', 500);
  member(K, iza, 'trainer', 300, { bio: 'Reformer flow i oddech 🌸' });
  member(K, magda, 'client', 20);
  db.prepare("INSERT INTO facilities (id, studio_id, name) VALUES ('f_kr', ?, 'Flow Pilates Kazimierz')").run(K);
  db.prepare("INSERT INTO zones (id, studio_id, facility_id, name, access) VALUES ('z_kr_sala', ?, 'f_kr', 'Sala główna', 'reserved')").run(K);
  ct.run('ct_kr_flow', K, 'z_kr_sala', 'Reformer Flow', 'średnie', '#cdc8f0', 'Płynne sekwencje na Reformerze.');
  ct.run('ct_kr_mat', K, 'z_kr_sala', 'Mat & Breath', 'początkujące', '#f0d6e2', 'Mata i oddech.');
  for (const [id, c, wd, time] of [['k1', 'ct_kr_flow', 1, '19:00'], ['k2', 'ct_kr_flow', 4, '19:00'], ['k3', 'ct_kr_mat', 6, '09:30'], ['k4', 'ct_kr_mat', 3, '08:00']] as const) {
    tpl.run(id, K, c, iza, wd, time, 55, 6);
  }
  product(K, 'pr_kr4', 'Karnet 4', 32000, { validityDays: 45, pools: [{ id: 'a', label: 'Zajęcia', entries: 4, classTypeIds: 'all' }] }, 'Cztery wejścia na dowolne zajęcia.', 1);
  product(K, 'pr_kr10', 'Karnet 10', 69000, { validityDays: 90, pools: [{ id: 'a', label: 'Zajęcia', entries: 10, classTypeIds: 'all' }] }, 'Dla regularnych.', 2);

  // ——— Grafik: 35 dni wstecz (historia) + 28 dni do przodu ———
  const scopeR = new StudioScope(db, R);
  const scopeK = new StudioScope(db, K);
  const studioR = loadStudio(db, R);
  const studioK = loadStudio(db, K);
  fillSchedule(scopeR, studioR, new Date(now.getTime() - 35 * DAY), 63);
  fillSchedule(scopeK, studioK, new Date(now.getTime() - 10 * DAY), 38);

  const buy = (studio: string, userId: string, productId: string, daysAgo: number, method = 'blik') => {
    const v = db.prepare('SELECT v.* FROM products p JOIN product_versions v ON v.id = p.current_version_id WHERE p.id = ?').get(productId) as {
      id: string;
      price_grosze: number;
      rules_json: string;
    };
    const name = (db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as { name: string }).name;
    const rules = JSON.parse(v.rules_json) as ProductRules;
    const bought = new Date(now.getTime() - daysAgo * DAY);
    const val = passValidity(rules, bought);
    const passId = `pass_${userId}_${productId}`;
    db.prepare(
      `INSERT INTO passes (id, studio_id, user_id, product_version_id, product_name, rules_json, balances_json, valid_from, valid_until, status, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'purchase', ?)`,
    ).run(passId, studio, userId, v.id, name, v.rules_json, JSON.stringify(initialBalances(rules)), val.validFrom, val.validUntil, iso(bought));
    db.prepare("INSERT INTO payments (id, studio_id, user_id, kind, reference_id, amount_grosze, method, status, description, created_at) VALUES (?, ?, ?, 'pass', ?, ?, ?, 'paid', ?, ?)").run(
      `pay_${passId}`,
      studio,
      userId,
      passId,
      v.price_grosze,
      method,
      name,
      iso(bought),
    );
    return passId;
  };

  /** Historia: obecność na minionych zajęciach danego typu (zdejmuje wejścia z karnetu). */
  const attendPast = (scope: StudioScope, userId: string, passId: string, classTypeId: string, count: number, maxDaysAgo = 30, minDaysAgo = 0) => {
    const past = scope.all<{ id: string }>(
      'SELECT id FROM class_sessions WHERE studio_id = $studio AND class_type_id = $ct AND starts_at < $max AND starts_at > $min ORDER BY starts_at DESC',
      { ct: classTypeId, max: iso(new Date(now.getTime() - minDaysAgo * DAY)), min: iso(new Date(now.getTime() - maxDaysAgo * DAY)) },
    );
    for (const s of past.slice(0, count)) {
      const pass = loadPass(scope, passId)!;
      const poolId = Object.keys(pass.balances)[0] ?? null;
      scope.run(
        "INSERT INTO bookings (id, studio_id, session_id, user_id, pass_id, pool_id, status, created_at, updated_at) VALUES ($id, $studio, $s, $u, $p, $pool, 'attended', $t, $t)",
        { id: crypto.randomUUID(), s: s.id, u: userId, p: passId, pool: pass.rules.unlimited ? null : poolId, t: iso(now) },
      );
      if (!pass.rules.unlimited) consumeEntry(scope, pass, poolId);
    }
  };

  const upcoming = (scope: StudioScope, classTypeId: string, weekday: number, minHoursAhead = 3) =>
    scope
      .all<{ id: string; starts_at: string }>(
        "SELECT id, starts_at FROM class_sessions WHERE studio_id = $studio AND class_type_id = $ct AND status = 'scheduled' AND starts_at > $min ORDER BY starts_at",
        { ct: classTypeId, min: iso(new Date(now.getTime() + minHoursAhead * 3_600_000)) },
      )
      .find((s) => localParts(new Date(s.starts_at)).weekday === weekday)!;

  // Magda: Reformer 9 (5 wizyt za nią), w Krakowie osobny Karnet 4.
  const magdaR9 = buy(R, magda, 'pr_r9', 40);
  attendPast(scopeR, magda, magdaR9, 'ct_reformer', 5);
  const magdaKr = buy(K, magda, 'pr_kr4', 9, 'apple_pay');
  attendPast(scopeK, magda, magdaKr, 'ct_kr_flow', 1, 10);

  // Ania: nowa, pakiet startowy.
  buy(R, ania, 'pr_start', 2, 'p24');

  // Pozostałe klientki – aktywne i uśpione (segmenty 7/14/30).
  const others = ['Ewa', 'Natalia', 'Zosia', 'Karolina', 'Weronika', 'Julia', 'Paulina', 'Marta', 'Iga', 'Basia', 'Lena', 'Hania'];
  const otherIds = others.map((name, i) => {
    const uid = user(`+48500000${String(101 + i)}`, name);
    member(R, uid, 'client', 20 + i * 4);
    return uid;
  });
  otherIds.forEach((uid, i) => {
    const pro = i % 3 === 0;
    const pass = buy(R, uid, pro ? 'pr_pro' : 'pr_mix8', i < 9 ? 6 + i : 28, i % 2 ? 'card' : 'blik');
    if (i < 9) attendPast(scopeR, uid, pass, pro ? 'ct_stretch' : 'ct_mat', 2, 6);
    // Uśpione: jedna wizyta sprzed ~3–5 tygodni i nic potem (segmenty 14/30 dni).
    else attendPast(scopeR, uid, pass, pro ? 'ct_stretch' : 'ct_reformer', 1, 26, 8 + (i - 9) * 6);
  });

  const tryBook = (uid: string, sessionId: string, at = now) => {
    try {
      bookSession(scopeR, studioR, uid, sessionId, at);
    } catch (err) {
      console.warn(`seed: pominięto rezerwację (${(err as Error).message})`);
    }
  };
  const mixHolders = otherIds.filter((_, i) => i % 3 !== 0 && i < 9); // 6 osób z Mix 8

  // Najbliższe zajęcia: Magda i Ania na środowym Reformerze u Marzeny.
  const wedReformer = upcoming(scopeR, 'ct_reformer', 3);
  for (const uid of [magda, ania, ...mixHolders.slice(0, 2)]) tryBook(uid, wedReformer.id);
  // Czwartkowy poranny Reformer (6 miejsc) pełny → Magda może sprawdzić listę oczekujących.
  const thuReformer = upcoming(scopeR, 'ct_reformer', 4);
  for (const uid of mixHolders) tryBook(uid, thuReformer.id);
  // Dzisiejsze zajęcia dla panelu trenerki / recepcji.
  const todayLocal = localParts(now).date;
  const todays = scopeR.all<{ id: string; starts_at: string }>(
    "SELECT id, starts_at FROM class_sessions WHERE studio_id = $studio AND status = 'scheduled' AND starts_at > $now ORDER BY starts_at",
    { now: iso(now) },
  ).filter((s) => localParts(new Date(s.starts_at)).date === todayLocal);
  for (const s of todays) {
    for (const uid of otherIds.slice(3, 7)) {
      // karnet „Pro” nie obejmuje pilatesu – takie próby po prostu się nie udadzą
      try {
        bookSession(scopeR, studioR, uid, s.id, new Date(Date.parse(s.starts_at) - 4 * 3_600_000));
      } catch {}
    }
  }

  // Powitanie od Marzeny dla Magdy (nieprzeczytane → popup). Ania czeka na powitanie (P6).
  db.prepare("INSERT INTO welcome_messages (id, studio_id, trainer_id, client_id, body, status, created_at) VALUES ('w1', ?, ?, ?, ?, 'published', ?)").run(
    R,
    marzena,
    magda,
    'Hej Magda! 💛 Cieszę się, że jesteś z nami. W środę o 18:00 Reformer – wystarczy woda i skarpetki antypoślizgowe. Jeśli coś Cię stresuje, napisz, odpiszę tego samego dnia. Do zobaczenia ✨',
    iso(now),
  );

  // Profil trenerki: opis własny i zaproszenie na najbliższe zajęcia (strona WWW, aplikacja).
  db.prepare("UPDATE memberships SET about = ? WHERE studio_id = ? AND user_id = ? AND role = 'trainer'").run(
    'Uczę pilatesu od ośmiu lat. Zaczynałam od rehabilitacji po kontuzji kolana – dlatego tak pilnuję techniki i tempa.\n\nNa moich zajęciach nikt się nie ściga. Pracujemy z oddechem, a po godzinie wychodzisz lżejsza i spokojniejsza.',
    R,
    marzena,
  );
  const marzenaNext = db
    .prepare("SELECT id FROM class_sessions WHERE studio_id = ? AND trainer_id = ? AND status = 'scheduled' AND public = 1 AND starts_at > ? ORDER BY starts_at LIMIT 2")
    .all(R, marzena, now.toISOString()) as { id: string }[];
  for (const [i, s] of marzenaNext.entries())
    db.prepare('INSERT INTO trainer_invites (id, studio_id, trainer_id, session_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      `ti${i}`,
      R,
      marzena,
      s.id,
      i === 0 ? 'Będzie dużo pracy z oddechem i spokojne tempo – idealne na początek tygodnia 🌿' : 'Zapraszam na reformer flow – zajmiemy się plecami i barkami.',
      iso(now),
    );

  seedExtras(db, now);
  seedSsg(db, now, { user, member, product, buy });
  // Magda chodzi też do SS&G – po przełączeniu studia widać jego logo i zdjęcia zajęć.
  member(SSG_STUDIO, magda, 'client', 12, { goal: 'Stretching i mocniejsze plecy' });
  return { studios: [R, K, SSG_STUDIO], users: Object.fromEntries(users) };
}

// `npm run seed`  – wgrywa demo tylko do pustej bazy; Twoje zmiany (zdjęcia, teksty, klientki) zostają.
// `npm run reset` – świadomie zaczyna od zera: najpierw kopia zapasowa, potem świeże demo.
if (import.meta.main) {
  const file = DB_FILE;
  const reset = process.argv.includes('--reset');
  const hasData = () => {
    if (!existsSync(file)) return false;
    const db = openDb(file);
    try {
      return (db.prepare('SELECT COUNT(*) AS n FROM studios').get() as { n: number }).n > 0;
    } finally {
      db.close();
    }
  };
  if (hasData() && !reset) {
    console.log(`✿ Baza z danymi już jest (${file}) – zostawiam ją bez zmian. Od zera: npm run reset`);
    process.exit(0);
  }
  if (reset && existsSync(file)) {
    const db = openDb(file);
    console.log(`💾 Kopia przed resetem: ${backup(db)}`);
    db.close();
  }
  for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
  const db = openDb(file);
  seed(db);
  console.log('✿ Dane demo gotowe. Telefony do logowania:');
  for (const [k, v] of Object.entries(DEMO)) console.log(`  ${k.padEnd(14)} ${v}`);
  console.log('  — SS&G —');
  for (const [k, v] of Object.entries(SSG)) console.log(`  ${k.padEnd(14)} ${v}`);
}
