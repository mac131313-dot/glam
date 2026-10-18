import { buildApp } from './app.ts';
import type { Deps } from './context.ts';
import { openDb } from './db.ts';
import { backup, dispatch } from './services/dispatch.ts';
import { runJobs } from './services/jobs.ts';
import { WebPushSender } from './services/webpush.ts';
import { ConsoleEmailSender, ConsolePushSender, ConsoleSmsGateway, MockPaymentProvider } from './sms.ts';

const db = openDb();
const production = process.env.NODE_ENV === 'production';
// Kody SMS w odpowiedziach i logowanie demo bez SMS (/api/dev/login) tylko na wyraźne życzenie: `npm run dev`
// albo GLAM_DEMO=1 (Docker z demo). Serwer uruchomiony inaczej ich nie wystawi – także gdy ktoś zapomni o NODE_ENV.
const demo = process.env.GLAM_DEMO === '1' || process.env.npm_lifecycle_event === 'dev';
if (demo && production) throw new Error('Tryb demo (GLAM_DEMO=1 / npm run dev) nie może działać z NODE_ENV=production.');
if (demo) console.warn('⚠ Tryb demo: kody SMS w odpowiedziach API i logowanie bez SMS są włączone. Nie używaj tego na serwerze z prawdziwymi klientkami.');
const deps: Deps = {
  db,
  sms: new ConsoleSmsGateway(),
  payments: new MockPaymentProvider(),
  email: new ConsoleEmailSender(),
  // Web Push działa naprawdę (VAPID + aes128gcm); w dev wystarczy GLAM_WEBPUSH=0, żeby tylko logować.
  push: process.env.GLAM_WEBPUSH === '0' ? new ConsolePushSender() : new WebPushSender(db),
  exposeDevCodes: demo,
  publicUrl: process.env.GLAM_PUBLIC_URL ?? 'http://localhost:5173',
};
const app = buildApp(deps, { logger: production });

// „System robi sam” (1, 4, 7, 8): grafik, przypomnienia, motywy, życzenia, odnowienia… – co minutę.
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await runJobs(deps);
    await dispatch(deps);
    const now = new Date();
    if (now.getUTCHours() === 2 && now.getUTCMinutes() === 0) console.log(`💾 Kopia zapasowa: ${backup(db)}`);
  } catch (err) {
    console.error('tick', err);
  } finally {
    running = false;
  }
}
await tick();
setInterval(tick, 60_000).unref();

const port = Number(process.env.PORT ?? 3001);
// W kontenerze HOST=0.0.0.0 (inaczej nginx z sąsiedniego kontenera się nie dobije).
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`✿ GLAM API: http://127.0.0.1:${port}`);
