// Szablony branżowe (C6): obiekt, strefy, typy zajęć i produkty startowe – właścicielka potem dostosowuje.
import { PRESETS, type ProductRules } from '@glam/core';
import { id, nowIso } from '../db.ts';
import type { StudioScope } from '../scope.ts';
import type { Studio } from './studio.ts';

export function applyPreset(scope: StudioScope, studio: Studio, preset: (typeof PRESETS)[number]) {
  return scope.tx(() => {
    let facility = scope.get<{ id: string }>('SELECT id FROM facilities WHERE studio_id = $studio LIMIT 1')?.id;
    if (!facility) {
      facility = id();
      scope.run('INSERT INTO facilities (id, studio_id, name) VALUES ($id, $studio, $n)', { id: facility, n: studio.name });
    }
    const zoneIds: Record<string, string> = {};
    for (const z of preset.zones) {
      zoneIds[z.key] = id();
      scope.run('INSERT INTO zones (id, studio_id, facility_id, name, access) VALUES ($id, $studio, $f, $n, $a)', { id: zoneIds[z.key], f: facility, n: z.name, a: z.access });
    }
    const ctIds: Record<string, string> = {};
    for (const c of preset.classTypes) {
      ctIds[c.key] = id();
      scope.run('INSERT INTO class_types (id, studio_id, zone_id, name, level, description) VALUES ($id, $studio, $z, $n, $l, $d)', { id: ctIds[c.key], z: zoneIds[c.zone], n: c.name, l: c.level, d: c.description });
    }
    for (const p of preset.products) {
      // W szablonie strefy są kluczami – podmieniamy je na prawdziwe identyfikatory.
      const rules = JSON.parse(JSON.stringify(p.rules).replace(/"(gym|sala|joga|relaks)"/g, (_, k) => `"${zoneIds[k] ?? k}"`)) as ProductRules;
      const pid = id();
      const vid = id();
      scope.run("INSERT INTO products (id, studio_id, name, description, sort) VALUES ($id, $studio, $n, $d, (SELECT COALESCE(MAX(sort), 0) + 1 FROM products WHERE studio_id = $studio))", { id: pid, n: p.name, d: p.description });
      scope.run('INSERT INTO product_versions (id, studio_id, product_id, version, price_grosze, rules_json, created_at) VALUES ($id, $studio, $p, 1, $price, $r, $now)', { id: vid, p: pid, price: p.priceGrosze, r: JSON.stringify(rules), now: nowIso() });
      scope.run('UPDATE products SET current_version_id = $v WHERE studio_id = $studio AND id = $id', { v: vid, id: pid });
    }
    return { zones: preset.zones.length, classTypes: preset.classTypes.length, products: preset.products.length };
  });
}
