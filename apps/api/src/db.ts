// Baza: wbudowany node:sqlite (zero zależności na MVP). Model danych od początku zakłada
// wiele studiów (najemców): każdy rekord studia ma kolumnę studio_id (sekcja 1.2.3).
// Dane zdrowotne (dziennik, pomiary, cykl, ankieta zdrowia) trzymamy zaszyfrowane (*_enc, crypto.ts).
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { imageRatio } from './services/image.ts';
import { attachMediaDir, mediaDir, moveVideoBlobsToDisk } from './services/media-files.ts';

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_grosze INTEGER NOT NULL,
  limits_json TEXT NOT NULL,
  features_json TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS studios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  invite_code TEXT NOT NULL UNIQUE,
  city TEXT,
  tagline TEXT,
  accent TEXT NOT NULL DEFAULT '#9b8570',
  look_json TEXT,
  logo_mime TEXT,
  logo_data BLOB,
  logo_ratio REAL,
  logo_version INTEGER NOT NULL DEFAULT 0,
  logo TEXT NOT NULL DEFAULT 'G',
  phone TEXT,
  email TEXT,
  address TEXT,
  nip TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  policy_json TEXT NOT NULL,
  settings_json TEXT,
  regulations TEXT,
  gateway_enc TEXT,
  guest_pass_price INTEGER NOT NULL DEFAULT 4900,
  welcome_approval INTEGER NOT NULL DEFAULT 0,
  plan_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'suspended')),
  trial_ends_at TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  catalog_visible INTEGER NOT NULL DEFAULT 0,
  founded_on TEXT,
  white_label_json TEXT,
  -- Strona internetowa (core/site.ts): szkic z edytora i wersja publiczna
  site_draft_json TEXT,
  site_draft_updated_at TEXT,
  site_json TEXT,
  site_published_at TEXT,
  -- Własna domena strony (services/domain.ts): bez www i bez protokołu, np. studio.pl – obsługuje też www.studio.pl
  custom_domain TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS studio_features (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  flag TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  PRIMARY KEY (studio_id, flag)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  birthday TEXT,
  nameday TEXT,
  theme_opt_out INTEGER NOT NULL DEFAULT 0,
  need_quiet INTEGER NOT NULL DEFAULT 0,
  rest_day TEXT,
  push_disabled_json TEXT NOT NULL DEFAULT '[]',
  quiet_from TEXT NOT NULL DEFAULT '22:00',
  quiet_to TEXT NOT NULL DEFAULT '07:00',
  prefs_json TEXT,
  address_enc TEXT,
  avatar_mime TEXT,
  avatar_data BLOB,
  avatar_version INTEGER NOT NULL DEFAULT 0,
  onboarded_at TEXT,
  calendar_token TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_calendar ON users (calendar_token) WHERE calendar_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS memberships (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('client', 'trainer', 'reception', 'owner', 'coordinator')),
  bio TEXT,
  about TEXT,               -- opis własny trenerki (dłuższy niż bio; strona WWW i profil w aplikacji)
  intro_video_id TEXT,      -- film „poznajmy się” z profilu trenerki (media, rodzaj 'intro')
  goal TEXT,
  trainer_id TEXT,
  prefs_json TEXT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (studio_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS consents (
  user_id TEXT NOT NULL REFERENCES users(id),
  studio_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  granted INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, studio_id, kind)
);

CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  window_started INTEGER NOT NULL,
  sends_in_window INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL DEFAULT 'sms'
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device TEXT,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS phone_changes (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  new_phone TEXT NOT NULL,
  old_code_hash TEXT NOT NULL,
  new_code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,
  algorithm INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facilities (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  name TEXT NOT NULL,
  address TEXT,
  hours_json TEXT
);

CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  name TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('reserved', 'open', 'checkin', 'mixed'))
);

