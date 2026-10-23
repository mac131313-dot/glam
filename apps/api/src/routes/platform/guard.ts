// Strażnik konsoli GLAM: rola zespołu platformy z `platform_staff` (serwer egzekwuje macierz, UI tylko ukrywa)
// i dziennik działań `platform_audit`. Administrator platformy NIE ma domyślnego dostępu do danych klientek (T7, T8).
import type { FastifyRequest } from 'fastify';
import { normalizePhone } from '../../auth.ts';
import { requireUser, type Deps } from '../../context.ts';
import { id, nowIso, type Db } from '../../db.ts';
import { forbidden } from '../../errors.ts';

export type PlatformRole = 'admin' | 'support' | 'finance';
export const PLATFORM_ROLES: readonly PlatformRole[] = ['admin', 'support', 'finance'];

/** Numer admina konsoli z danych demo – domyślny tylko w trybie demo. */
const DEMO_PLATFORM_ADMIN = '+48500000009';

/**
 * Numery z `GLAM_PLATFORM_ADMINS` (po przecinku, w dowolnym zapisie), które dostają rolę admina, o ile nie mają jeszcze wpisu.
 * Bez zmiennej: w demo numer admina z danych demo, poza demo nikt. Błędne numery są pomijane.
 */
export function platformAdminPhones(env: string | undefined, demo: boolean): string[] {
  return (env ?? (demo ? DEMO_PLATFORM_ADMIN : ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((raw) => {
      try {
        return [normalizePhone(raw)];
      } catch {
        return [];
      }
    });
}

/**
 * Tworzy wpis admina dla istniejących użytkowników z podanych numerów, którzy nie mają żadnego wpisu w `platform_staff`.
 * Wyłączona osoba ma wpis, więc bootstrap jej nie przywraca. Numery bez konta pomija (konto powstaje przy pierwszym logowaniu).
 */
export function bootstrapPlatformStaff(db: Db, phones: string[]) {
  for (const raw of phones) {
    let phone: string;
    try {
      phone = normalizePhone(raw);
    } catch {
      continue;
    }
    const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
    if (!user) continue;
    db.prepare("INSERT OR IGNORE INTO platform_staff (user_id, role, created_at) VALUES (?, 'admin', ?)").run(user.id, nowIso());
  }
}

/** Dopuszcza zalogowaną osobę z aktywnym wpisem w zespole platformy; `roles` puste = każda rola. Ustawia `req.platformRole`. */
export const requirePlatform = ({ db, platformAdmins = [] }: Pick<Deps, 'db' | 'platformAdmins'>, ...roles: PlatformRole[]) => ({
  preHandler: async (req: FastifyRequest) => {
    await requireUser(db)(req);
    const find = () => db.prepare('SELECT role FROM platform_staff WHERE user_id = ? AND disabled_at IS NULL').get(req.user!.id) as { role: PlatformRole } | undefined;
    let row = find();
    if (!row && platformAdmins.includes(req.user!.phone)) {
      // Pierwsze logowanie numeru z GLAM_PLATFORM_ADMINS na świeżej bazie: konta nie było przy starcie API.
      bootstrapPlatformStaff(db, [req.user!.phone]);
      row = find();
    }
    if (!row || (roles.length && !roles.includes(row.role))) throw forbidden();
    req.platformRole = row.role;
  },
});

/** Zapis działania zespołu GLAM w konsoli (kto, co, którego studia dotyczy, co się zmieniło). */
export function platformAudit(db: Db, actorId: string, action: string, studioId: string | null, details?: object) {
  db.prepare('INSERT INTO platform_audit (id, actor_id, action, studio_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id(),
    actorId,
    action,
    studioId,
    details ? JSON.stringify(details) : null,
    nowIso(),
  );
}
