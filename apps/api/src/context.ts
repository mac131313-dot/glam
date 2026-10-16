import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, FEATURE_LABEL, type Feature, type Permission, type Role } from '@glam/core';
import { userFromToken, type AuthUser } from './auth.ts';
import type { Db } from './db.ts';
import { HttpError, forbidden } from './errors.ts';
import { StudioScope } from './scope.ts';
import type { EmailSender, PaymentProvider, PushSender, SmsGateway } from './sms.ts';
import type { DnsResolver } from './services/domain.ts';
import { loadStudio, type Studio } from './services/studio.ts';

export type { Role };
export const STAFF: Role[] = ['trainer', 'reception', 'owner', 'coordinator'];

export type Deps = {
  db: Db;
  sms: SmsGateway;
  payments: PaymentProvider;
  exposeDevCodes: boolean;
  email?: EmailSender;
  push?: PushSender;
  /** Publiczny adres aplikacji (linki w SMS, kalendarz, linki płatności). */
  publicUrl?: string;
  /** Zapytania DNS przy sprawdzaniu własnej domeny studia (domyślnie node:dns; w testach podstawka). */
  dns?: DnsResolver;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    studio?: Studio;
    scope?: StudioScope;
    roles?: Role[];
  }
}

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

export const requireUser = (db: Db) => async (req: FastifyRequest) => {
  const user = userFromToken(db, bearer(req));
  if (!user) throw new HttpError(401, 'unauthorized', 'Zaloguj się ponownie.');
  req.user = user;
};

/**
 * Kontekst studia: nagłówek x-studio-id + członkostwo z odpowiednią rolą.
 * Brak członkostwa = 404, a nie 403, żeby nie zdradzać, że studio w ogóle istnieje.
 */
export const requireStudio =
  (db: Db, allowed: Role[] = ['client', ...STAFF]) =>
  async (req: FastifyRequest, _reply: FastifyReply) => {
    await requireUser(db)(req);
    const studioId = String(req.headers['x-studio-id'] ?? '');
    const roles = (
      db.prepare('SELECT role FROM memberships WHERE studio_id = ? AND user_id = ?').all(studioId, req.user!.id) as { role: Role }[]
    ).map((r) => r.role);
    if (roles.length === 0) throw new HttpError(404, 'not_found', 'Nie znaleziono studia.');
    if (!roles.some((r) => allowed.includes(r))) throw forbidden();
    const studio = loadStudio(db, studioId);
    // Zawieszone studio: personel nadal wchodzi do panelu (np. rozliczyć abonament), klientki – nie.
    if (studio.status === 'suspended' && !roles.some((r) => r !== 'client')) throw new HttpError(423, 'studio_suspended', 'Studio jest chwilowo niedostępne.');
    req.roles = roles;
    req.studio = studio;
    req.scope = new StudioScope(db, studioId);
  };

/** Uprawnienie z siatki ról (2.1) – sprawdzane po stronie serwera, nie tylko w menu. */
export const requirePerm = (db: Db, ...perms: Permission[]) => ({
  preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
    await requireStudio(db, STAFF)(req, reply);
    if (!perms.some((p) => can(req.roles!, p))) throw forbidden();
  },
});

/** Funkcja z planu abonamentowego lub feature flagi studia (1.2.11, T11). */
export function assertFeature(studio: Studio, f: Feature) {
  if (!studio.has(f)) throw new HttpError(403, 'feature_off', `„${FEATURE_LABEL[f]}” nie jest włączone w tym studiu.`);
}

export const ctx = (req: FastifyRequest) => ({ user: req.user!, studio: req.studio!, scope: req.scope!, roles: req.roles! });
export const isStaff = (roles: readonly Role[]) => roles.some((r) => r !== 'client');
