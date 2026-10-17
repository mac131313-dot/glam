// Studio SS&G: prawdziwy grafik, cennik i godziny recepcji (materiały studia z 2026-10-13).
// Dwie sale z osobnymi grafikami (reformery i zajęcia grupowe) oraz siłownia z wejściem QR.
import { addDays, localParts, zonedToUtc, type Pool, type ProductRules } from '@glam/core';
import type { Db } from './db.ts';
import { StudioScope } from './scope.ts';
import { bookSession } from './services/booking.ts';
import { awardPoints } from './services/motivation.ts';
import { consumeEntry, loadPass } from './services/passes.ts';
import { fillSchedule } from './services/schedule.ts';
import { loadStudio } from './services/studio.ts';

export const SSG_STUDIO = 'st_ssg';

export const SSG = {
  owner: '+48500000201',
  reception: '+48500000202',
  weronika: '+48500000203',
  albina: '+48500000204',
  basia: '+48500000205',
  magda: '+48500000206',
  ania: '+48500000207',
  piotr: '+48500000208',
  weronikaB: '+48500000209',
  weronikaG: '+48500000211',
  julia: '+48500000212',
  aleksandra: '+48500000213',
  michalina: '+48500000214',
  magdalena: '+48500000215',
  natalia: '+48500000216',
  zuzanna: '+48500000217',
  karolina: '+48500000218',
  paulina: '+48500000219',
};

type Helpers = {
  user: (phone: string, name: string) => string;
  member: (studio: string, userId: string, role: string, joinedDaysAgo?: number, extra?: { bio?: string; goal?: string }) => unknown;
  product: (studio: string, id: string, name: string, price: number, rules: ProductRules, desc: string, sort: number) => void;
  buy: (studio: string, userId: string, productId: string, daysAgo: number, method?: string) => string;
};

const DAY = 86_400_000;
/** Dni wstecz z oddechem Julii (demo kalendarza kwiatków): seria wczoraj–przedwczoraj–3 dni temu, potem luźniej. */
const BREATH_DEMO_DAYS = [1, 2, 3, 5, 6, 8, 9, 10, 13, 15, 16, 20, 22, 23, 27, 30, 34];

