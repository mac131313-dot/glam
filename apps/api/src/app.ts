import Fastify from 'fastify';
import type { Deps } from './context.ts';
import { HttpError } from './errors.ts';
import { TenantViolation } from './scope.ts';
import { accountRoutes } from './routes/account.ts';
import { clientRoutes } from './routes/client.ts';
import { communityRoutes } from './routes/community.ts';
import { configRoutes } from './routes/config.ts';
import { coursePageRoutes } from './routes/coursePage.ts';
import { courseRoutes } from './routes/courses.ts';
import { eventRoutes } from './routes/events.ts';
import { healthRoutes } from './routes/health.ts';
import { logoRoutes } from './routes/logo.ts';
import { marketingRoutes } from './routes/marketing.ts';
import { musicRoutes } from './routes/music.ts';
import { photoRoutes } from './routes/photos.ts';
import { ownerRoutes } from './routes/owner.ts';
import { platformRoutes } from './routes/platform.ts';
import { publicRoutes } from './routes/public.ts';
import { shopRoutes } from './routes/shop.ts';
import { staffRoutes } from './routes/staff.ts';
import { uploadRoutes } from './routes/uploads.ts';

export function buildApp(deps: Deps, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof TenantViolation) {
      req.log.error(err, 'tenant isolation violation');
      return reply.status(500).send({ error: 'internal', message: 'Coś poszło nie tak. Już to sprawdzamy.' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413) return reply.status(413).send({ error: 'too_large', message: 'Plik jest za duży.' });
    if (status && status < 500) return reply.status(status).send({ error: 'bad_request', message: 'Nieprawidłowe zapytanie.' });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Coś poszło nie tak. Spróbuj ponownie za chwilę.' });
  });

  // Monitoring per studio (1.2.11): liczba zapytań, błędy, czas odpowiedzi – dziennie.
  app.addHook('onResponse', async (req, reply) => {
    const studio = String(req.headers['x-studio-id'] ?? '') || '-';
    const ms = Math.round(reply.elapsedTime);
    deps.db
      .prepare(
        `INSERT INTO request_metrics (studio_id, day, requests, errors, total_ms) VALUES (?, ?, 1, ?, ?)
         ON CONFLICT (studio_id, day) DO UPDATE SET requests = requests + 1, errors = errors + excluded.errors, total_ms = total_ms + excluded.total_ms`,
      )
      .run(studio, new Date().toISOString().slice(0, 10), reply.statusCode >= 500 ? 1 : 0, ms);
  });

  app.get('/api/health', async () => ({ ok: true }));
  accountRoutes(app, deps);
  clientRoutes(app, deps);
  staffRoutes(app, deps);
  ownerRoutes(app, deps);
  configRoutes(app, deps);
  marketingRoutes(app, deps);
  communityRoutes(app, deps);
  healthRoutes(app, deps);
  courseRoutes(app, deps);
  uploadRoutes(app, deps);
  shopRoutes(app, deps);
  eventRoutes(app, deps);
  musicRoutes(app, deps);
  platformRoutes(app, deps);
  logoRoutes(app, deps);
  photoRoutes(app, deps);
  publicRoutes(app, deps);
  coursePageRoutes(app, deps);
  return app;
}