CREATE TABLE IF NOT EXISTS class_types (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  zone_id TEXT NOT NULL REFERENCES zones(id),
  name TEXT NOT NULL,
  level TEXT,
  color TEXT NOT NULL DEFAULT '#e8b4c4',
  description TEXT,
  photo_mime TEXT,
  photo_data BLOB,
  photo_version INTEGER NOT NULL DEFAULT 0,
  photo_ratio REAL,
  playlist_id TEXT,
  -- kiedy zajęcia weszły do oferty (nowości na stronie); NULL = sprzed wprowadzenia tej kolumny
  created_at TEXT
);
-- Data dodania wypełnia się sama, niezależnie od miejsca, które wstawia zajęcia (panel, presety, import)
CREATE TRIGGER IF NOT EXISTS trg_class_types_created AFTER INSERT ON class_types WHEN NEW.created_at IS NULL BEGIN UPDATE class_types SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TABLE IF NOT EXISTS trainer_class_types (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  trainer_id TEXT NOT NULL REFERENCES users(id),
  class_type_id TEXT NOT NULL REFERENCES class_types(id),
  PRIMARY KEY (studio_id, trainer_id, class_type_id)
);

CREATE TABLE IF NOT EXISTS schedule_templates (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  class_type_id TEXT NOT NULL REFERENCES class_types(id),
  trainer_id TEXT NOT NULL REFERENCES users(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT
);

CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  date TEXT NOT NULL,
  zone_id TEXT REFERENCES zones(id),
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trainer_absences (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  trainer_id TEXT NOT NULL REFERENCES users(id),
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS class_sessions (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  template_id TEXT REFERENCES schedule_templates(id),
  class_type_id TEXT NOT NULL REFERENCES class_types(id),
  trainer_id TEXT NOT NULL REFERENCES users(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  kind TEXT NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'themed', 'special', 'event', 'live')),
  title TEXT,
  theme_id TEXT,
  playlist_id TEXT,
  substitute_for TEXT,
  public INTEGER NOT NULL DEFAULT 1,
  UNIQUE (template_id, starts_at)
);
CREATE INDEX IF NOT EXISTS idx_sessions_studio_time ON class_sessions (studio_id, starts_at);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  name TEXT NOT NULL,
  description TEXT,
  current_version_id TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  channels_json TEXT NOT NULL DEFAULT '["app","desk"]',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_versions (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  price_grosze INTEGER NOT NULL,
  rules_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passes (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  product_version_id TEXT REFERENCES product_versions(id),
  product_name TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  balances_json TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'frozen', 'expired', 'used', 'pending')),
  source TEXT NOT NULL CHECK (source IN ('purchase', 'desk', 'guest_pass', 'referral', 'reward', 'renewal', 'import', 'test')),
  auto_renew INTEGER NOT NULL DEFAULT 0,
  frozen_until TEXT,
  freezes_used INTEGER NOT NULL DEFAULT 0,
  freeze_days_used INTEGER NOT NULL DEFAULT 0,
  guests_used_json TEXT NOT NULL DEFAULT '{}',
  notice_seen_version INTEGER,
  activated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pass_freezes (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  pass_id TEXT NOT NULL REFERENCES passes(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('vacation', 'illness', 'pregnancy', 'loss', 'other')),
  wants_support INTEGER NOT NULL DEFAULT 0,
  ended_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  session_id TEXT NOT NULL REFERENCES class_sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  pass_id TEXT REFERENCES passes(id),
  pool_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('booked', 'waitlist', 'cancelled', 'late_cancel', 'attended', 'no_show')),
  party_id TEXT,
  guest_name TEXT,
  guest_phone TEXT,
  recurring_id TEXT,
  source TEXT NOT NULL DEFAULT 'app',
  confirmed_at TEXT,
  rating INTEGER,
  rating_comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_active ON bookings (session_id, user_id)
  WHERE status IN ('booked', 'waitlist', 'attended') AND guest_name IS NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (studio_id, user_id);

CREATE TABLE IF NOT EXISTS zone_checkins (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  zone_id TEXT NOT NULL REFERENCES zones(id),
  pass_id TEXT REFERENCES passes(id),
  by_user TEXT,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_bookings (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  template_id TEXT NOT NULL REFERENCES schedule_templates(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (studio_id, user_id, template_id)
);

CREATE TABLE IF NOT EXISTS session_invites (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  session_id TEXT NOT NULL REFERENCES class_sessions(id),
  from_user TEXT NOT NULL REFERENCES users(id),
  to_user TEXT REFERENCES users(id),
  to_phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'accepted', 'declined')),
  created_at TEXT NOT NULL
);

-- Zaproszenia trenerki na jej własne zajęcia: krótka notka przy terminie, widoczna w aplikacji (Start, profil trenerki).
CREATE TABLE IF NOT EXISTS trainer_invites (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  trainer_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL REFERENCES class_sessions(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trainer_invites_session ON trainer_invites (studio_id, session_id);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
  value INTEGER NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'all',
  product_ids_json TEXT,
  max_uses INTEGER,
  per_user INTEGER NOT NULL DEFAULT 1,
  only_user_id TEXT,
  returning_only INTEGER NOT NULL DEFAULT 0,
  first_purchase_only INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT,
  valid_to TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (studio_id, code)
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  coupon_id TEXT NOT NULL REFERENCES coupons(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  payment_id TEXT,
  discount_grosze INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('pass', 'guest_pass', 'course', 'event', 'shop', 'renewal')),
  reference_id TEXT,
  amount_grosze INTEGER NOT NULL,
  discount_grosze INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_ref TEXT,
  invoice_id TEXT,
  description TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_studio_time ON payments (studio_id, created_at);

CREATE TABLE IF NOT EXISTS payment_links (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'expired')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT REFERENCES users(id),
  number TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  seller_json TEXT NOT NULL,
  buyer_json TEXT NOT NULL,
  items_json TEXT NOT NULL,
  net_grosze INTEGER NOT NULL,
  vat_grosze INTEGER NOT NULL,
  gross_grosze INTEGER NOT NULL,
  payment_id TEXT,
  UNIQUE (studio_id, number)
);

CREATE TABLE IF NOT EXISTS guest_passes (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  buyer_id TEXT REFERENCES users(id),
  code TEXT NOT NULL UNIQUE,
  recipient_phone TEXT,
  message TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'activated', 'used', 'expired')),
  channel TEXT NOT NULL CHECK (channel IN ('app', 'desk')),
  variant TEXT NOT NULL DEFAULT 'single',
  rules_json TEXT,
  price_grosze INTEGER,
  activation_attempts INTEGER NOT NULL DEFAULT 0,
  transferred_from TEXT,
  pass_id TEXT REFERENCES passes(id),
  activated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  inviter_id TEXT NOT NULL REFERENCES users(id),
  code TEXT NOT NULL UNIQUE,
  invitee_phone TEXT,
  invitee_id TEXT REFERENCES users(id),
  invitee_name TEXT,
  channel TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'accepted', 'first_class', 'purchased')),
  bonus_granted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS welcome_messages (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  trainer_id TEXT REFERENCES users(id),
  client_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'trainer' CHECK (kind IN ('trainer', 'studio', 'trainer_change')),
  body TEXT NOT NULL,
  video_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'scheduled', 'published')),
  publish_at TEXT,
  created_at TEXT NOT NULL,
  seen_at TEXT,
  booked_after INTEGER NOT NULL DEFAULT 0,
  UNIQUE (studio_id, trainer_id, client_id, kind)
);

CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  name TEXT NOT NULL,
  tagline TEXT,
  emoji TEXT,
  palette_json TEXT NOT NULL,
  effect TEXT,
  starts_on TEXT,
  ends_on TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  auto INTEGER NOT NULL DEFAULT 0,
  segment TEXT,
  pack_json TEXT,
  sound TEXT,
  icon TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_theme ON themes (studio_id) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  body TEXT NOT NULL,
  title TEXT,
  action TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'deferred', 'suppressed')),
  reason TEXT,
  channel TEXT NOT NULL DEFAULT 'push',
  campaign_id TEXT,
  variant TEXT,
  dedupe_key TEXT,
  pushed_at TEXT,
  deliver_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  opened_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, deliver_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_dedupe ON notifications (studio_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_runs (
  studio_id TEXT NOT NULL,
  key TEXT NOT NULL,
  ran_at TEXT NOT NULL,
  PRIMARY KEY (studio_id, key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  subject_user_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_studio ON audit_log (studio_id, created_at);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  owner_id TEXT,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  data BLOB,                -- obrazy i PDF; filmy leżą na dysku (path względem katalogu mediów)
  path TEXT,
  size INTEGER NOT NULL,
  duration_sec REAL,
  ratio REAL,
  private INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Wgrywanie filmów kawałkami z wznawianiem: received = ile bajtów już jest w uploads/<id>.part.
CREATE TABLE IF NOT EXISTS media_uploads (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  received INTEGER NOT NULL DEFAULT 0,
  duration_sec REAL,
  created_at TEXT NOT NULL
);

-- ——— Dobrostan (4.4) ———
CREATE TABLE IF NOT EXISTS mindful_logs (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('meditation', 'breath', 'stretch')),
  ref TEXT,
  minutes REAL NOT NULL,
  completed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mindful_user ON mindful_logs (studio_id, user_id, completed_at);

CREATE TABLE IF NOT EXISTS journal_entries (
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  data_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS week_goals (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  trainings INTEGER NOT NULL,
  mindful INTEGER NOT NULL,
  PRIMARY KEY (studio_id, user_id)
);

CREATE TABLE IF NOT EXISTS course_mini_progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  program TEXT NOT NULL,
  day INTEGER NOT NULL,
  done_at TEXT NOT NULL,
  PRIMARY KEY (user_id, program, day)
);

-- ——— Zdrowie i postępy (4.6) – wszystko opt-in, zaszyfrowane ———
CREATE TABLE IF NOT EXISTS health_profiles (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  data_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (studio_id, user_id)
);

CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  data_enc TEXT NOT NULL,
  share_with_trainer INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress_photos (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  media_id TEXT NOT NULL,
  taken_on TEXT NOT NULL,
  share_with_trainer INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cycle_entries (
  user_id TEXT NOT NULL REFERENCES users(id),
  start_date TEXT NOT NULL,
  data_enc TEXT NOT NULL,
  PRIMARY KEY (user_id, start_date)
);

CREATE TABLE IF NOT EXISTS trainer_notes (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  trainer_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS individual_plans (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  trainer_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  items_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (studio_id, client_id)
);

-- ——— Społeczność (4.5) ———
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  group_id TEXT REFERENCES groups(id),
  kind TEXT NOT NULL CHECK (kind IN ('post', 'announcement', 'story', 'event')),
  body TEXT NOT NULL,
  media_id TEXT,
  photo_consent INTEGER NOT NULL DEFAULT 0,
  event_at TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_studio ON posts (studio_id, created_at);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  post_id TEXT NOT NULL REFERENCES posts(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_likes (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  post_id TEXT NOT NULL REFERENCES posts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'hidden', 'dismissed')),
  resolved_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  title TEXT NOT NULL,
  description TEXT,
  metric TEXT NOT NULL CHECK (metric IN ('trainings', 'mindful', 'checkins')),
  target INTEGER NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  badge_code TEXT,
  theme_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenge_members (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (challenge_id, user_id)
);

CREATE TABLE IF NOT EXISTS challenge_checkins (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  PRIMARY KEY (challenge_id, user_id, date)
);

CREATE TABLE IF NOT EXISTS user_badges (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  code TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  PRIMARY KEY (studio_id, user_id, code)
);

-- ——— Lojalność, nagrody, gesty (4.7, 4.8.2, 4.12) ———
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (studio_id, user_id, reason, ref)
);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('entry', 'discount', 'gift', 'early_booking')),
  cost_points INTEGER NOT NULL,
  value INTEGER,
  shop_product_id TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- Vouchery wystawiane w recepcji: kwota na wybrane zajęcia (NULL = dowolne), kod do okazania przy kasie.
CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  code TEXT NOT NULL,
  class_type_id TEXT REFERENCES class_types(id),
  amount_grosze INTEGER NOT NULL CHECK (amount_grosze > 0),
  recipient TEXT,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'redeemed', 'cancelled')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (studio_id, code)
);

CREATE TABLE IF NOT EXISTS locker_items (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL CHECK (source IN ('ten_classes', 'points', 'birthday', 'theme', 'event')),
  title TEXT NOT NULL,
  shop_product_id TEXT,
  options_json TEXT,
  size TEXT,
  delivery TEXT CHECK (delivery IN ('pickup', 'ship')),
  status TEXT NOT NULL CHECK (status IN ('choose', 'queued', 'ready', 'shipped', 'collected')),
  milestone INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_tasks (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  trainer_id TEXT REFERENCES users(id),
  client_id TEXT NOT NULL REFERENCES users(id),
  due_on TEXT NOT NULL,
  delivery TEXT NOT NULL CHECK (delivery IN ('post', 'pickup')),
  status TEXT NOT NULL CHECK (status IN ('todo', 'written', 'sent', 'collected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (studio_id, client_id)
);

-- ——— Sklep i partnerzy (4.8) ———
-- media_id = okładka (pierwsze zdjęcie galerii); gallery_json = wszystkie zdjęcia w kolejności.
-- variants_json: stock NULL = bez limitu (napoje); nutrition_json: tylko uzupełnione wartości (core/shop.ts).
-- set_name: nazwa kompletu („Komplet Isola”) – produkty o tej samej nazwie strona produktu proponuje razem.
CREATE TABLE IF NOT EXISTS shop_products (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('drink', 'accessory', 'apparel', 'other')),
  name TEXT NOT NULL,
  description TEXT,
  price_grosze INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'sold_out', 'hidden')),
  size_scale TEXT NOT NULL DEFAULT 'none',
  variants_json TEXT NOT NULL,
  media_id TEXT,
  gallery_json TEXT NOT NULL DEFAULT '[]',
  nutrition_json TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  reward_eligible INTEGER NOT NULL DEFAULT 0,
  set_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_orders (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('online', 'pickup', 'desk')),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'ready', 'paid', 'shipped', 'collected', 'cancelled', 'expired')),
  items_json TEXT NOT NULL,
  total_grosze INTEGER NOT NULL,
  method TEXT,
  address_enc TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  perk TEXT NOT NULL,
  code TEXT,
  url TEXT,
  verified INTEGER NOT NULL DEFAULT 0
);