export function seedSsg(db: Db, now: Date, { user, member, product, buy }: Helpers) {
  const S = SSG_STUDIO;
  const iso = (d: Date) => d.toISOString();
  const run = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).run(...p);

  run(
    `INSERT INTO studios (id, name, slug, invite_code, tagline, accent, look_json, logo, phone, policy_json, settings_json, guest_pass_price, welcome_approval, plan_id, status, catalog_visible, regulations, created_at)
     VALUES (?, 'SS&G', 'ssg', 'SSG2026', 'Pilates reformer, zajęcia grupowe i siłownia', '#b9cfe0', ?, 'S', '+48 530 333 554', ?, ?, 8000, 0, 'studio', 'active', 1, ?, ?)`,
    S,
    JSON.stringify({ palette: 'sand', fonts: { display: 'playfair', head: 'urbanist', body: 'jakarta', label: 'urbanist' }, softness: 'softer', watermark: '/brand/ssg-watermark.svg' }),
    JSON.stringify({ opensDaysAhead: 14, closesMinutesBefore: 120, cancelMinutesBefore: 120, waitlist: true }),
    JSON.stringify({
      support: {
        hours: {
          slots: [
            { weekday: 1, from: '17:30', to: '21:15' },
            { weekday: 2, from: '07:30', to: '10:15' },
            { weekday: 2, from: '16:30', to: '21:15' },
            { weekday: 3, from: '17:30', to: '20:15' },
            { weekday: 4, from: '07:30', to: '10:15' },
            { weekday: 4, from: '17:30', to: '21:15' },
            { weekday: 5, from: '17:30', to: '20:15' },
            { weekday: 6, from: '08:30', to: '11:15' },
          ],
        },
        autoReply: 'Dzięki za wiadomość! Recepcja odpisze, gdy tylko będzie w studiu. W razie pytań: +48 530 333 554.',
      },
      guestPass: { validityDays: 60, variants: [{ id: 'single', label: 'Jedne zajęcia grupowe', priceGrosze: 8000, entries: 1, classTypeIds: ['ss_split', 'ss_aerial_stretch', 'ss_barre_glow', 'ss_aerial_pilates', 'ss_girly', 'ss_burn', 'ss_yoga_stretch'] }] },
    }),
    'Karnet Open nie obejmuje zajęć na reformerach. Kurs Szpagatu: karnet podstawowy obowiązuje w stałej grupie, karnet Flexy na dowolne grupy kursu.',
    iso(now),
  );

  // ——— Zespół ———
  const owner = user(SSG.owner, 'Właścicielka SS&G');
  const reception = user(SSG.reception, 'Recepcja SS&G');
  const T = {
    weronika: user(SSG.weronika, 'Weronika'),
    albina: user(SSG.albina, 'Albina'),
    basia: user(SSG.basia, 'Basia'),
    magda: user(SSG.magda, 'Magda'),
    ania: user(SSG.ania, 'Ania'),
    piotr: user(SSG.piotr, 'Piotr'),
    weronikaB: user(SSG.weronikaB, 'Weronika B.'),
    weronikaG: user(SSG.weronikaG, 'Weronika G.'),
  };
  member(S, owner, 'owner', 400);
  member(S, reception, 'reception', 300);
  for (const t of Object.values(T)) member(S, t, 'trainer', 200);

  // ——— Obiekt i strefy ———
  run("INSERT INTO facilities (id, studio_id, name) VALUES ('f_ssg', ?, 'SS&G')", S);
  const zone = db.prepare("INSERT INTO zones (id, studio_id, facility_id, name, access) VALUES (?, ?, 'f_ssg', ?, ?)");
  zone.run('z_ss_reformer', S, 'Sala reformerów', 'reserved');
  zone.run('z_ss_group', S, 'Sala zajęć grupowych', 'reserved');
  zone.run('z_ss_gym', S, 'Siłownia', 'checkin');

  // ——— Typy zajęć ———
  const ct = db.prepare('INSERT INTO class_types (id, studio_id, zone_id, name, level, color, description) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const REFORMER: [string, string, string, string, string][] = [
    ['ss_core', 'Core & Mobility', 'wszystkie poziomy', '#c9d8e6', 'Mięśnie głębokie i mobilność stawów na reformerze.'],
    ['ss_classic_basic', 'Pilates Klasyczny', 'podstawowy', '#e4d6c5', 'Klasyczna metoda pilates na reformerze – technika od podstaw.'],
    ['ss_classic_mid', 'Pilates Klasyczny', 'średniozaawansowany', '#d8c3ab', 'Klasyczna metoda pilates na reformerze dla osób z doświadczeniem.'],
    ['ss_ua', 'Reformer w języku ukraińskim', 'wszystkie poziomy', '#e6dcb8', 'Zajęcia na reformerze prowadzone po ukraińsku.'],
    ['ss_hips', 'Unlock Your Hips', 'wszystkie poziomy', '#e9c9cf', 'Otwieranie i wzmacnianie bioder na reformerze.'],
    ['ss_barre_booty', 'Barre & Booty', 'wszystkie poziomy', '#f0cfd8', 'Barre na reformerze z naciskiem na pośladki.'],
    ['ss_barre_stretch', 'Barre & Stretch', 'wszystkie poziomy', '#dcd3ea', 'Barre na reformerze połączone z rozciąganiem.'],
    ['ss_flow', 'Reformer Flow', 'wszystkie poziomy', '#cfe0d6', 'Płynne sekwencje na reformerze.'],
  ];
  const PRIVATE: [string, string, string][] = [
    ['ss_private', 'Lekcja prywatna', 'Indywidualna lekcja na reformerze – termin ustalasz z recepcją.'],
    ['ss_duo', 'Lekcja duo', 'Lekcja na reformerze we dwie – termin ustalasz z recepcją.'],
  ];
  const GROUP: [string, string, string, string, string][] = [
    ['ss_split', 'Kurs Szpagatu', 'wszystkie poziomy', '#f2d9c4', 'Kurs rozciągania prowadzący krok po kroku do szpagatu.'],
    ['ss_aerial_stretch', 'Aerial Stretch', 'wszystkie poziomy', '#d5e3ef', 'Rozciąganie w hamakach.'],
    ['ss_barre_glow', 'Barre & Glow', 'wszystkie poziomy', '#f3e1c9', 'Barre przy drążku – smukła sylwetka i postawa.'],
    ['ss_aerial_pilates', 'Aerial Pilates', 'wszystkie poziomy', '#c6d9e8', 'Pilates w hamakach.'],
    ['ss_girly', 'Girly Pilates', 'wszystkie poziomy', '#f1d3dc', 'Pilates na macie w kobiecym klimacie.'],
    ['ss_burn', 'Spalanie & Modelowanie', 'średnie', '#e8cdb9', 'Trening spalający połączony z modelowaniem sylwetki.'],
    ['ss_yoga_stretch', 'Joga Stretch', 'wszystkie poziomy', '#d6e4d3', 'Joga i głębokie rozciąganie.'],
  ];
  for (const [id, name, level, color, desc] of REFORMER) ct.run(id, S, 'z_ss_reformer', name, level, color, desc);
  for (const [id, name, desc] of PRIVATE) ct.run(id, S, 'z_ss_reformer', name, 'indywidualnie', '#ece4da', desc);
  for (const [id, name, level, color, desc] of GROUP) ct.run(id, S, 'z_ss_group', name, level, color, desc);
  // „Dla kogo” (core/classfit) – karuzela „Dopasowane do Ciebie” w Grafiku.
  const AUDIENCE: Record<string, object> = {
    ss_core: { level: 'all', focus: ['strength', 'posture'], forWhom: ['back', 'return'] },
    ss_classic_basic: { level: 'beginner', focus: ['posture', 'strength'], forWhom: ['return'] },
    ss_classic_mid: { level: 'intermediate', focus: ['strength', 'posture'], forWhom: [] },
    ss_hips: { level: 'all', focus: ['stretch', 'posture'], forWhom: ['back'] },
    ss_barre_booty: { level: 'all', focus: ['strength', 'energy'], forWhom: [] },
    ss_barre_stretch: { level: 'all', focus: ['stretch', 'strength'], forWhom: [] },
    ss_flow: { level: 'all', focus: ['calm', 'stretch'], forWhom: ['return'] },
    ss_split: { level: 'intermediate', focus: ['stretch'], forWhom: [] },
    ss_aerial_stretch: { level: 'all', focus: ['stretch', 'calm'], forWhom: [] },
    ss_barre_glow: { level: 'all', focus: ['posture', 'strength'], forWhom: [] },
    ss_aerial_pilates: { level: 'intermediate', focus: ['strength'], forWhom: [] },
    ss_girly: { level: 'beginner', focus: ['strength', 'calm'], forWhom: ['postnatal', 'return'] },
    ss_burn: { level: 'advanced', focus: ['energy', 'strength'], forWhom: [] },
    ss_yoga_stretch: { level: 'all', focus: ['calm', 'stretch'], forWhom: ['gentle', 'back'] },
  };
  const aud = db.prepare('UPDATE class_types SET audience_json = ? WHERE id = ?');
  for (const [id, a] of Object.entries(AUDIENCE)) aud.run(JSON.stringify(a), id);
  const REFORMER_IDS = REFORMER.map(([id]) => id);
  const GROUP_IDS = GROUP.map(([id]) => id);

  // ——— Harmonogram (1 = poniedziałek) ———
  const tpl = db.prepare(
    "INSERT INTO schedule_templates (id, studio_id, class_type_id, trainer_id, weekday, start_time, duration_min, capacity, valid_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01')",
  );
  const AERIAL = new Set(['ss_aerial_stretch', 'ss_aerial_pilates']);
  const capacity = (classTypeId: string) => (REFORMER_IDS.includes(classTypeId) ? 8 : AERIAL.has(classTypeId) ? 8 : 12);
  const SLOTS: [number, string, string, keyof typeof T][] = [
    // Reformery
    [1, '08:00', 'ss_core', 'weronika'],
    [1, '09:00', 'ss_ua', 'albina'],
    [1, '18:00', 'ss_hips', 'weronika'],
    [1, '19:00', 'ss_classic_mid', 'basia'],
    [1, '20:00', 'ss_barre_booty', 'weronika'],
    [2, '08:00', 'ss_classic_basic', 'basia'],
    [2, '17:00', 'ss_ua', 'albina'],
    [2, '18:00', 'ss_hips', 'basia'],
    [2, '19:00', 'ss_barre_stretch', 'weronika'],
    [2, '20:00', 'ss_barre_booty', 'weronika'],
    [3, '09:00', 'ss_ua', 'albina'],
    [3, '18:00', 'ss_flow', 'magda'],
    [3, '19:00', 'ss_hips', 'magda'],
    [4, '08:00', 'ss_hips', 'basia'],
    [4, '18:00', 'ss_barre_stretch', 'weronika'],
    [4, '20:00', 'ss_hips', 'weronika'],
    [5, '09:00', 'ss_ua', 'albina'],
    [5, '19:00', 'ss_flow', 'magda'],
    [6, '09:00', 'ss_flow', 'magda'],
    [6, '10:00', 'ss_hips', 'magda'],
    // Zajęcia grupowe
    [1, '18:00', 'ss_split', 'weronikaB'],
    [1, '19:00', 'ss_aerial_pilates', 'weronika'],
    [1, '20:00', 'ss_girly', 'magda'],
    [2, '09:00', 'ss_split', 'ania'],
    [2, '17:00', 'ss_aerial_stretch', 'weronika'],
    [2, '18:00', 'ss_barre_glow', 'weronika'],
    [2, '19:00', 'ss_split', 'ania'],
    [3, '18:00', 'ss_burn', 'piotr'],
    [3, '18:00', 'ss_yoga_stretch', 'weronika'],
    [3, '19:00', 'ss_girly', 'basia'],
    [4, '09:00', 'ss_split', 'weronikaG'],
    [4, '19:00', 'ss_split', 'basia'],
    [5, '18:00', 'ss_girly', 'weronika'],
    [6, '09:00', 'ss_aerial_pilates', 'weronika'],
  ];
  const qualified = new Set<string>();
  SLOTS.forEach(([weekday, time, classType, trainer], i) => {
    tpl.run(`ss_t${i + 1}`, S, classType, T[trainer], weekday, time, 55, capacity(classType));
    qualified.add(`${T[trainer]}|${classType}`);
  });
  for (const key of qualified) {
    const [trainerId, classTypeId] = key.split('|');
    run('INSERT INTO trainer_class_types (studio_id, trainer_id, class_type_id) VALUES (?, ?, ?)', S, trainerId, classTypeId);
  }

  // ——— Cennik: pilates reformer ———
  const pool = (entries: number, classTypeIds: string[], label: string): Pool[] => [{ id: 'main', label, entries, classTypeIds }];
  const reformerPass = (entries: number): ProductRules => ({ validityDays: 30, pools: pool(entries, REFORMER_IDS, 'Reformer') });
  product(S, 'ss_ref1', 'Reformer – pojedyncze wejście', 12000, reformerPass(1), 'Jedne zajęcia na reformerze.', 1);
  product(S, 'ss_ref4', 'Reformer – karnet 4 wejścia', 44000, reformerPass(4), 'Cztery zajęcia na reformerze.', 2);
  product(S, 'ss_ref8', 'Reformer – karnet 8 wejść', 75000, reformerPass(8), 'Osiem zajęć na reformerze.', 3);
  product(S, 'ss_ref10', 'Reformer – karnet 10 wejść', 90000, reformerPass(10), 'Dziesięć zajęć na reformerze.', 4);
  product(S, 'ss_private1', 'Lekcja prywatna', 18000, { validityDays: 30, pools: pool(1, ['ss_private'], 'Lekcja prywatna') }, 'Indywidualna lekcja na reformerze.', 5);
  product(S, 'ss_duo1', 'Lekcja duo', 30000, { validityDays: 30, pools: pool(1, ['ss_duo'], 'Lekcja duo') }, 'Lekcja na reformerze dla dwóch osób – cena za lekcję.', 6);

  // ——— Cennik: zajęcia grupowe ———
  const groupPass = (entries: number, classTypeIds: string[], label: string, validityDays = 30, extra: Partial<ProductRules> = {}): ProductRules => ({ validityDays, ...extra, pools: pool(entries, classTypeIds, label) });
  product(S, 'ss_split8', 'Kurs Szpagatu – 8 wejść', 25000, groupPass(8, ['ss_split'], 'Kurs Szpagatu', 56, { weeklyLimit: 1 }), 'Osiem spotkań w Twojej stałej grupie kursu (raz w tygodniu).', 10);
  product(S, 'ss_flexy', 'Karnet Flexy – Kurs Szpagatu', 36000, groupPass(8, ['ss_split'], 'Kurs Szpagatu', 42), 'Ważny 6 tygodni: 8 wejść na Kurs Szpagatu bez ograniczeń grupowych.', 11);
  product(S, 'ss_yb4', 'Joga Stretch + Barre & Glow – 4 wejścia', 16000, groupPass(4, ['ss_yoga_stretch', 'ss_barre_glow'], 'Joga Stretch / Barre & Glow'), 'Cztery wejścia na Joga Stretch lub Barre & Glow.', 12);
  product(S, 'ss_yb8', 'Joga Stretch + Barre & Glow – 8 wejść', 22000, groupPass(8, ['ss_yoga_stretch', 'ss_barre_glow'], 'Joga Stretch / Barre & Glow'), 'Osiem wejść na Joga Stretch lub Barre & Glow.', 13);
  product(S, 'ss_girly4', 'Girly Pilates – 4 wejścia', 20000, groupPass(4, ['ss_girly'], 'Girly Pilates'), 'Cztery wejścia na Girly Pilates.', 14);
  product(S, 'ss_girly8', 'Girly Pilates – 8 wejść', 25000, groupPass(8, ['ss_girly'], 'Girly Pilates'), 'Osiem wejść na Girly Pilates.', 15);
  product(S, 'ss_aerial4', 'Aerial – 4 wejścia', 23000, groupPass(4, ['ss_aerial_pilates', 'ss_aerial_stretch'], 'Aerial'), 'Cztery wejścia na Aerial Pilates lub Aerial Stretch.', 16);
  product(S, 'ss_aerial8', 'Aerial – 8 wejść', 35000, groupPass(8, ['ss_aerial_pilates', 'ss_aerial_stretch'], 'Aerial'), 'Osiem wejść na Aerial Pilates lub Aerial Stretch.', 17);
  product(S, 'ss_burn4', 'Spalanie & Modelowanie – 4 wejścia', 22000, groupPass(4, ['ss_burn'], 'Spalanie & Modelowanie'), 'Cztery wejścia na Spalanie & Modelowanie.', 18);
  product(S, 'ss_glow4', 'Back to school & Glow – 4 wejścia', 30000, groupPass(4, GROUP_IDS, 'Zajęcia grupowe'), 'Promocja: cztery wejścia na dowolne zajęcia grupowe.', 19);
  product(S, 'ss_glow6', 'Back to school & Glow – 6 wejść', 42000, groupPass(6, GROUP_IDS, 'Zajęcia grupowe'), 'Promocja: sześć wejść na dowolne zajęcia grupowe.', 20);
  product(S, 'ss_single', 'Pojedyncze wejście', 8000, { validityDays: 30, pools: [{ id: 'main', label: 'Wejście', entries: 1, classTypeIds: 'all', zoneIds: ['z_ss_group', 'z_ss_gym'] }] }, 'Jedno wejście na dowolne zajęcia grupowe albo na siłownię.', 21);
  product(S, 'ss_open', 'Karnet Open', 65000, { validityDays: 28, unlimited: { zoneIds: ['z_ss_group', 'z_ss_gym'], classTypeIds: 'all' } }, 'Ważny 4 tygodnie: wszystkie zajęcia grupowe bez limitu + siłownia. Nie obejmuje reformerów.', 22);
  product(S, 'ss_gym', 'Siłownia', 15000, { validityDays: 30, unlimited: { zoneIds: ['z_ss_gym'], classTypeIds: 'all' } }, 'Miesiąc na siłowni, wejście z kodem QR.', 23);
  product(S, 'ss_gym_club', 'Siłownia dla klubowiczów', 12000, { validityDays: 30, unlimited: { zoneIds: ['z_ss_gym'], classTypeIds: 'all' } }, 'Cena dla osób z aktywnym karnetem w SS&G – sprzedaż w recepcji.', 24);
  run(`UPDATE products SET channels_json = '["desk"]' WHERE id = 'ss_gym_club'`);

  // ——— Grafik: 3 tygodnie wstecz i 4 do przodu ———
  const scope = new StudioScope(db, S);
  const studio = loadStudio(db, S);
  fillSchedule(scope, studio, new Date(now.getTime() - 21 * DAY), 49);

  // ——— Klientki demo: karnet na reformery, 2 wizyty za nią, jedna rezerwacja ———
  // lastVisitDaysAgo: ostatnia wizyta nie później niż tyle dni temu (0 = najświeższe zajęcia przed teraz).
  const client = (phone: string, name: string, goal: string, productId: string, visited: string, upcoming: string, lastVisitDaysAgo = 0) => {
    const id = user(phone, name);
    member(S, id, 'client', 30, { goal });
    run("INSERT OR REPLACE INTO consents (user_id, studio_id, kind, granted, updated_at) VALUES (?, '', 'terms', 1, ?)", id, iso(now));
    run('UPDATE users SET onboarded_at = ? WHERE id = ?', iso(new Date(now.getTime() - 30 * DAY)), id);
    const passId = buy(S, id, productId, 12);
    const past = scope.all<{ id: string }>(
      'SELECT id FROM class_sessions WHERE studio_id = $studio AND class_type_id = $ct AND starts_at < $now AND starts_at > $from ORDER BY starts_at DESC LIMIT 2',
      { ct: visited, now: iso(new Date(now.getTime() - lastVisitDaysAgo * DAY)), from: iso(new Date(now.getTime() - 11 * DAY)) },
    );
    for (const s of past) {
      const pass = loadPass(scope, passId)!;
      const bookingId = crypto.randomUUID();
      scope.run(
        "INSERT INTO bookings (id, studio_id, session_id, user_id, pass_id, pool_id, status, created_at, updated_at) VALUES ($id, $studio, $s, $u, $p, 'main', 'attended', $t, $t)",
        { id: bookingId, s: s.id, u: id, p: passId, t: iso(now) },
      );
      consumeEntry(scope, pass, 'main');
      // Punkty jak przy prawdziwym zaliczeniu zajęć – inaczej Start pokazuje 0 pkt mimo wizyt.
      awardPoints(scope, studio, id, 'training', bookingId, studio.settings.loyalty.points.training, now);
    }
    const next = scope.get<{ id: string }>(
      "SELECT id FROM class_sessions WHERE studio_id = $studio AND class_type_id = $ct AND status = 'scheduled' AND starts_at > $min ORDER BY starts_at LIMIT 1",
      { ct: upcoming, min: iso(new Date(now.getTime() + 3 * 3_600_000)) },
    );
    if (next) bookSession(scope, studio, id, next.id, now);
    return { id, passId };
  };
  const julia = client(SSG.julia, 'Julia', 'Mocne biodra i lepsza postawa', 'ss_ref8', 'ss_hips', 'ss_flow');
  const aleksandra = client(SSG.aleksandra, 'Aleksandra', 'Elastyczność i rozciągnięte plecy', 'ss_ref10', 'ss_flow', 'ss_hips', 3);
  const michalina = client(SSG.michalina, 'Michalina', 'Silny brzuch po ciąży', 'ss_ref8', 'ss_flow', 'ss_barre_stretch');
  const natalia = client(SSG.natalia, 'Natalia', 'Powrót do formy po kontuzji kolana', 'ss_ref4', 'ss_core', 'ss_classic_basic', 2);
  const zuzanna = client(SSG.zuzanna, 'Zuzanna', 'Szpagat przed wakacjami', 'ss_flexy', 'ss_split', 'ss_split');
  const karolina = client(SSG.karolina, 'Karolina', 'Mniej stresu i spokojniejszy sen', 'ss_yb8', 'ss_yoga_stretch', 'ss_barre_glow', 5);
  const paulina = client(SSG.paulina, 'Paulina', 'Silne ramiona i pewność w hamaku', 'ss_aerial8', 'ss_aerial_pilates', 'ss_aerial_stretch');

  // ——— Rytuał oddechu Julii: kilka tygodni kwiatków w kalendarzu „Dla mnie”, seria 3 dni; dziś jeszcze czeka ———
  for (const d of BREATH_DEMO_DAYS)
    run(
      "INSERT INTO mindful_logs (id, studio_id, user_id, kind, ref, minutes, completed_at) VALUES (?, ?, ?, 'breath', 'calm', 3, ?)",
      crypto.randomUUID(), S, julia.id, iso(new Date(now.getTime() - d * DAY)),
    );

  // ——— Dziś na liście: Aleksandra na Reformerze po ukraińsku, Michalina na Girly Pilates ———
  // Zapis wprost (bez okna zapisów): poranne zajęcia mogą już trwać, gdy dane demo się wgrywają.
  const today = localParts(now, studio.timezone).date;
  const bookToday = (userId: string, passId: string, classTypeId: string) => {
    const s = scope.get<{ id: string }>(
      "SELECT id FROM class_sessions WHERE studio_id = $studio AND class_type_id = $ct AND status = 'scheduled' AND starts_at >= $from AND starts_at < $to ORDER BY starts_at LIMIT 1",
      { ct: classTypeId, from: zonedToUtc(today, '00:00', studio.timezone).toISOString(), to: zonedToUtc(today, '23:59', studio.timezone).toISOString() },
    );
    if (!s) return;
    scope.run(
      "INSERT INTO bookings (id, studio_id, session_id, user_id, pass_id, pool_id, status, created_at, updated_at) VALUES ($id, $studio, $s, $u, $p, 'main', 'booked', $t, $t)",
      { id: crypto.randomUUID(), s: s.id, u: userId, p: passId, t: iso(now) },
    );
    consumeEntry(scope, loadPass(scope, passId)!, 'main');
  };
  bookToday(aleksandra.id, aleksandra.passId, 'ss_ua');
  bookToday(michalina.id, buy(S, michalina.id, 'ss_girly4', 2), 'ss_girly');

  // ——— Wiadomości: dwie rozpoczęte rozmowy o zajęciach; ostatnia wiadomość klientki czeka na odpowiedź ———
  const chat = (clientId: string, lines: [fromStaff: boolean, body: string, hoursAgo: number][]) =>
    lines.forEach(([staff, body, h], i) => {
      const at = iso(new Date(now.getTime() - h * 3_600_000));
      const last = i === lines.length - 1;
      run(
        'INSERT INTO chat_messages (id, studio_id, client_id, author_id, from_staff, body, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        crypto.randomUUID(), S, clientId, staff ? reception : clientId, staff ? 1 : 0, body, at, last && !staff ? null : at,
      );
    });
  chat(natalia.id, [
    [false, 'Dzień dobry! Pół roku temu miałam kontuzję kolana. Czy Pilates Klasyczny na reformerze będzie dla mnie dobry na start?', 26],
    [true, 'Dzień dobry Natalio! Tak, poziom podstawowy jest spokojny i dużo ćwiczy się w leżeniu, więc kolano nie jest obciążone. Daj znać trenerce przed zajęciami – dobierze sprężyny i pokaże zamienniki ćwiczeń 💛', 25],
    [false, 'Super, dziękuję! A czy po zajęciach Core & Mobility mogę od razu iść na Klasyczny, czy lepiej zrobić dzień przerwy?', 2],
  ]);
  chat(zuzanna.id, [
    [false, 'Hej! Chodzę na Kurs Szpagatu we wtorki. Czy z karnetem Flexy mogę w tym tygodniu przyjść w czwartek zamiast wtorku?', 20],
    [true, 'Hej Zuzanno! Tak, Flexy działa na każdą grupę kursu, więc czwartek jest jak najbardziej ok. Zapisz się w aplikacji, póki są miejsca 🙂', 19],
    [false, 'Zapisane! Czy na czwartek mam wziąć coś do rozciągania, np. klocki albo pasek?', 1],
  ]);

  // ——— Prośba o termin: Magdalena czeka na wolne miejsce na dzisiejszą Joga Stretch o 18:00 ———
  const magdalena = user(SSG.magdalena, 'Magdalena');
  member(S, magdalena, 'client', 45, { goal: 'Rozciąganie i spokojna głowa po pracy' });
  run("INSERT OR REPLACE INTO consents (user_id, studio_id, kind, granted, updated_at) VALUES (?, '', 'terms', 1, ?)", magdalena, iso(now));
  run('UPDATE users SET onboarded_at = ? WHERE id = ?', iso(new Date(now.getTime() - 45 * DAY)), magdalena);
  run(
    "INSERT INTO dormant_surveys (id, studio_id, user_id, reasons_json, comment, wants_proposal, status, created_at, answered_at, contact_due_at) VALUES ('ss_ds1', ?, ?, '[\"time\"]', ?, 1, 'answered', ?, ?, ?)",
    S,
    magdalena,
    'Czekam na wolne miejsce na Joga Stretch dziś o 18:00.',
    iso(new Date(now.getTime() - 2 * 3_600_000)),
    iso(new Date(now.getTime() - 3_600_000)),
    iso(zonedToUtc(today, '17:00', studio.timezone)),
  );

  // ——— Grupy (Razem → Grupy): dwie wokół zajęć studia, każda z trenerką-opiekunką i rozmową na czacie ———
  const group = (id: string, name: string, description: string, trainer: string, members: string[], chat: [string, string, number][]) => {
    run('INSERT INTO groups (id, studio_id, name, description, approval, trainer_id, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)', id, S, name, description, trainer, iso(new Date(now.getTime() - 20 * DAY)));
    members.forEach((u, i) => run('INSERT INTO group_members (studio_id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)', S, id, u, iso(new Date(now.getTime() - (18 - i * 3) * DAY))));
    chat.forEach(([author, body, hoursAgo], i) =>
      run('INSERT INTO group_chat (id, studio_id, group_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', `${id}_m${i + 1}`, S, id, author, body, iso(new Date(now.getTime() - hoursAgo * 3_600_000))),
    );
  };
  group('ss_g_morning', 'Reformer o poranku', 'Pilates Klasyczny i Core & Mobility przed pracą – motywujemy się do wczesnych zajęć.', T.basia, [julia.id, natalia.id, aleksandra.id], [
    [T.basia, 'Dzień dobry, dziewczyny ☀️ W tym tygodniu na porannym Pilatesie skupiamy się na oddechu i stabilizacji miednicy.', 32],
    [natalia.id, 'Kto będzie jutro na Pilatesie Klasycznym? Pierwszy raz idę tak wcześnie 🙈', 30],
    [julia.id, 'Ja! Weź skarpetki antypoślizgowe i nic się nie martw – po 10 minutach budzi się całe ciało ☀️', 28],
    [T.basia, 'Natalia, super! Przyjdź 10 minut wcześniej, pokażę Ci reformer na spokojnie.', 27],
    [aleksandra.id, 'Polecam po zajęciach matchę w recepcji, idealny start dnia 🍵', 5],
  ]);
  group('ss_g_split', 'Droga do szpagatu', 'Kurs Szpagatu i Joga Stretch – dzielimy się postępami i dobrym słowem.', T.weronika, [zuzanna.id, karolina.id, paulina.id], [
    [zuzanna.id, 'Dziś pierwszy raz dotknęłam podłogi w szpagacie wzdłużnym! Pół roku temu brakowało 20 cm 🥹', 22],
    [T.weronika, 'Zuzanna, brawo!! To efekt Twojej regularności 💛', 21],
    [paulina.id, 'Gratulacje!! Ja wciąż walczę z poprzecznym, ale Aerial Stretch bardzo pomaga.', 20],
    [karolina.id, 'Mój sposób: 10 minut rozciągania wieczorem z kwiatkiem w „Dla mnie” – i od razu lepiej śpię 🌸', 3],
  ]);

  // Dwie prośby o dołączenie czekające w panelu (Społeczność → Grupy).
  const request = (groupId: string, userId: string, message: string, hoursAgo: number) =>
    run("INSERT INTO group_requests (studio_id, group_id, user_id, message, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)", S, groupId, userId, message, iso(new Date(now.getTime() - hoursAgo * 3_600_000)));
  request('ss_g_morning', michalina.id, 'Chcę wrócić do porannych treningów przed pracą – razem łatwiej się zmobilizować 🙂', 6);
  request('ss_g_split', magdalena, 'Od dawna marzę o szpagacie, a rozciąganie po pracy bardzo mnie uspokaja 🌿', 2);

  // ——— Wyzwanie od Weroniki dla grupy „Reformer w języku ukraińskim” ———
  // Julia i Natalia zapisane na najbliższy reformer po ukraińsku (Aleksandra jest na dzisiejszym).
  const nextUa = scope.get<{ id: string }>(
    "SELECT id FROM class_sessions WHERE studio_id = $studio AND class_type_id = 'ss_ua' AND status = 'scheduled' AND starts_at > $min ORDER BY starts_at LIMIT 1",
    { min: iso(new Date(now.getTime() + 24 * 3_600_000)) },
  );
  if (nextUa)
    for (const c of [julia, natalia]) {
      scope.run(
        "INSERT INTO bookings (id, studio_id, session_id, user_id, pass_id, pool_id, status, created_at, updated_at) VALUES ($id, $studio, $s, $u, $p, 'main', 'booked', $t, $t)",
        { id: crypto.randomUUID(), s: nextUa.id, u: c.id, p: c.passId, t: iso(now) },
      );
      consumeEntry(scope, loadPass(scope, c.passId)!, 'main');
    }
  run(
    "INSERT INTO challenges (id, studio_id, title, description, metric, target, starts_on, ends_on, author_id, class_type_id, created_at) VALUES ('ss_ch_home10', ?, '10 serii w domu', ?, 'checkins', 10, ?, ?, ?, 'ss_ua', ?)",
    S,
    'Przed każdym treningiem zrób w domu jedną serię: 10 przysiadów, 10 mostków biodrowych i 10 martwych robaków. Odhacz w aplikacji – 10 serii do końca wyzwania.\n\nПеред кожним тренуванням зроби вдома одну серію і відміть її в застосунку.',
    addDays(today, -3),
    addDays(today, 25),
    T.weronika,
    iso(new Date(now.getTime() - 3 * DAY)),
  );
  const joined: [string, number][] = [[aleksandra.id, 3], [julia.id, 1], [natalia.id, 2]];
  for (const [u, done] of joined) {
    run("INSERT INTO challenge_members (studio_id, challenge_id, user_id, joined_at) VALUES (?, 'ss_ch_home10', ?, ?)", S, u, iso(new Date(now.getTime() - 3 * DAY)));
    for (let d = 1; d <= done; d++) run("INSERT INTO challenge_checkins (studio_id, challenge_id, user_id, date) VALUES (?, 'ss_ch_home10', ?, ?)", S, u, addDays(today, -d));
  }

  // ——— Kartki po pierwszym miesiącu: Julia i Michalina są w studiu od 30 dni ———
  // Propozycja treści do przepisania odręcznie – trenerka i tak pisze po swojemu.
  const card = (id: string, clientId: string, trainerId: string, draft: string) =>
    run(
      "INSERT INTO card_tasks (id, studio_id, trainer_id, client_id, due_on, delivery, status, draft, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pickup', 'todo', ?, ?, ?)",
      id, S, trainerId, clientId, localParts(new Date(now.getTime() + 3 * DAY), studio.timezone).date, draft, iso(now), iso(now),
    );
  card(
    'ss_ct_julia', julia.id, T.magda,
    'Julio, minął Twój pierwszy miesiąc z nami – gratuluję! Każde wejście na reformer to krok do mocniejszych bioder i lepszej postawy, a Ty robisz te kroki regularnie. Dziękuję, że mi zaufałaś i dajesz sobie ten czas. Do zobaczenia na sali! Magda',
  );
  card(
    'ss_ct_michalina', michalina.id, T.weronika,
    'Michalino, cały miesiąc treningów za Tobą – brawo! Po ciąży to wymaga cierpliwości, a Ty przychodzisz i robisz swoje, spokojnie i konsekwentnie. Dziękuję za zaufanie i za każdą godzinę, którą dajesz sobie na sali. Trzymam kciuki za kolejny miesiąc! Weronika',
  );

  // ——— Sklep (z Instagrama studia, ceny od studia 2026-10-16) ———
  // Rozmiary i stany do uzupełnienia w panelu: Sklep → Produkty i stany.
  const shopItem = (id: string, category: 'drink' | 'accessory' | 'apparel', name: string, price: number, desc: string, sort: number) =>
    run("INSERT INTO shop_products (id, studio_id, category, name, description, price_grosze, status, variants_json, reward_eligible, created_at) VALUES (?, ?, ?, ?, ?, ?, 'available', ?, 0, ?)", id, S, category, name, desc, price, JSON.stringify([{ id: 'std', stock: 10 }]), iso(new Date(now.getTime() + sort * 1000)));
  shopItem('ss_sp_socks', 'accessory', 'Skarpety antypoślizgowe', 4900, 'Do pilatesu, reformerów i stretchingu.', 1);
  shopItem('ss_sp_matcha', 'drink', 'Glow&Grow Coco Matcha', 3900, 'Nasz limitowany napój z matchą od Moshi Matcha.', 2);
  shopItem('ss_sp_carpatree', 'apparel', 'Strój Carpatree – zestaw', 13900, 'Komplet do treningu marki Carpatree.', 3);

  seedHalloween(db, now, owner, T.weronika);
}

