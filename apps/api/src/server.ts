import { buildApp } from './app.ts';
import type { Deps } from './context.ts';
import { openDb } from './db.ts';
import { backup, dispatch } from './services/dispatch.ts';
import { runJobs } from './services/jobs.ts';
import { guardStripeStudios } from './services/stripe.ts';
import { WebPushSender } from './services/webpush.ts';
import { ConsoleEmailSender, ConsolePushSender, ConsoleSmsGateway, MockPaymentProvider } from './sms.ts';

const db = openDb();
const production = process.env.NODE_ENV === 'production';
const deps: Deps = {
  db,
  sms: new ConsoleSmsGateway(),
  // Studia ze Stripe płacą online wyłącznie przez Checkout; bezpiecznik odmawia, gdyby coś zawołało jeszcze charge().
  payments: guardStripeStudios(db, new MockPaymentProvider()),
  email: new ConsoleEmailSender(),
  // Web Push działa naprawdę (VAPID + aes128gcm); w dev wystarczy GLAM_WEBPUSH=0, żeby tylko logować.
  push: process.env.GLAM_WEBPUSH === '0' ? new ConsolePushSender() : new WebPushSender(db),
  exposeDevCodes: !production,
  publicUrl: process.env.GLAM_PUBLIC_URL ?? 'http://localhost:5173',
};
const app = buildApp(deps, { logger: production });

// „System robi sam” (1, 4, 7, 8): grafik, przypomnienia, życzenia, odnowienia… – co minutę.
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
