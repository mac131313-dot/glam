import { DEFAULT_POLICY, featureEnabled, resolveLook, resolveSettings, type BookingPolicy, type Feature, type Look, type StudioSettings } from '@glam/core';
import type { Db } from '../db.ts';
import { notFound } from '../errors.ts';

export type StudioRow = {
  id: string;
  name: string;
  slug: string;
  invite_code: string;
  city: string | null;
  tagline: string | null;
  accent: string;
  look_json: string | null;
  logo: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  nip: string | null;
  timezone: string;
  policy_json: string;
  settings_json: string | null;
  regulations: string | null;
  guest_pass_price: number;
  welcome_approval: number;
  logo_mime: string | null;
  logo_ratio: number | null;
  logo_version: number;
  plan_id: string | null;
  status: 'trial' | 'active' | 'suspended';
  trial_ends_at: string | null;
  published: number;
  catalog_visible: number;
  founded_on: string | null;
  white_label_json: string | null;
  created_at: string;
};

export type Studio = StudioRow & { policy: BookingPolicy; look: Look; settings: StudioSettings; flags: Record<string, boolean>; has: (f: Feature) => boolean };

export function loadStudio(db: Db, studioId: string): Studio {
  // Bez logo_data – plik logo nie jest potrzebny przy każdym zapytaniu.
  const row = db.prepare(`SELECT ${STUDIO_COLUMNS} FROM studios WHERE id = ?`).get(studioId) as StudioRow | undefined;
  if (!row) throw notFound('Nie ma takiego studia.');
  const flags = Object.fromEntries(
    (db.prepare('SELECT flag, enabled FROM studio_features WHERE studio_id = ?').all(studioId) as { flag: string; enabled: number }[]).map((f) => [f.flag, !!f.enabled]),
  );
  return {
    ...row,
    policy: { ...DEFAULT_POLICY, ...JSON.parse(row.policy_json) },
    look: resolveLook(row.look_json ? JSON.parse(row.look_json) : null),
    settings: resolveSettings(row.settings_json ? JSON.parse(row.settings_json) : null),
    flags,
    has: (f: Feature) => featureEnabled(row.plan_id, flags, f),
  };
}

export const STUDIO_COLUMNS =
  'id, name, slug, invite_code, city, tagline, accent, look_json, logo, phone, email, address, nip, timezone, policy_json, settings_json, regulations, guest_pass_price, welcome_approval, logo_mime, logo_ratio, logo_version, plan_id, status, trial_ends_at, published, catalog_visible, founded_on, white_label_json, created_at';

/** Adres logo z wersją (cache przeglądarki odświeża się po każdym nowym wgraniu) i jego kształt. */
export function logoInfo(row: { id: string; logo_mime: string | null; logo_ratio: number | null; logo_version: number }) {
  if (!row.logo_mime) return { logoUrl: null, logoWide: false };
  return { logoUrl: `/api/studios/${row.id}/logo?v=${row.logo_version}`, logoWide: (row.logo_ratio ?? 1) > 1.6 };
}
