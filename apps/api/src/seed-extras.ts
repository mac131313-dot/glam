// Dane demo dla modułów v2.11: społeczność, wyzwania, lojalność, sklep, wydarzenia, kursy, muzyka,
// zdrowie (za zgodą, zaszyfrowane), feedback, czat, koordynatorka. Osobny plik, żeby seed.ts został czytelny.
import { addDays, localParts } from '@glam/core';
import { seal } from './crypto.ts';
import type { Db } from './db.ts';

const DAY = 86_400_000;

export function seedExtras(db: Db, now = new Date()) {
  const R = 'st_rzeszow';
  const K = 'st_krakow';
  const iso = (d: Date) => d.toISOString();
  const ago = (days: number) => iso(new Date(now.getTime() - days * DAY));
  const today = localParts(now).date;
  const run = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).run(...p);
  const [owner, marzena, ola, kasia, magda, ania] = ['u_001', 'u_002', 'u_003', 'u_004', 'u_005', 'u_006'];
  const [ewa, , , , , , , , , , lena] = Array.from({ length: 12 }, (_, i) => `u_${101 + i}`);

  // ——— Studio: plan, dane, regulamin, rocznica ———
  run(
    "UPDATE studios SET plan_id = 'studio', status = 'active', email = 'hej@centrumruchu.pl', address = 'ul. Słoneczna 7, 35-001 Rzeszów', nip = '5260250274', founded_on = '2023-10-20', catalog_visible = 1, regulations = ? WHERE id = ?",
    'Zapisy do 2 h przed zajęciami, bezpłatne odwołanie do 2 h przed. Karnety są imienne. Zawieszenie karnetu: do 2 razy, łącznie 60 dni. Na sali obowiązują skarpetki antypoślizgowe.',
    R,
  );
  run("UPDATE studios SET plan_id = 'start', status = 'active', catalog_visible = 0 WHERE id = ?", K);

  // ——— Koordynatorka społeczności (decyzja 12) ———
  run("INSERT INTO users (id, phone, name, created_at) VALUES ('u_010', '+48500000010', 'Zuza', ?)", ago(90));
  run("INSERT INTO memberships (studio_id, user_id, role, joined_at) VALUES (?, 'u_010', 'coordinator', ?)", R, ago(80));
  run("UPDATE memberships SET prefs_json = '{\"birthdayWishes\":true}' WHERE studio_id = ? AND user_id = ? AND role = 'trainer'", R, marzena);
  run("UPDATE memberships SET trainer_id = ? WHERE studio_id = ? AND user_id = ? AND role = 'client'", marzena, R, magda);
  for (const ct of ['ct_reformer', 'ct_mat', 'ct_stretch', 'ct_pt']) run('INSERT INTO trainer_class_types (studio_id, trainer_id, class_type_id) VALUES (?, ?, ?)', R, marzena, ct);
  for (const ct of ['ct_reformer', 'ct_mat', 'ct_stretch']) run('INSERT INTO trainer_class_types (studio_id, trainer_id, class_type_id) VALUES (?, ?, ?)', R, ola, ct);

  // ——— Zgody i preferencje ———
  const consent = (u: string, kind: string, studio = '') => run('INSERT OR REPLACE INTO consents (user_id, studio_id, kind, granted, updated_at) VALUES (?, ?, ?, 1, ?)', u, studio, kind, ago(40));
  for (const u of [magda, ania, ewa]) consent(u, 'terms');
  consent(magda, 'marketing', R);
  consent(magda, 'health');
  consent(magda, 'photos');
  consent(ewa, 'marketing', R);
  run("UPDATE users SET onboarded_at = ?, nameday = '05-26', prefs_json = ? WHERE id = ?", ago(45), JSON.stringify({ reminderTime: '07:30', goal: 'Silny kręgosłup', visibility: 'studio', occasionsOff: [] }), magda);
  run('UPDATE users SET onboarded_at = ? WHERE id IN (?, ?)', ago(3), ania, ewa);

  // ——— Zdrowie (ankieta startowa, pomiary) i dziennik – zaszyfrowane ———
  run('INSERT INTO health_profiles (studio_id, user_id, data_enc, updated_at) VALUES (?, ?, ?, ?)', R, magda, seal({ goals: 'Silne plecy, mniej bólu po pracy przy biurku', limitations: 'Odcinek lędźwiowy – ostrożnie z głębokimi skłonami', injuries: '' }), ago(40));
  run('INSERT INTO measurements (id, studio_id, user_id, date, data_enc, share_with_trainer, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)', 'ms1', R, magda, addDays(today, -30), seal({ wellbeing: 3, note: 'Start' }), ago(30));
  run('INSERT INTO measurements (id, studio_id, user_id, date, data_enc, share_with_trainer, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)', 'ms2', R, magda, addDays(today, -2), seal({ wellbeing: 4, note: 'Lżej w plecach' }), ago(2));
  [[-3, 4, 3, 3, 'Spacer z siostrą'], [-2, 3, 2, 2, ''], [-1, 4, 4, 4, 'Dobra kawa i spokojny poranek']].forEach(([d, mood, energy, sleep, g]) =>
    run('INSERT INTO journal_entries (user_id, date, data_enc, created_at) VALUES (?, ?, ?, ?)', magda, addDays(today, d as number), seal({ mood, energy, sleep, gratitude: g || undefined }), ago(-(d as number))),
  );
  run('INSERT INTO mindful_logs (id, studio_id, user_id, kind, ref, minutes, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'ml1', R, magda, 'meditation', 'morning', 5, ago(1));
  run('INSERT INTO mindful_logs (id, studio_id, user_id, kind, ref, minutes, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'ml2', R, magda, 'stretch', 'office5', 5, ago(0.2));
  run("INSERT INTO course_mini_progress (user_id, program, day, done_at) VALUES (?, 'calm7', 1, ?)", magda, ago(2));
  run("INSERT INTO course_mini_progress (user_id, program, day, done_at) VALUES (?, 'calm7', 2, ?)", magda, ago(1));
  run("INSERT INTO trainer_notes (id, studio_id, trainer_id, client_id, body, created_at) VALUES ('tn1', ?, ?, ?, 'Pracujemy nad neutralną miednicą. Na Reformerze sprężyny lżej przy footwork.', ?)", R, marzena, magda, ago(10));
  run(
    "INSERT INTO individual_plans (id, studio_id, trainer_id, client_id, title, items_json, updated_at) VALUES ('ip1', ?, ?, ?, 'Plecy w 4 tygodnie', ?, ?)",
    R,
    marzena,
    magda,
    JSON.stringify([{ day: 'Poniedziałek', text: 'Reformer u Marzeny' }, { day: 'Środa', text: 'Stretch 10 min wieczorem (rutyna w aplikacji)' }, { day: 'Codziennie', text: 'Mikroprzerwa: kark i ramiona przy biurku' }]),
    ago(5),
  );

  // ——— Społeczność: grupy, posty, wyzwania ———
  const groups = ['Początkujące', 'Mamy po porodzie', 'Biuro i kręgosłup', 'Bieganie + Pilates', 'Kobiety 40+', 'Poranne ranki'];
  groups.forEach((g, i) => run('INSERT INTO groups (id, studio_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)', `g${i + 1}`, R, g, null, ago(60)));
  run('INSERT INTO group_members (studio_id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)', R, 'g3', magda, ago(30));
  run('INSERT INTO group_members (studio_id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)', R, 'g1', ania, ago(2));
  run('INSERT INTO group_members (studio_id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)', R, 'g3', ewa, ago(20));
  const post = (id: string, author: string, kind: string, body: string, days: number, group: string | null = null, eventAt: string | null = null) =>
    run('INSERT INTO posts (id, studio_id, author_id, group_id, kind, body, event_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, R, author, group, kind, body, eventAt, ago(days));
  post('p1', owner, 'announcement', 'Od listopada nowe poranne zajęcia Reformer we wtorki o 7:30. Zapisy już otwarte 🌿', 1);
  post('p2', marzena, 'story', 'Dzisiejszy Reformer: dużo pracy z oddechem i stabilizacją. Dziękuję, dziewczyny – byłyście cudowne ✨', 2);
  post('p3', owner, 'event', 'Warsztat oddechowy z herbatą – spotkanie dla wszystkich klientek.', 3, null, iso(new Date(now.getTime() + 9 * DAY)));
  post('p4', ewa, 'post', 'Po trzech tygodniach stretchu w końcu dotykam palców stóp 😄 Polecam środowe zajęcia u Oli!', 4);
  post('p5', magda, 'post', 'Macie sposób na ból karku po pracy? Robię mikroprzerwy z aplikacji, ale chętnie poznam Wasze triki.', 1, 'g3');
  run("INSERT INTO post_comments (id, studio_id, post_id, author_id, body, created_at) VALUES ('pc1', ?, 'p4', ?, 'Brawo! To piękny postęp 💛', ?)", R, ola, ago(3));
  run("INSERT INTO post_comments (id, studio_id, post_id, author_id, body, created_at) VALUES ('pc2', ?, 'p5', ?, 'Mnie pomaga rutyna „Biuro i kręgosłup” – 5 minut i jest lżej.', ?)", R, ewa, ago(0.5));
  run("INSERT INTO post_likes (studio_id, post_id, user_id) VALUES (?, 'p4', ?)", R, magda);
  const month = today.slice(0, 7);
  run(
    "INSERT INTO challenges (id, studio_id, title, description, metric, target, starts_on, ends_on, badge_code, created_at) VALUES ('ch1', ?, 'Październik oddechowy', 'Dziesięć chwil oddechu w październiku – w swoim tempie.', 'mindful', 10, ?, ?, 'breath_october', ?)",
    R,
    `${month}-01`,
    `${month}-28`,
    ago(12),
  );
  run(
    "INSERT INTO challenges (id, studio_id, title, description, metric, target, starts_on, ends_on, badge_code, created_at) VALUES ('ch2', ?, '30 dni planku', 'Codziennie krótka deska – tyle, ile dziś możesz. Odhacz w aplikacji.', 'checkins', 20, ?, ?, NULL, ?)",
    R,
    addDays(today, -5),
    addDays(today, 25),
    ago(6),
  );
  run("INSERT INTO challenge_members (studio_id, challenge_id, user_id, joined_at) VALUES (?, 'ch1', ?, ?)", R, magda, ago(10));
  run("INSERT INTO challenge_members (studio_id, challenge_id, user_id, joined_at) VALUES (?, 'ch2', ?, ?)", R, ewa, ago(5));
  for (let d = 1; d <= 4; d++) run("INSERT INTO challenge_checkins (studio_id, challenge_id, user_id, date) VALUES (?, 'ch2', ?, ?)", R, ewa, addDays(today, -d));

  // ——— Lojalność, nagrody, szafka, kartki ———
  const reward = (id: string, name: string, kind: string, cost: number, value: number | null) => run('INSERT INTO rewards (id, studio_id, name, kind, cost_points, value, active) VALUES (?, ?, ?, ?, ?, ?, 1)', id, R, name, kind, cost, value);
  reward('rw1', 'Rabat 15% na karnet', 'discount', 250, 15);
  reward('rw2', 'Wcześniejszy zapis na 30 dni', 'early_booking', 300, null);
  reward('rw3', 'Wejście gratis', 'entry', 400, 1);
  reward('rw4', 'Kubek studia', 'gift', 600, null);
  for (let i = 1; i <= 5; i++) run("INSERT INTO loyalty_ledger (id, studio_id, user_id, points, reason, ref, created_at) VALUES (?, ?, ?, 20, 'training', ?, ?)", `ll${i}`, R, magda, `seed-${i}`, ago(30 - i * 5));
  run("INSERT INTO loyalty_ledger (id, studio_id, user_id, points, reason, ref, created_at) VALUES ('ll9', ?, ?, 40, 'challenge', 'seed', ?)", R, magda, ago(8));
  run("INSERT INTO loyalty_ledger (id, studio_id, user_id, points, reason, ref, created_at) VALUES ('ll10', ?, ?, 260, 'training', 'seed-hist', ?)", R, ewa, ago(20));
  for (const b of ['first_class', 'first_month', 'first_meditation']) run('INSERT INTO user_badges (studio_id, user_id, code, earned_at) VALUES (?, ?, ?, ?)', R, magda, b, ago(20));
  run('INSERT INTO user_badges (studio_id, user_id, code, earned_at) VALUES (?, ?, ?, ?)', R, ewa, 'ten_classes', ago(5));
  run(
    "INSERT INTO locker_items (id, studio_id, user_id, source, title, options_json, status, milestone, created_at, updated_at) VALUES ('lk1', ?, ?, 'ten_classes', 'Nagroda za 10 treningów: Skarpetki antypoślizgowe', '{\"delivery\":[\"pickup\",\"ship\"]}', 'choose', 10, ?, ?)",
    R,
    ewa,
    ago(5),
    ago(5),
  );
  run("INSERT INTO card_tasks (id, studio_id, trainer_id, client_id, due_on, delivery, status, created_at, updated_at) VALUES ('ct1', ?, ?, ?, ?, 'pickup', 'todo', ?, ?)", R, marzena, magda, addDays(today, 2), ago(1), ago(1));

  // ——— Kody rabatowe, partnerzy, kampania ———
  run("INSERT INTO coupons (id, studio_id, code, label, kind, value, applies_to, per_user, active, valid_from, valid_to, created_at) VALUES ('cp1', ?, 'JESIEN15', 'Jesień w studiu', 'percent', 15, 'pass', 1, 1, ?, ?, ?)", R, `${month}-01`, `${month}-31`, ago(10));
  run("INSERT INTO partners (id, studio_id, name, category, description, perk, code, url, verified) VALUES ('pa1', ?, 'Zielona Kawiarnia', 'Zdrowe jedzenie', 'Śniadania i koktajle obok studia.', '-10% za okazaniem aplikacji', 'GLAM10', 'https://example.com', 1)", R);
  run("INSERT INTO partners (id, studio_id, name, category, description, perk, url, verified) VALUES ('pa2', ?, 'Fizjo Rzeszów', 'Fizjoterapia', 'Konsultacje i terapia manualna.', 'Pierwsza konsultacja -20%', 'https://example.com', 1)", R);
  run(
    "INSERT INTO campaigns (id, studio_id, name, channel, segment, variants_json, status, created_by, created_at) VALUES ('cm1', ?, 'Powrót po przerwie', 'push', 'dormant14', ?, 'draft', ?, ?)",
    R,
    JSON.stringify([{ id: 'A', body: 'Tęsknimy za Tobą na sali. Zajrzyj do grafiku, kiedy zechcesz 🌿' }, { id: 'B', body: 'Nowe poranne zajęcia czekają. Może wtorek o 7:30?' }]),
    owner,
    ago(1),
  );

  // ——— Sklep: menu baru, akcesoria z logo, stroje ———
  type Prod = { category: string; scale?: string; desc: string; nutrition?: Record<string, unknown>; featured?: boolean; reward?: boolean; age?: number };
  const prod = (id: string, name: string, price: number, variants: unknown[], o: Prod) =>
    run(
      "INSERT INTO shop_products (id, studio_id, category, name, description, price_grosze, status, size_scale, variants_json, nutrition_json, featured, reward_eligible, created_at) VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?)",
      id, R, o.category, name, o.desc, price, o.scale ?? 'none', JSON.stringify(variants), o.nutrition ? JSON.stringify(o.nutrition) : null, Number(!!o.featured), Number(!!o.reward), ago(o.age ?? 40),
    );
  prod('sp5', 'Shake białkowy wanilia–banan', 1900, [{ id: 'one', stock: null }], { category: 'drink', desc: 'Białko serwatkowe, banan, mleko owsiane, szczypta cynamonu. Idealny do 30 minut po treningu.', nutrition: { serving: '400 ml', kcal: 260, protein: 30, carbs: 24, sugar: 14, fat: 4 }, featured: true, age: 20 });
  prod('sp6', 'Matcha latte', 1600, [{ id: 'r', size: '300 ml', stock: null }, { id: 'xl', size: '450 ml', stock: null, priceGrosze: 1900 }], { category: 'drink', scale: 'volume', desc: 'Ceremonialna matcha na mleku owsianym, bez cukru.', nutrition: { serving: '300 ml', kcal: 120, protein: 3, carbs: 18, sugar: 9, fat: 4, caffeine: 70 }, age: 21 });
  prod('sp7', 'Zielone smoothie', 1800, [{ id: 'one', stock: null }], { category: 'drink', desc: 'Szpinak, ananas, jabłko, imbir, limonka.', nutrition: { serving: '350 ml', kcal: 180, protein: 5, carbs: 34, sugar: 22, fiber: 6 }, age: 22 });
  prod('sp8', 'Woda z elektrolitami', 800, [{ id: 'one', stock: null }], { category: 'drink', desc: 'Schłodzona, z cytryną i solą himalajską.', age: 23 });
  prod('sp9', 'Hantelki neoprenowe z logo', 4900, [{ id: 'h05', size: '0,5 kg', stock: 6 }, { id: 'h1', size: '1 kg', stock: 4, priceGrosze: 5900 }, { id: 'h15', size: '1,5 kg', stock: 0, priceGrosze: 6900 }], { category: 'accessory', scale: 'weight', desc: 'Para hantelek z miękkim, antypoślizgowym neoprenem i logo studia. Te same, na których ćwiczysz na sali.', featured: true, age: 30 });
  prod('sp10', 'Podstawki korkowe z logo (2 szt.)', 2900, [{ id: 'one', stock: 12 }], { category: 'accessory', desc: 'Naturalny korek, grawerowane logo – pod kubek albo butelkę.', age: 31 });
  prod('sp3', 'Mata z logo studia', 18900, [{ id: 'sand', color: 'piaskowa', stock: 3 }, { id: 'sage', color: 'szałwia', stock: 0 }], { category: 'accessory', desc: 'Lekka, 1,5 mm, z logo studia – do walizki i do domu.' });
  prod('sp2', 'Butelka szklana 500 ml', 6900, [{ id: 'b', color: 'mleczna', stock: 8 }], { category: 'accessory', desc: 'Szkło borokrzemowe, pokrowiec z logo studia.' });
  prod('sp1', 'Skarpetki antypoślizgowe', 3900, [{ id: 's', size: '35–38', stock: 6 }, { id: 'm', size: '39–42', stock: 10 }, { id: 'l', size: '43–46', stock: 2 }], { category: 'apparel', scale: 'socks', desc: 'Bawełna z silikonowymi kropkami. Nagroda za 10 treningów.', reward: true });
  prod('sp11', 'Legginsy z wysokim stanem', 18900, [{ id: 'xs', size: 'XS', color: 'grafit', stock: 2 }, { id: 's', size: 'S', color: 'grafit', stock: 5 }, { id: 'm', size: 'M', color: 'grafit', stock: 3 }, { id: 'l', size: 'L', color: 'grafit', stock: 1 }], { category: 'apparel', scale: 'clothing', desc: 'Matowa, gęsta dzianina, która nie prześwituje przy skłonach. Haftowane logo na pasie.', featured: true, age: 25 });
  prod('sp4', 'Koszulka „Oddychaj”', 9900, [{ id: 'xs', size: 'XS', stock: 2 }, { id: 's', size: 'S', stock: 4 }, { id: 'm', size: 'M', stock: 4 }], { category: 'apparel', scale: 'clothing', desc: 'Organiczna bawełna, krój oversize.' });

  // ——— Wydarzenia prywatne ———
  run("INSERT INTO event_packages (id, studio_id, name, kinds_json, min_guests, max_guests, duration_min, price_grosze, deposit_grosze, addons_json, active) VALUES ('ep1', ?, 'Urodziny do 10 osób', '[\"birthday\",\"anniversary\"]', 4, 10, 90, 89000, 20000, '[\"playlist\",\"decor\"]', 1)", R);
  run("INSERT INTO event_packages (id, studio_id, name, kinds_json, min_guests, max_guests, duration_min, price_grosze, deposit_grosze, addons_json, active) VALUES ('ep2', ?, 'Babski wieczór', '[\"girls_night\",\"team\",\"gift\"]', 4, 12, 120, NULL, NULL, '[\"playlist\",\"snacks\"]', 1)", R);
  const evStart = new Date(now.getTime() + 21 * DAY);
  evStart.setUTCHours(16, 0, 0, 0);
  run(
    "INSERT INTO private_events (id, studio_id, client_id, kind, package_id, trainer_id, zone_id, activity, starts_at, ends_at, guests, addons_json, client_note, status, payment_mode, invite_code, terms_accepted_at, history_json, created_at, updated_at) VALUES ('ev1', ?, ?, 'girls_night', 'ep2', ?, 'z_pilates', 'Połączenie', ?, ?, 8, '[\"playlist\"]', 'Dużo śmiechu, spokojne tempo 💛', 'inquiry', 'on_site', 'EDEMO01', ?, ?, ?, ?)",
    R,
    magda,
    marzena,
    iso(evStart),
    iso(new Date(evStart.getTime() + 2 * 3_600_000)),
    ago(1),
    JSON.stringify([{ by: 'Magda', text: 'Zapytanie o wydarzenie', at: ago(1) }]),
    ago(1),
    ago(1),
  );

  // ——— Kursy: w karnecie (decyzja B) ———
  run(
    `INSERT INTO courses (id, studio_id, author_id, title, subtitle, description, kind, level, goal, day_part, contraindications, included_product_ids_json, drip_days, status, created_at, updated_at)
     VALUES ('co1', ?, ?, 'Reformer od podstaw – 4 tygodnie', 'Technika, oddech, pewność na maszynie', 'Cztery moduły, które przygotują Cię do zajęć grupowych na Reformerze. Krótkie lekcje, dużo spokoju.', 'video', 'początkujące', 'siła', 'wieczór', 'Ciąża i świeże urazy kręgosłupa – skonsultuj się z lekarzem.', '["pr_r9","pr_p4"]', 7, 'published', ?, ?)`,
    R,
    marzena,
    ago(30),
    ago(5),
  );
  const lesson = (id: string, course: string, module: string, title: string, kind: string, body: string, dur: number, sort: number, free = 0) =>
    run('INSERT INTO course_lessons (id, studio_id, course_id, module, title, kind, body, duration_sec, free_preview, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, R, course, module, title, kind, body, dur, free, sort);
  lesson('l1', 'co1', 'Tydzień 1 · Oddech', 'Poznaj maszynę', 'text', 'Wózek, sprężyny, podnóżek. Ustawiamy maszynę bezpiecznie i bez pośpiechu.', 420, 1, 1);
  lesson('l2', 'co1', 'Tydzień 1 · Oddech', 'Oddech żebrowy', 'text', 'Połóż dłonie na żebrach. Wdech rozszerza je na boki, wydech miękko zamyka.', 600, 2);
  lesson('l3', 'co1', 'Tydzień 2 · Środek', 'Neutralna miednica', 'text', 'Szukamy pozycji, w której kręgosłup zachowuje naturalne krzywizny.', 540, 3);
  lesson('l4', 'co1', 'Tydzień 3 · Ruch', 'Footwork krok po kroku', 'homework', 'Zadanie: trzy razy w tygodniu po 10 powtórzeń w czterech pozycjach stóp.', 720, 4);
  lesson('l5', 'co1', 'Tydzień 4 · Flow', 'Pierwsza sekwencja', 'text', 'Łączymy wszystko w płynną sekwencję – w swoim tempie.', 900, 5);
  run("INSERT INTO course_enrollments (studio_id, course_id, user_id, source, started_at) VALUES (?, 'co1', ?, 'pass', ?)", R, magda, ago(10));
  run("INSERT INTO lesson_progress (studio_id, user_id, lesson_id, position_sec, completed_at, updated_at) VALUES (?, ?, 'l1', 420, ?, ?)", R, magda, ago(9), ago(9));
  run("INSERT INTO course_questions (id, studio_id, lesson_id, user_id, body, answer, answered_by, created_at) VALUES ('q1', ?, 'l1', ?, 'Jakie sprężyny na początek?', 'Na start jedna czerwona i jedna niebieska – resztę ustawimy razem na sali 💛', ?, ?)", R, magda, marzena, ago(8));
  run(
    `INSERT INTO courses (id, studio_id, author_id, title, subtitle, description, kind, level, goal, contraindications, status, created_at, updated_at)
     VALUES ('co2', ?, ?, 'Silny kręgosłup w 21 dni', 'Program na plecy przy pracy biurowej', 'Codziennie 10–15 minut mobilności i wzmacniania.', 'program', 'wszystkie poziomy', 'regeneracja', 'Ostry ból i urazy – najpierw konsultacja lekarska.', 'pending', ?, ?)`,
    R,
    ola,
    ago(4),
    ago(1),
  );
  lesson('l6', 'co2', 'Dni 1–7', 'Mobilizacja odcinka piersiowego', 'text', 'Delikatne skręty i otwarcia klatki piersiowej.', 600, 1, 1);
  run(
    `INSERT INTO courses (id, studio_id, author_id, title, kind, level, goal, status, created_at, updated_at) VALUES ('co3', ?, ?, '6 tygodni spokoju', 'mindbody', 'początkujące', 'spokój', 'draft', ?, ?)`,
    R,
    marzena,
    ago(2),
    ago(2),
  );

  // ——— Kurs ze stroną sprzedażową (wzór: audyt STRETCH&GLOW; osoby fikcyjne) ———
  const later = (days: number) => iso(new Date(now.getTime() + days * DAY));
  run(
    `INSERT INTO courses (id, studio_id, author_id, title, subtitle, description, kind, level, goal, day_part, contraindications, access_days, included_product_ids_json, status, page_json, created_at, updated_at)
     VALUES ('co4', ?, ?, 'Stretch & Shine', 'Barre, stretching i rzeźbienie w 25 minut dziennie', ?, 'program', 'wszystkie poziomy', 'elastyczność', 'rano', 'Ciąża, świeże urazy i operacje – przed startem skonsultuj się z lekarzem.', NULL, '["pr_r9"]', 'published', ?, ?, ?)`,
    R,
    marzena,
    'Autorska metoda Barre & Stretch, treningi rzeźbiące i lekcje zaproszonych ekspertek. Krótko, regularnie, z planem na każdy dzień.',
    JSON.stringify({
      promise: 'Wszystko, by zbudować zdrową rutynę i zadbać o swoje ciało',
      outcomes: ['Dłuższe, elastyczne mięśnie i lżejszy krok', 'Lepsza postawa przy biurku', 'Mocniejszy środek ciała', 'Spokojniejsza, mniej opuchnięta twarz rano', 'Rutyna, która mieści się w 25 minutach'],
      forWhom: ['Chcesz wysmuklić i wydłużyć mięśnie bez dźwigania ciężarów', 'Masz mało czasu – trening trwa 20–25 minut', 'Lubisz intensywne, ale świadome zajęcia'],
      equipment: 'mata, mała piłka i krzesło',
      faq: [
        { q: 'Kiedy dostanę dostęp?', a: 'Od razu po płatności. Zaloguj się w aplikacji numerem telefonu z zamówienia – wyślemy kod SMS.' },
        { q: 'Jakiego sprzętu potrzebuję?', a: 'Mata, mała piłka i krzesło. Piłkę możesz zastąpić zwiniętym ręcznikiem.' },
        { q: 'Czy dam radę bez doświadczenia?', a: 'Tak. Każdy trening ma wersję łatwiejszą, a kalendarz zaczyna się od spokojnych dni.' },
        { q: 'Na jakich urządzeniach obejrzę kurs?', a: 'Telefon, tablet i komputer. Z telefonu puścisz trening na telewizor przez AirPlay lub Chromecast.' },
        { q: 'Czy mogę zwrócić kurs?', a: 'Dostęp do treści cyfrowych zaczyna się od razu, dlatego prawo odstąpienia wygasa przy zakupie. Napisz do nas, jeśli coś nie działa – pomożemy.' },
        { q: 'Mam karnet w studiu. Czy muszę kupować kurs?', a: 'Nie. Karnet Pilates Reformer 9 obejmuje ten kurs – znajdziesz go w aplikacji w zakładce Kursy.' },
      ],
    }),
    ago(20),
    ago(1),
  );
  run(
    "INSERT INTO course_editions (id, studio_id, course_id, name, theme, sales_from, sales_until, starts_at, access_until, news_json, created_at) VALUES ('ed4', ?, 'co4', 'Edycja jesienna', 'fit & healthy routine', ?, ?, ?, ?, ?, ?)",
    R,
    ago(10),
    later(20),
    ago(1),
    later(120),
    JSON.stringify([
      { title: 'Kalendarz treningowy', body: 'Gotowy plan rozpisany dzień po dniu – nie musisz nic wybierać.' },
      { title: 'Treningi rzeźbiące', body: 'Nowy blok z Julią: wzmocnienie i modelowanie sylwetki.' },
      { title: 'Nowe Barre & Stretch', body: 'Świeże zajęcia autorską metodą Marzeny.' },
      { title: 'Masaż twarzy', body: 'Krótkie lekcje z Niną na rano i wieczór.' },
    ]),
    ago(10),
  );
  const tier = (id: string, name: string, price: number, features: string[], sort: number, highlight = 0, seats: number | null = null) =>
    run('INSERT INTO course_tiers (id, studio_id, course_id, name, price_grosze, features_json, highlight, seat_limit, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, R, 'co4', name, price, JSON.stringify(features), highlight, seats, sort);
  const base = ['Wszystkie treningi edycji', 'Kalendarz treningowy dzień po dniu', 'Dostęp do końca edycji'];
  tier('t4_std', 'Standard', 19900, base, 1);
  tier('t4_full', 'Full', 27900, [...base, 'Lekcje zaproszonych ekspertek', 'Społeczność uczestniczek'], 2, 1);
  tier('t4_pers', 'Personal', 54900, [...base, 'Lekcje zaproszonych ekspertek', 'Społeczność uczestniczek', 'Konsultacja 1:1 online (30 min)'], 3, 0, 10);
  const person = (id: string, user: string | null, name: string, role: string, title: string, bio: string, sort: number) =>
    run('INSERT INTO course_people (id, studio_id, course_id, user_id, name, role, title, bio, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, R, 'co4', user, name, role, title, bio, sort);
  person('p4_m', marzena, 'Marzena', 'author', 'autorka metody Barre & Stretch', 'Od 15 lat uczy pilatesu i baletu dla dorosłych. Łączy pracę przy drążku ze stretchingiem, żeby trening był krótki, a efekty – długie.', 1);
  person('p4_j', null, 'Julia Sadowska', 'trainer', 'trenerka przygotowania motorycznego', 'Pracuje z tancerkami i biegaczkami. Jej treningi rzeźbiące są krótkie i bardzo precyzyjne.', 2);
  person('p4_n', null, 'Nina Zawadzka', 'expert', 'kosmetolożka', 'Specjalizuje się w masażu twarzy i pracy z napięciem żuchwy.', 3);
  person('p4_t', null, 'dr Tomasz Weller', 'expert', 'fizjoterapeuta', 'Łączy wiedzę medyczną z uważnym ruchem. Prowadzi trening barre z naciskiem na bezpieczne stawy.', 4);
  const lesson4 = (id: string, module: string, title: string, dur: number, day: number, who: string, sort: number, free = 0) =>
    run('INSERT INTO course_lessons (id, studio_id, course_id, module, title, kind, duration_sec, unlock_day, free_preview, person_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, R, 'co4', module, title, 'text', dur, day, free, who, sort);
  lesson4('l4_1', 'Barre & Stretch', 'Pierwszy trening przy krześle', 1320, 0, 'p4_m', 1, 1);
  lesson4('l4_2', 'Barre & Stretch', 'Długie nogi, lekkie biodra', 1500, 1, 'p4_m', 2);
  lesson4('l4_3', 'Barre & Stretch', 'Plecy i postawa', 1380, 3, 'p4_m', 3);
  lesson4('l4_4', 'Barre & Stretch', 'Pełny stretch', 1500, 5, 'p4_m', 4);
  lesson4('l4_5', 'Rzeźbienie', 'Pośladki i uda', 1260, 2, 'p4_j', 5);
  lesson4('l4_6', 'Rzeźbienie', 'Ramiona bez ciężarów', 1200, 4, 'p4_j', 6);
  lesson4('l4_7', 'Rzeźbienie', 'Środek ciała', 1320, 6, 'p4_j', 7);
  lesson4('l4_8', 'Masaż twarzy', 'Poranny drenaż', 600, 1, 'p4_n', 8);
  lesson4('l4_9', 'Masaż twarzy', 'Wieczorne rozluźnienie żuchwy', 720, 4, 'p4_n', 9);
  lesson4('l4_10', 'Barre z fizjoterapeutą', 'Bezpieczne kolana i biodra', 1500, 7, 'p4_t', 10);

  // ——— Muzyka ———
  run("INSERT INTO playlists (id, studio_id, provider, url, name, purpose, class_type_id, created_by, created_at) VALUES ('pl1', ?, 'spotify', 'https://open.spotify.com/playlist/37i9dQZF1DX9uKNf5jGX6m', 'Reformer – spokojny flow', 'class', 'ct_reformer', ?, ?)", R, marzena, ago(20));
  run("INSERT INTO playlists (id, studio_id, provider, url, name, purpose, created_by, created_at) VALUES ('pl2', ?, 'spotify', 'https://open.spotify.com/playlist/37i9dQZF1DWZqd5JICZI0u', 'Na sen', 'sleep', ?, ?)", R, ola, ago(20));
  run("INSERT INTO playlists (id, studio_id, provider, url, name, purpose, created_by, created_at) VALUES ('pl3', ?, 'spotify', 'https://open.spotify.com/playlist/37i9dQZF1DX3Ogo9pFvBkY', 'Playlista października', 'shared', ?, ?)", R, owner, ago(12));
  run("UPDATE class_types SET playlist_id = 'pl1' WHERE id = 'ct_reformer'");
  run("INSERT INTO playlist_tracks (id, studio_id, playlist_id, user_id, track_url, title, artist, status, created_at) VALUES ('tr1', ?, 'pl3', ?, 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'Spokojny wieczór', 'Lena Lu', 'approved', ?)", R, ewa, ago(3));
  run("INSERT INTO playlist_tracks (id, studio_id, playlist_id, user_id, track_url, title, artist, status, created_at) VALUES ('tr2', ?, 'pl3', ?, 'https://open.spotify.com/track/1301WleyT98MSxVHPZCA6M', 'Poranny oddech', 'Mira', 'pending', ?)", R, magda, ago(0.5));
  run("INSERT INTO track_votes (studio_id, track_id, user_id) VALUES (?, 'tr1', ?)", R, magda);

  // ——— Feedback, polecenia, czat, zgłoszenie do platformy ———
  run("INSERT INTO nps_responses (id, studio_id, user_id, trigger, created_at) VALUES ('nps1', ?, ?, 'first_month', ?)", R, magda, ago(1));
  run("INSERT INTO nps_responses (id, studio_id, user_id, trigger, score, comment, created_at, answered_at) VALUES ('nps2', ?, ?, 'training:10', 10, 'Najlepsze miejsce w mieście 💛', ?, ?)", R, ewa, ago(5), ago(5));
  run(
    "INSERT INTO dormant_surveys (id, studio_id, user_id, reasons_json, comment, wants_proposal, status, created_at, answered_at, contact_due_at) VALUES ('ds1', ?, ?, '[\"time\"]', 'Zmieniłam pracę, nie mam wieczorów.', 1, 'answered', ?, ?, ?)",
    R,
    lena,
    ago(8),
    ago(7),
    ago(6),
  );
  run("INSERT INTO referrals (id, studio_id, inviter_id, code, invitee_phone, channel, status, created_at, updated_at) VALUES ('rf1', ?, ?, 'PDEMO01', '+48600111333', 'sms', 'sent', ?, ?)", R, magda, ago(3), ago(3));
  run("INSERT INTO chat_messages (id, studio_id, client_id, author_id, from_staff, body, created_at, read_at) VALUES ('cm1', ?, ?, ?, 0, 'Czy mogę przyjść na Reformer z lekkim katarem?', ?, ?)", R, magda, magda, ago(1), ago(0.9));
  run("INSERT INTO chat_messages (id, studio_id, client_id, author_id, from_staff, body, created_at) VALUES ('cm2', ?, ?, ?, 1, 'Jeśli czujesz się dobrze – zapraszamy, ale odpuść, gdy jest gorączka. Zdrówka 💛', ?)", R, magda, kasia, ago(0.8));
  run("INSERT INTO support_tickets (id, studio_id, author_id, subject, priority, status, sla_due_at, created_at, updated_at) VALUES ('tk1', ?, ?, 'Jak podpiąć terminal do raportu?', 'normal', 'open', ?, ?, ?)", R, owner, iso(new Date(now.getTime() + 20 * 3_600_000)), ago(0.2), ago(0.2));
  run("INSERT INTO ticket_messages (id, ticket_id, author_id, from_platform, body, created_at) VALUES ('tm1', 'tk1', ?, 0, 'Chcę, żeby sprzedaż z terminala trafiała do raportu miesięcznego.', ?)", owner, ago(0.2));
  run('INSERT INTO studio_reviews (studio_id, user_id, rating, body, created_at) VALUES (?, ?, 5, ?, ?)', R, ewa, 'Ciepła atmosfera i świetne trenerki.', ago(10));
}