/** Wydarzenie studia: Halloween Flow / Glow in the Dark Pilates, 31.10 wieczorem w sali zajęć grupowych. */
export function seedHalloween(db: Db, now: Date, organizerId: string, trainerId: string) {
  const studio = loadStudio(db, SSG_STUDIO);
  const date = `${localParts(now, studio.timezone).date.slice(0, 4)}-10-31`;
  const at = now.toISOString();
  db.prepare(
    `INSERT INTO private_events (id, studio_id, client_id, kind, title, trainer_id, zone_id, activity, starts_at, ends_at, guests, addons_json, internal_note, status, price_grosze, payment_mode, offer_text, invite_code, terms_accepted_at, history_json, created_at, updated_at)
     VALUES ('ss_ev_halloween', ?, ?, 'girls_night', 'Halloween Flow / Glow in the Dark Pilates', ?, 'z_ss_group', 'Mat', ?, ?, 12, '["playlist","decor"]', ?, 'confirmed', NULL, 'on_site', ?, 'SSGHALL', ?, ?, ?, ?)`,
  ).run(
    SSG_STUDIO,
    organizerId,
    trainerId,
    zonedToUtc(date, '19:00', studio.timezone).toISOString(),
    zonedToUtc(date, '20:15', studio.timezone).toISOString(),
    'Lampy UV i świecące opaski kupić do 29.10, dekoracje sali dzień wcześniej po ostatnich zajęciach.',
    'Pilates na macie przy świetle UV: neonowe dekoracje, halloweenowa playlista i świecące opaski dla każdej uczestniczki. Ubierz się na biało albo neonowo – będzie świecić! Wstęp 80 zł / os., płatność na miejscu.',
    at,
    JSON.stringify([{ by: 'Recepcja SS&G', text: 'Wydarzenie studia dodane: 12 miejsc, 80 zł / os.', at }]),
    at,
    at,
  );
}