-- ——— Wydarzenia prywatne (4.13) ———
CREATE TABLE IF NOT EXISTS event_packages (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  name TEXT NOT NULL,
  kinds_json TEXT NOT NULL,
  min_guests INTEGER NOT NULL,
  max_guests INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  price_grosze INTEGER,
  deposit_grosze INTEGER,
  addons_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS private_events (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  client_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  title TEXT,
  package_id TEXT REFERENCES event_packages(id),
  trainer_id TEXT REFERENCES users(id),
  zone_id TEXT REFERENCES zones(id),
  activity TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  guests INTEGER NOT NULL,
  addons_json TEXT NOT NULL DEFAULT '[]',
  client_note TEXT,
  internal_note TEXT,
  status TEXT NOT NULL CHECK (status IN ('inquiry', 'offer', 'confirmed', 'paid', 'done', 'cancelled')),
  price_grosze INTEGER,
  deposit_grosze INTEGER,
  payment_mode TEXT NOT NULL DEFAULT 'on_site' CHECK (payment_mode IN ('deposit', 'on_site', 'private')),
  offer_text TEXT,
  invite_code TEXT NOT NULL UNIQUE,
  terms_accepted_at TEXT NOT NULL,
  history_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_guests (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  event_id TEXT NOT NULL REFERENCES private_events(id),
  name TEXT NOT NULL,
  contact TEXT,
  rsvp TEXT NOT NULL CHECK (rsvp IN ('pending', 'yes', 'no')),
  photo_consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- ——— Kursy (5) ———
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'program', 'mindbody', 'live', 'hybrid', 'bundle')),
  level TEXT NOT NULL,
  goal TEXT,
  day_part TEXT,
  contraindications TEXT,
  price_grosze INTEGER,
  access_days INTEGER,
  seller TEXT NOT NULL DEFAULT 'studio' CHECK (seller IN ('studio', 'trainer')),
  trainer_share INTEGER NOT NULL DEFAULT 70,
  pass_discount INTEGER NOT NULL DEFAULT 0,
  included_product_ids_json TEXT NOT NULL DEFAULT '[]',
  bundle_ids_json TEXT NOT NULL DEFAULT '[]',
  drip_days INTEGER NOT NULL DEFAULT 0,
  seat_limit INTEGER,
  segment TEXT,
  promo_pct INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('draft', 'beta', 'pending', 'published', 'suspended', 'archived')),
  review_note TEXT,
  cover_media_id TEXT,
  page_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Strona sprzedażowa kursu: edycje (daty sprzedaży i dostępu w jednym miejscu), pakiety, prowadzące i eksperci.
