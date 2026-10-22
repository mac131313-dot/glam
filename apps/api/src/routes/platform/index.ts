// Platforma (1.2): wejście do tras administratora platformy i publicznych tras SaaS. Tu składają się moduły
// (studios, support, signup) i leży wspólny strażnik `adminOnly` – administrator platformy NIE ma domyślnego
// dostępu do danych klientek (T7, T8).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireUser, type Deps } from '../../context.ts';
import type { Db } from '../../db.ts';
import { forbidden } from '../../errors.ts';
import { signupRoutes } from './signup.ts';
import { studioRoutes } from './studios.ts';
import { supportRoutes } from './support.ts';

export const admins = () => (process.env.GLAM_PLATFORM_ADMINS ?? '+48500000009').split(',').map((s) => s.trim());

/** Strażnik tras administratora platformy (tymczasowy – zastąpi go zespół platformy). */
export const adminOnly = (db: Db) => ({
  preHandler: async (req: FastifyRequest) => {
    await requireUser(db)(req);
    if (!admins().includes(req.user!.phone)) throw forbidden();
  },
});

export function platformRoutes(app: FastifyInstance, deps: Deps) {
  studioRoutes(app, deps);
  supportRoutes(app, deps);
  signupRoutes(app, deps);
}
