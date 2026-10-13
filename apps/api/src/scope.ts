// Izolacja danych między studiami (1.2.3). Każde zapytanie w kontekście studia idzie przez
// StudioScope, który (1) odmawia wykonania SQL bez filtra $studio i (2) sam wstrzykuje
// studio_id z uwierzytelnionego kontekstu – nigdy z danych od klienta.
// W produkcji (Postgres) to samo dodatkowo wymusza Row Level Security.
import type { SQLInputValue } from 'node:sqlite';
import { tx, type Db } from './db.ts';

type Params = Record<string, SQLInputValue>;

export class TenantViolation extends Error {}

export class StudioScope {
  readonly db: Db;
  readonly studioId: string;

  constructor(db: Db, studioId: string) {
    this.db = db;
    this.studioId = studioId;
  }

  private bind(sql: string, params: Params): Params {
    if (!/\$studio\b/.test(sql)) throw new TenantViolation(`Zapytanie bez filtra studia: ${sql.slice(0, 80)}…`);
    if ('studio' in params) throw new TenantViolation('Parametr studio ustawia wyłącznie StudioScope.');
    return { ...params, studio: this.studioId };
  }

  all<T>(sql: string, params: Params = {}): T[] {
    return this.db.prepare(sql).all(this.bind(sql, params)) as T[];
  }

  get<T>(sql: string, params: Params = {}): T | undefined {
    return this.db.prepare(sql).get(this.bind(sql, params)) as T | undefined;
  }

  run(sql: string, params: Params = {}) {
    return this.db.prepare(sql).run(this.bind(sql, params));
  }

  tx<T>(fn: () => T): T {
    return tx(this.db, fn);
  }
}