CREATE TABLE IF NOT EXISTS course_editions (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  name TEXT NOT NULL,
  theme TEXT,
  sales_from TEXT,
  sales_until TEXT,
  starts_at TEXT,
  access_until TEXT,
  news_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_tiers (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  name TEXT NOT NULL,
  price_grosze INTEGER NOT NULL CHECK (price_grosze >= 0),
  features_json TEXT NOT NULL DEFAULT '[]',
  highlight INTEGER NOT NULL DEFAULT 0,
  seat_limit INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS course_people (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('author', 'trainer', 'expert')),
  title TEXT,
  bio TEXT,
  photo_media_id TEXT,
  sort INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS course_lessons (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'text', 'live', 'homework', 'stationary')),
  body TEXT,
  media_id TEXT,
  video_url TEXT,
  captions TEXT,
  attachment_id TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  unlock_day INTEGER NOT NULL DEFAULT 0,
  free_preview INTEGER NOT NULL DEFAULT 0,
  live_at TEXT,
  person_id TEXT REFERENCES course_people(id),
  sort INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS course_enrollments (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL CHECK (source IN ('pass', 'purchase', 'free', 'beta', 'bundle')),
  price_paid_grosze INTEGER NOT NULL DEFAULT 0,
  withdrawal_waived_at TEXT,
  started_at TEXT NOT NULL,
  expires_at TEXT,
  completed_at TEXT,
  tier_id TEXT REFERENCES course_tiers(id),
  edition_id TEXT REFERENCES course_editions(id),
  PRIMARY KEY (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  lesson_id TEXT NOT NULL REFERENCES course_lessons(id),
  position_sec REAL NOT NULL DEFAULT 0,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS course_questions (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  lesson_id TEXT NOT NULL REFERENCES course_lessons(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  answer TEXT,
  answered_by TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_reviews (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (course_id, user_id)
);

-- ——— Muzyka (4.12.4) ———
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  provider TEXT NOT NULL CHECK (provider IN ('spotify', 'apple')),
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('class', 'meditation', 'stretch', 'sleep', 'theme', 'shared')),
  class_type_id TEXT,
  theme_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  playlist_id TEXT NOT NULL REFERENCES playlists(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  track_url TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS track_votes (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  track_id TEXT NOT NULL REFERENCES playlist_tracks(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (track_id, user_id)
);

CREATE TABLE IF NOT EXISTS music_accounts (
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  token_enc TEXT,
  label TEXT,
  connected_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider)
);

-- ——— Feedback, wsparcie, marketing ———
CREATE TABLE IF NOT EXISTS nps_responses (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  trigger TEXT NOT NULL,
  score INTEGER CHECK (score BETWEEN 0 AND 10),
  comment TEXT,
  created_at TEXT NOT NULL,
  answered_at TEXT,
  UNIQUE (studio_id, user_id, trigger)
);

CREATE TABLE IF NOT EXISTS dormant_surveys (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  reasons_json TEXT,
  comment TEXT,
  wants_proposal INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('sent', 'answered', 'contacted')),
  created_at TEXT NOT NULL,
  answered_at TEXT,
  contact_due_at TEXT
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'email', 'sms')),
  segment TEXT NOT NULL,
  variants_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'sent')),
  scheduled_at TEXT,
  sent_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  client_id TEXT NOT NULL REFERENCES users(id),
  author_id TEXT,
  from_staff INTEGER NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  -- załącznik (media, rodzaj „chat”) i jego nazwa z urządzenia; body może być wtedy puste
  media_id TEXT,
  attachment_name TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_client ON chat_messages (studio_id, client_id, created_at);

CREATE TABLE IF NOT EXISTS group_messages (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT REFERENCES class_sessions(id),
  audience TEXT NOT NULL,
  body TEXT NOT NULL,
  recipients INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- ——— Platforma (1.2) ———
CREATE TABLE IF NOT EXISTS platform_access_log (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  studio_id TEXT NOT NULL REFERENCES studios(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL CHECK (status IN ('open', 'answered', 'closed')),
  sla_due_at TEXT NOT NULL,
  data_access_granted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  from_platform INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_log (
  id TEXT PRIMARY KEY,
  studio_id TEXT,
  kind TEXT NOT NULL,
  units INTEGER NOT NULL,
  cost_grosze INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_studio ON usage_log (studio_id, created_at);

-- Wiadomości do znajomych wysyłane przez klientki (zaproszenia, polecenia, przepisanie wejściówki) – limity dzienne.
CREATE TABLE IF NOT EXISTS client_sms_log (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_sms_user ON client_sms_log (studio_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_client_sms_phone ON client_sms_log (studio_id, phone, created_at);

CREATE TABLE IF NOT EXISTS request_metrics (
  studio_id TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  total_ms INTEGER NOT NULL,
  PRIMARY KEY (studio_id, day)
);

CREATE TABLE IF NOT EXISTS status_incidents (
  id TEXT PRIMARY KEY,
  component TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('operational', 'degraded', 'outage', 'maintenance')),
  note TEXT NOT NULL,
  started_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS studio_reviews (
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (studio_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health_sync (
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('apple_health', 'google_fit')),
  enabled INTEGER NOT NULL,
  last_sync_at TEXT,
  PRIMARY KEY (user_id, provider)
);
`;

export type Db = DatabaseSync;

/** Rozbija schemat na instrukcje: tabele (do porównania z bazą) i indeksy. */
function statements(sql: string) {
  const parts = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter(Boolean);
  const tables: { name: string; sql: string }[] = [];
  const other: string[] = [];
  for (const p of parts) {
    const m = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(p);
    if (m) tables.push({ name: m[1], sql: p });
    else other.push(p);
  }
  return { tables, other };
}

/** Porównujemy definicje tabel bez komentarzy, cudzysłowów i różnic w białych znakach. */
const normalize = (s: string) =>
  s
    .replace(/--[^\n]*/g, '')
    .replace(/IF NOT EXISTS\s+/i, '')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .trim();

/**
 * Stałe miejsce na dane firmy: apps/api/data (niezależnie od katalogu, z którego odpalono proces).
 * Tu leży baza – a w niej zdjęcia i logo (BLOB-y) – filmy w data/media oraz nocne kopie zapasowe.
 */
export const DATA_DIR = process.env.GLAM_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
export const DB_FILE = process.env.GLAM_DB ?? join(DATA_DIR, 'glam.db');

/** Jednorazowo przenosi starą bazę z apps/api/glam.db do data/, żeby nie zgubić tego, co już wgrano. */
function adoptLegacyDb(file: string) {
  const legacy = join(dirname(fileURLToPath(import.meta.url)), '..', 'glam.db');
  if (file !== DB_FILE || existsSync(file) || !existsSync(legacy)) return;
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(legacy + suffix)) renameSync(legacy + suffix, file + suffix);
}

export function openDb(file = DB_FILE): Db {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
    adoptLegacyDb(file);
  }
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  db.exec('PRAGMA foreign_keys = ON;');
  attachMediaDir(db, file === ':memory:' ? null : (process.env.GLAM_MEDIA_DIR ?? join(file === DB_FILE ? DATA_DIR : dirname(file), 'media')));
  const moved = moveVideoBlobsToDisk(db);
  if (moved) console.log(`🎞️  Przeniesiono ${moved} filmów z bazy na dysk (${mediaDir(db)})`);
  return db;
}

/**
 * Migracje bez ręcznych skryptów: jeśli definicja tabeli w kodzie różni się od tej w bazie
 * (nowe kolumny, rozszerzone CHECK), tabela jest przebudowywana z kopią wspólnych kolumn.
 * Klucze obce wyłączone na czas przebudowy, potem pełna kontrola spójności.
 */
function migrate(db: Db) {
  const { tables, other } = statements(SCHEMA);
  db.exec('PRAGMA foreign_keys = OFF;');
  const existing = new Map(
    (db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all() as { name: string; sql: string }[]).map((r) => [r.name, r.sql]),
  );
  db.exec('BEGIN');
  try {
    for (const t of tables) {
      const current = existing.get(t.name);
      if (!current) {
        db.exec(t.sql);
        continue;
      }
      if (normalize(current) === normalize(t.sql)) continue;
      const oldCols = new Set((db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]).map((c) => c.name));
      db.exec(t.sql.replace(`CREATE TABLE IF NOT EXISTS ${t.name}`, `CREATE TABLE ${t.name}__new`));
      const newCols = (db.prepare(`PRAGMA table_info(${t.name}__new)`).all() as { name: string }[]).map((c) => c.name);
      const common = newCols.filter((c) => oldCols.has(c)).join(', ');
      db.exec(`INSERT INTO ${t.name}__new (${common}) SELECT ${common} FROM ${t.name}`);
      db.exec(`DROP TABLE ${t.name}`);
      db.exec(`ALTER TABLE ${t.name}__new RENAME TO ${t.name}`);
    }
    for (const s of other) db.exec(s);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const broken = db.prepare('PRAGMA foreign_key_check').all();
  if (broken.length) console.warn(`⚠️  Po migracji ${broken.length} rekordów narusza klucze obce`);

  // Zdjęcia wgrane, zanim zapisywaliśmy proporcje – odczytujemy je z pliku.
  const missing = db.prepare('SELECT id, photo_mime, photo_data FROM class_types WHERE photo_data IS NOT NULL AND photo_ratio IS NULL').all() as { id: string; photo_mime: string; photo_data: Uint8Array }[];
  for (const row of missing) db.prepare('UPDATE class_types SET photo_ratio = ? WHERE id = ?').run(imageRatio(row.photo_data, row.photo_mime), row.id);
}

export function tx<T>(db: Db, fn: () => T): T {
  // Re-entrant: serwis wołany z innej transakcji po prostu do niej dołącza.
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const id = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
