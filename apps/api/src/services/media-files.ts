// Filmy na dysku (pełne treningi 20–60 min, 0,5–2 GB nie mieszczą się sensownie w BLOB-ie SQLite).
// W tabeli media zostają metadane i ścieżka względna (media.path); obrazy i PDF dalej siedzą w bazie.
// Moduł nie importuje db.ts, żeby openDb mógł wołać migrację bez cyklu importów.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const dirs = new WeakMap<DatabaseSync, string>();

/** Katalog na pliki danej bazy; baza w pamięci (testy) dostaje katalog tymczasowy sprzątany przy wyjściu. */
export function attachMediaDir(db: DatabaseSync, dir: string | null) {
  let d = dir;
  if (!d) {
    const tmp = mkdtempSync(join(tmpdir(), 'glam-media-'));
    process.once('exit', () => rmSync(tmp, { recursive: true, force: true }));
    d = tmp;
  }
  mkdirSync(join(d, 'uploads'), { recursive: true });
  dirs.set(db, d);
}

export function mediaDir(db: DatabaseSync): string {
  const d = dirs.get(db);
  if (!d) throw new Error('Baza bez katalogu na pliki (openDb nie wywołał attachMediaDir).');
  return d;
}

/** Ścieżka bezwzględna pliku; ścieżka z bazy nie może wyjść poza katalog mediów. */
export function mediaFile(db: DatabaseSync, rel: string): string {
  const root = resolve(mediaDir(db));
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep)) throw new Error(`Ścieżka pliku poza katalogiem mediów: ${rel}`);
  return abs;
}

export const uploadPart = (db: DatabaseSync, uploadId: string) => join(mediaDir(db), 'uploads', `${uploadId}.part`);

const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

/** Ścieżka względna nowego filmu: <studio>/<id>.<ext> (katalog studia tworzony od razu). */
export function videoPath(db: DatabaseSync, studioId: string, mediaId: string, mime: string): string {
  if (!/^[\w-]+$/.test(studioId) || !/^[\w-]+$/.test(mediaId)) throw new Error('Nieprawidłowy identyfikator pliku.');
  mkdirSync(join(mediaDir(db), studioId), { recursive: true });
  return `${studioId}/${mediaId}.${EXT[mime] ?? 'bin'}`;
}

/**
 * Jednorazowo (przy starcie) przenosi filmy zapisane dawniej jako BLOB na dysk. Każdy plik osobno:
 * najpierw zapis na dysk, potem UPDATE – przerwany start niczego nie gubi, następny dokończy.
 */
export function moveVideoBlobsToDisk(db: DatabaseSync): number {
  const rows = db.prepare("SELECT id, studio_id, mime FROM media WHERE path IS NULL AND mime LIKE 'video/%'").all() as { id: string; studio_id: string; mime: string }[];
  for (const r of rows) {
    // Po jednym BLOB-ie naraz – nie trzymamy wszystkich filmów w pamięci.
    const { data } = db.prepare('SELECT data FROM media WHERE id = ?').get(r.id) as { data: Uint8Array };
    const rel = videoPath(db, r.studio_id, r.id, r.mime);
    writeFileSync(mediaFile(db, rel), data);
    db.prepare('UPDATE media SET path = ?, data = NULL WHERE id = ?').run(rel, r.id);
  }
  return rows.length;
}
