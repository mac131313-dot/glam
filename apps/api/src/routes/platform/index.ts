// Platforma (1.2): wejście do tras konsoli GLAM i publicznych tras SaaS. Tu składają się moduły
// (studios, support, team, signup, billing); strażnik ról i dziennik leżą w `guard.ts` – administrator platformy
// NIE ma domyślnego dostępu do danych klientek (T7, T8).
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../context.ts';
import { billingRoutes } from './billing.ts';
import { signupRoutes } from './signup.ts';
import { studioRoutes } from './studios.ts';
import { supportRoutes } from './support.ts';
import { teamRoutes } from './team.ts';

export { bootstrapPlatformStaff, platformAdminPhones, platformAudit, requirePlatform, type PlatformRole } from './guard.ts';

export function platformRoutes(app: FastifyInstance, deps: Deps) {
  studioRoutes(app, deps);
  supportRoutes(app, deps);
  teamRoutes(app, deps);
  signupRoutes(app, deps);
  billingRoutes(app, deps);
}
