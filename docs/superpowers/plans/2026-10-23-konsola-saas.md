# Konsola GLAM i GLAM jako SaaS – plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Konsola zespołu GLAM (`/konsola`), samoobsługa studia (`/start` + „Abonament” w panelu) i abonament pobierany przez Stripe GLAM z listą płatności do ręcznego zafakturowania.

**Architecture:** Stan dostępu zostaje w `studios.status`; stan rozliczeń w nowej `studio_billing`; jedna czysta funkcja `accessFromBilling` w `packages/core` przekłada jedno na drugie, wołana z webhooka i z dziennego joba. `routes/platform.ts` rozbity na `routes/platform/*` ze strażnikiem ról `requirePlatform`. Web: nowa leniwa powierzchnia `konsola` i publiczna strona `/start` w istniejącym `apps/web`.

**Tech Stack:** Node 25 (TS natywnie), Fastify, `node:sqlite`, `node --test`; React + Vite; Stripe REST przez `fetch` (bez SDK).

**Spec:** `docs/superpowers/specs/2026-10-23-konsola-saas-design.md`

## Global Constraints

- UI, komunikaty błędów i e-maile po polsku, ton jak w reszcie GLAM; bez odmiany imion.
- Wygląd: minimalizm, `ListRow` zamiast kart, cyfry bez szeryfu, mało przycisków; komponenty z `apps/web/src/ui.tsx`.
- Formularze same pilnują wartości (przycisk nieaktywny do czasu poprawnych danych) – bez błędów zgłaszanych dopiero na końcu.
- Konsola nie zwraca danych klientek studia (T7/T8) – tylko liczby i dane firmy/właścicielki.
- Każde działanie zmieniające stan w konsoli zapisuje `platform_audit`.
- Kwoty w groszach w bazie; w API do UI dodatkowo sformatowane `formatPLN`.
- `TRIAL_DAYS = 21`, `BILLING_GRACE_DAYS = 7`, próg „blisko limitu” = 80%, pasek triala od ≤ 5 dni, e-maile triala 5 i 1 dzień przed końcem.
- Stripe GLAM wyłącznie z `deps.platformStripe` (env), nigdy z `gateway_enc` studia.
- Nowe tabele w stałej `SCHEMA` w `apps/api/src/db.ts` (migracja automatyczna).
- Równoległe sesje: przed edycją pliku sprawdź `git status`; **commituj wyłącznie wymienione ścieżki** (`git add <ścieżki>`). Jeśli plik miał już cudze niezacommitowane zmiany (`db.ts`, `App.tsx`, `routes/client.ts` na 2026-10-23), nie dodawaj go do commita – zostaw zmianę niezacommitowaną i wypisz ją w raporcie zadania.
- Po każdym zadaniu backendu: `npm test` i `npm run typecheck` zielone.

## Review Focus

1. **Faktura 0 zł za trial** – Stripe wysyła `invoice.paid` z `amount_paid = 0` przy starcie subskrypcji w trialu; nie może trafić na listę „do zafakturowania”. (Test w Task 5.)
2. **Ostatni admin** – wyłączenie lub degradacja ostatniego aktywnego admina (także samego siebie) zablokowałaby konsolę; serwer odmawia. (Test w Task 3.)
3. **Duplikat i kolejność webhooków** – to samo zdarzenie dwa razy oraz `subscription.updated` przed `checkout.session.completed` nie psują stanu ani nie dublują płatności. (Test w Task 5.)
4. **Studio bez Stripe GLAM** (lokalnie, demo) – rejestracja, trial, „Abonament” i konsola działają; przyciski płatności ukryte, komunikat „Płatności abonamentu wkrótce”. (Test w Task 5.)
5. **Wyłączona osoba z aktywną sesją** – po wyłączeniu w zespole jej token konsoli przestaje działać od razu (sesje usunięte), także gdy jest jednocześnie właścicielką studia. (Test w Task 3.)

---

## File Structure

| Plik | Odpowiedzialność |
|---|---|
| `packages/core/src/saas.ts` (modyfikacja) | `accessFromBilling`, `planUsage`, `smsAllowed`, typy rozliczeń |
| `packages/core/test/saas.test.ts` (nowy) | testy reguł |
| `apps/api/src/db.ts` (modyfikacja) | 6 nowych tabel |
| `apps/api/src/routes/platform/index.ts` | `platformRoutes()` rejestruje moduły; `requirePlatform`, `platformAudit`, `bootstrapPlatformStaff` |
| `apps/api/src/routes/platform/studios.ts` | lista, karta studia, plan, trial, flagi, zawieszenie, dostęp z powodem, `fill`, przegląd „Dziś” |
| `apps/api/src/routes/platform/team.ts` | zespół konsoli |
| `apps/api/src/routes/platform/support.ts` | help desk (platforma i studio), incydenty, `/api/status` |
| `apps/api/src/routes/platform/signup.ts` | rejestracja studia, weryfikacja e-maila |
| `apps/api/src/routes/platform/billing.ts` | webhook Stripe GLAM, płatności/faktury/CSV, `/api/owner/billing*` |
| `apps/api/src/routes/payments-public.ts` | przeniesione bez zmian: `.ics`, linki płatności, webhooki studiów, `/api/checkout/:id` |
| `apps/api/src/services/usage.ts` (nowy) | `studioUsage(scope)` – wydzielone z `owner.ts` |
| `apps/api/src/services/billing.ts` (nowy) | `loadBilling`, `syncAccess`, `billingJobs` |
| `apps/api/src/services/platform-stripe.ts` (nowy) | wywołania Stripe GLAM |
| `apps/api/src/services/studio-sms.ts` (nowy) | `sendStudioSms` z twardym limitem |
| `apps/api/test/platform.test.ts`, `platform-billing.test.ts` (nowe) | testy API |
| `apps/web/src/konsola/*` (nowy katalog) | powierzchnia konsoli |
| `apps/web/src/site/StartSite.tsx` (nowy) | cennik i rejestracja |
| `apps/web/src/staff/Billing.tsx` (nowy) | „Abonament” + pasek |

---

### Task 1: Reguły rozliczeń w `core`

**Files:**
- Modify: `packages/core/src/saas.ts`
- Test: `packages/core/test/saas.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const BILLING_GRACE_DAYS = 7;
  export type BillingState = 'none' | 'active' | 'past_due' | 'canceled';
  export type BillingFacts = { state: BillingState; currentPeriodEnd: string | null; pastDueSince: string | null; manualSuspension: string | null };
  export type AccessStatus = 'trial' | 'active' | 'suspended';
  export function accessFromBilling(trialEndsAt: string | null, billing: BillingFacts, now: Date): AccessStatus;
  export type Usage = { activeClients: number; smsThisMonth: number; storageMb: number; staff: number; facilities: number };
  export type LimitKey = keyof PlanLimits;
  export type LimitUsage = { key: LimitKey; label: string; used: number; limit: number; state: 'ok' | 'near' | 'over' };
  export function planUsage(usage: Usage, plan: Plan): LimitUsage[];
  export function smsAllowed(usedThisMonth: number, plan: Plan, units?: number): boolean;
  ```

- [ ] **Step 1: Write the failing tests** (`node:test` + `assert/strict`, wzór jak `core.test.ts`)

  `accessFromBilling` – `now = new Date('2026-11-10T12:00:00Z')`, `none = { state: 'none', currentPeriodEnd: null, pastDueSince: null, manualSuspension: null }`:
  - trial `'2026-11-20T00:00:00Z'`, `none` → `'trial'`
  - trial minął `'2026-11-01T00:00:00Z'`, `none` → `'suspended'`
  - trial minął, `state: 'active'` → `'active'`
  - trial jeszcze trwa, `state: 'active'` (karta dodana w trialu) → `'trial'`
  - `past_due`, `pastDueSince: '2026-11-05T12:00:00Z'` (5 dni) → `'active'`
  - `past_due`, `pastDueSince: '2026-11-02T12:00:00Z'` (8 dni) → `'suspended'`
  - `canceled`, `currentPeriodEnd: '2026-11-15T00:00:00Z'` → `'active'`; `currentPeriodEnd: '2026-11-09T00:00:00Z'` → `'suspended'`
  - `state: 'active'`, `manualSuspension: 'Nieopłacone faktury'` → `'suspended'`

  `planUsage` dla planu `start` (limity 1/150/300/500/5) i `usage = { activeClients: 121, smsThisMonth: 310, storageMb: 10, staff: 5, facilities: 1 }`:
  - `activeClients` → `state: 'near'` (121/150 ≥ 80%); `smsPerMonth` → `'over'`; `videoMb` → `'ok'`; `staff` 5/5 → `'near'`; zwraca 5 pozycji w kolejności `activeClients, smsPerMonth, videoMb, staff, facilities` z polskimi `label` („Aktywne klientki”, „SMS w miesiącu”, „Wideo (MB)”, „Zespół”, „Obiekty”).

  `smsAllowed`: `smsAllowed(299, start)` → `true`; `smsAllowed(300, start)` → `false`; `smsAllowed(299, start, 2)` → `false`.

- [ ] **Step 2: Run** `node --test packages/core/test/saas.test.ts` – Expected: FAIL (brak eksportów).

- [ ] **Step 3: Implement `planUsage`, `smsAllowed` i szkielet `accessFromBilling`**

  `planUsage`: `state = used > limit ? 'over' : used >= 0.8 * limit ? 'near' : 'ok'` (`staff` 5/5 to `near`, nie `over`). `smsAllowed`: `used + units <= limit`, `units` domyślnie 1.
  **`accessFromBilling` – ciało pisze Maciek (tryb nauki):** zostaw sygnaturę z komentarzem `// TODO(Maciek): reguły dostępu – spec §4` i `throw new Error('TODO')`. Implementujący agent zatrzymuje się tu i prosi użytkownika o te 5–10 linii, zanim przejdzie dalej. Testy z kroku 1 są kontraktem.

- [ ] **Step 4: Run** `node --test packages/core/test/saas.test.ts` – Expected: PASS (po wkładzie Maćka). Potem `npm run typecheck`.

- [ ] **Step 5: Commit** – `git add packages/core/src/saas.ts packages/core/test/saas.test.ts && git commit -m "Reguły abonamentu: dostęp z rozliczeń, limity planu, limit SMS"`

---

### Task 2: Rozbicie `platform.ts` bez zmian zachowania

**Files:**
- Delete: `apps/api/src/routes/platform.ts`
- Create: `apps/api/src/routes/platform/{index,studios,support,signup}.ts`, `apps/api/src/routes/payments-public.ts`
- Modify: `apps/api/src/app.ts` (import `platformRoutes` z `./routes/platform/index.ts`, dodać `paymentsPublicRoutes(app, deps)` w tym samym miejscu listy)
- Modify: każdy import `SLA_HOURS` / `guestCode` z `routes/platform.ts` (sprawdź `grep -rn "routes/platform" apps/api`)

**Interfaces:**
- Produces: `platformRoutes(app, deps)` w `routes/platform/index.ts` woła `studioRoutes`, `supportRoutes`, `signupRoutes` (każda `(app: FastifyInstance, deps: Deps) => void`); `paymentsPublicRoutes(app, deps)`; `SLA_HOURS` eksportowany z `support.ts`. Na tym etapie `adminOnly` przeniesiony do `index.ts` jako tymczasowy eksport.

- [ ] **Step 1:** Sprawdź `git status apps/api/src/routes/platform.ts` – plik nie może mieć cudzych niezacommitowanych zmian. Jeśli ma – przerwij i zgłoś.
- [ ] **Step 2:** Przenieś trasy 1:1 (bez zmian w ciałach) zgodnie z tabelą w File Structure.
- [ ] **Step 3: Run** `npm test && npm run typecheck` – Expected: PASS, ta sama liczba testów co przed zmianą (zanotuj liczbę przed krokiem 2).
- [ ] **Step 4: Commit** – `git add apps/api/src/routes/platform apps/api/src/routes/payments-public.ts apps/api/src/routes/platform.ts apps/api/src/app.ts && git commit -m "Rozbij trasy platformy na moduły (bez zmian zachowania)"`

---

### Task 3: Zespół konsoli, role i dziennik

**Files:**
- Modify: `apps/api/src/db.ts` (tabele `platform_staff`, `platform_audit` – DDL ze specu §3)
- Modify: `apps/api/src/routes/platform/index.ts`, `studios.ts`, `support.ts`
- Create: `apps/api/src/routes/platform/team.ts`
- Modify: `apps/api/src/seed.ts` (persony konsoli)
- Modify: `apps/api/src/server.ts` lub `app.ts` (wywołanie bootstrapu przy starcie)
- Test: `apps/api/test/platform.test.ts`

**Interfaces:**
- Consumes: `logoutAll(db, userId)` z `auth.ts`; `requireUser(db)` z `context.ts`.
- Produces:
  ```ts
  export type PlatformRole = 'admin' | 'support' | 'finance';
  export const requirePlatform: (db: Db, ...roles: PlatformRole[]) => { preHandler: (req: FastifyRequest) => Promise<void> }; // ustawia req.platformRole
  export function platformAudit(db: Db, actorId: string, action: string, studioId: string | null, details?: object): void;
  export function bootstrapPlatformStaff(db: Db, phones: string[]): void; // tworzy admina dla numerów bez wpisu
  ```
  Trasy: `GET /api/platform/me` → `{ userId, name, role }`; `GET /api/platform/team` → `{ userId, name, phone, role, disabledAt }[]`; `POST /api/platform/team` `{ phone, name, role }` (admin) – tworzy użytkownika jeśli brak, wysyła SMS „Zaproszenie do konsoli GLAM”; `PUT /api/platform/team/:userId` `{ role?, disabled?: boolean }` (admin); `GET /api/platform/audit` (admin, support) → wpisy `platform_audit` i `platform_access_log` scalone po `created_at` malejąco, `limit 200`.
  `declare module 'fastify'` w `context.ts` rozszerzone o `platformRole?: PlatformRole`.

- [ ] **Step 1: Write the failing tests** w `platform.test.ts` (setup jak `api.test.ts`: `openDb(':memory:')`, `seed`, `login`, `call`):
  - `macierz ról` – dla `[admin, support, finance]` (persony z seeda) sprawdź kody: `GET /api/platform/studios` 200/200/200; `PUT /api/platform/studios/st_rzeszow {planId:'siec'}` 200/403/403; `GET /api/platform/tickets` 200/200/403; `GET /api/platform/team` 200/403/403; `GET /api/platform/audit` 200/200/403; klientka Magda → 403 wszędzie.
  - `zaproszenie do zespołu` – admin `POST /team {phone:'500000099', name:'Ola', role:'support'}` → 200; Ola loguje się i `GET /api/platform/me` → `role: 'support'`; `GET /api/platform/audit` zawiera `action: 'team.invite'`.
  - `wyłączenie unieważnia sesję` – admin `PUT /team/<Ola> {disabled:true}` → 200; stary token Oli na `GET /api/platform/me` → 401.
  - `ostatni admin` – jedyny admin `PUT /team/<siebie> {disabled:true}` → 400; `{role:'support'}` → 400.
  - `zmiana planu trafia do dziennika` – po `PUT /studios/st_rzeszow {planId:'siec'}` audit zawiera `action: 'studio.plan'`, `studio_id: 'st_rzeszow'`.
  - istniejący test `administrator platformy widzi liczby…` w `api.test.ts` dalej przechodzi.
- [ ] **Step 2: Run** `node --test apps/api/test/platform.test.ts` – Expected: FAIL.
- [ ] **Step 3: Implement** tabele, `requirePlatform` (czyta `platform_staff` gdzie `disabled_at IS NULL`; brak wpisu → 403), `bootstrapPlatformStaff(db, GLAM_PLATFORM_ADMINS)` wołany w `buildApp`, trasy zespołu (wyłączenie = `disabled_at` + `logoutAll`), podmiana `adminOnly` na `requirePlatform` wg macierzy ze specu §6, `platformAudit` w `PUT studios/:id` i `PUT studios/:id/flags`. Seed: `+48500000010` „Ola · wsparcie GLAM” (`support`), `+48500000011` „Ewa · finanse GLAM” (`finance`).
- [ ] **Step 4: Run** `npm test && npm run typecheck` – Expected: PASS.
- [ ] **Step 5: Commit** – ścieżki zadania (bez `db.ts`, jeśli ma cudze zmiany – patrz Global Constraints).

---

### Task 4: `studio_billing`, synchronizacja dostępu, zawieszenie i e-maile triala

**Files:**
- Modify: `apps/api/src/db.ts` (`studio_billing` ze specu §3, z `manual_suspension`)
- Create: `apps/api/src/services/billing.ts`, `apps/api/src/services/usage.ts`
- Modify: `apps/api/src/routes/owner.ts` (`/api/owner/plan` korzysta z `studioUsage`)
- Modify: `apps/api/src/services/jobs.ts` (`platformJobs` → `billingJobs`)
- Modify: `apps/api/src/routes/platform/studios.ts`, `signup.ts`
- Test: `apps/api/test/platform-billing.test.ts`

**Interfaces:**
- Consumes: `accessFromBilling`, `planUsage`, `BillingFacts` (Task 1); `platformAudit`, `requirePlatform` (Task 3).
- Produces:
  ```ts
  // services/usage.ts
  export function studioUsage(scope: StudioScope): Usage;
  // services/billing.ts
  export type BillingRow = { studio_id: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; state: BillingState; current_period_end: string | null; past_due_since: string | null; cancel_at_period_end: number; pending_plan_id: string | null; manual_suspension: string | null; company_name: string | null; nip: string | null; address: string | null; invoice_email: string | null; updated_at: string };
  export function loadBilling(db: Db, studioId: string): BillingRow; // tworzy wiersz 'none', gdy brak
  export function syncAccess(deps: Deps, studioId: string, now?: Date): Promise<AccessStatus>; // zapisuje studios.status; przy przejściu w 'suspended' e-mail do właścicielki
  export async function billingJobs(deps: Deps, now: Date): Promise<void>; // syncAccess dla wszystkich + e-maile 5 i 1 dzień przed końcem triala
  ```
  Trasy: `GET /api/platform/studios/:id` → `{ studio, billing, usage: LimitUsage[], flags, metrics: { requests7d, errors7d, avgMs, storageMb }, owner: { name, phone, email }, audit }`; `POST /api/platform/studios/:id/suspend {reason}` (admin, `reason` ≥ 10 znaków) ; `POST .../unsuspend` (admin); `POST .../trial {days}` (admin, support; 1–60) – przesuwa `trial_ends_at` od `max(teraz, trial_ends_at)`. Lista `GET /api/platform/studios?filter=` dostaje pola `billingState` i `signals: string[]` (`'trial_ending'`, `'past_due'`, `'over_limit'`).

- [ ] **Step 1: Write the failing tests** (`platform-billing.test.ts`, setup jak w `stripe.test.ts`, `deps.email` = podstawka zbierająca `{to, subject, body}`):
  - `rejestracja zakłada studio_billing` – `POST /api/signup/studio` (jak w istniejących testach rejestracji) → wiersz `studio_billing` ze `state = 'none'`.
  - `koniec triala bez karty zawiesza studio i wysyła e-mail` – ustaw `trial_ends_at` na wczoraj, `runJobs(deps, now)` → `studios.status = 'suspended'`, e-mail do właścicielki z tematem zawierającym „zawieszone”.
  - `przypomnienie 5 dni przed końcem triala` – `trial_ends_at` = teraz + 5 dni − 1 h → po `runJobs` dokładnie jeden e-mail; drugie `runJobs` tego samego dnia → nadal jeden (znacznik w `platform_settings` pod kluczem `trial-mail:<studioId>:5`).
  - `ręczne zawieszenie i odwieszenie` – admin `suspend {reason:'Nieopłacone faktury od 3 mies.'}` → `status 'suspended'`, audit `studio.suspend`; klientka studia dostaje 423; `unsuspend` → status wraca do wyniku reguł; `suspend` z wsparcia → 403; za krótki powód → 400.
  - `przedłużenie triala przez wsparcie` – `trial {days:7}` → `trial_ends_at` przesunięte o 7 dni, audit `studio.trial`.
  - `karta studia nie zawiera danych klientek` – odpowiedź `GET /api/platform/studios/st_rzeszow` serializowana do JSON nie zawiera numeru telefonu żadnej klientki seeda (np. Magdy `500000005`).
- [ ] **Step 2: Run** `node --test apps/api/test/platform-billing.test.ts` – Expected: FAIL.
- [ ] **Step 3: Implement** zgodnie z Interfaces. `studioUsage` = dotychczasowe zapytania z `owner.ts:535-552` (`activeClients` = wizyta w ostatnich 30 dniach). `billingJobs` zastępuje `platformJobs` w liście jobów. Rejestracja wstawia `studio_billing` w tej samej transakcji co studio.
- [ ] **Step 4: Run** `npm test && npm run typecheck` – Expected: PASS.
- [ ] **Step 5: Commit** – ścieżki zadania.

---

### Task 5: Stripe GLAM – subskrypcja, webhook, „Abonament” w API

**Files:**
- Modify: `apps/api/src/db.ts` (`platform_payments`, `platform_stripe_events`)
- Modify: `apps/api/src/context.ts` (`Deps.platformStripe`), `apps/api/src/server.ts` (odczyt env)
- Create: `apps/api/src/services/platform-stripe.ts`, `apps/api/src/routes/platform/billing.ts`
- Test: `apps/api/test/platform-billing.test.ts`

**Interfaces:**
- Consumes: `formEncode`, `verifyStripeSignature`, `signStripePayload` (`services/stripe.ts`); `loadBilling`, `syncAccess` (Task 4).
- Produces:
  ```ts
  // context.ts
  platformStripe?: { secret: string; webhookSecret: string; prices: Record<'start' | 'studio' | 'siec', string> };
  // env: GLAM_STRIPE_SECRET, GLAM_STRIPE_WEBHOOK_SECRET, GLAM_STRIPE_PRICE_START|STUDIO|SIEC – wszystkie wymagane, inaczej platformStripe = undefined
  // services/platform-stripe.ts (http = deps.http ?? fetch)
  export async function subscriptionCheckout(deps: Deps, studio: { id: string; trialEndsAt: string | null }, billing: BillingRow, planId: string, returnUrl: string): Promise<{ url: string }>;
  export async function billingPortal(deps: Deps, customerId: string, returnUrl: string): Promise<{ url: string }>;
  export async function changeSubscriptionPlan(deps: Deps, subscriptionId: string, priceId: string, immediate: boolean): Promise<void>;
  export async function setCancelAtPeriodEnd(deps: Deps, subscriptionId: string, cancel: boolean): Promise<void>;
  export function planForPrice(deps: Deps, priceId: string): string | null;
  ```
  Trasy właścicielki (`requireStudio(db, ['owner'])`):
  - `GET /api/owner/billing` → `{ configured: boolean, plan: { id, name, price }, status, trialEndsAt, billing: { state, currentPeriodEnd, cancelAtPeriodEnd, pendingPlanId, companyName, nip, address, invoiceEmail, hasCard: boolean }, usage: LimitUsage[], payments: { periodStart, periodEnd, amount, paidAt }[], plans: { id, name, price, limits, featureLabels }[] }`
  - `PUT /api/owner/billing/details` `{ companyName, nip, address, invoiceEmail }` – `validNip`, `validEmail`
  - `POST /api/owner/billing/checkout {planId}` → `{ url }` – 400 „Uzupełnij dane do faktury”, gdy brak `company_name`/`nip`
  - `POST /api/owner/billing/portal` → `{ url }`
  - `POST /api/owner/billing/plan {planId}` → `{ effective: 'now' | 'next_period' }` – droższy plan: `immediate = true` (`proration_behavior=always_invoice`), `studios.plan_id` od razu; tańszy: `proration_behavior=none`, `pending_plan_id`
  - `POST /api/owner/billing/cancel` / `POST /api/owner/billing/resume`
  - Wszystkie akcje płatnicze → 409 `billing_not_configured` „Płatności abonamentu wkrótce”, gdy `!deps.platformStripe`.
  Webhook `POST /api/platform/stripe` (surowe body, jak webhook studiów): najpierw `INSERT OR IGNORE` do `platform_stripe_events`; `changes = 0` → `{ received: true }` bez efektów. Mapowanie:
  - `checkout.session.completed` (`mode: 'subscription'`, `client_reference_id` = studioId) → zapis `stripe_customer_id`, `stripe_subscription_id`, `state = 'active'`.
  - `customer.subscription.updated` → `status` `active|trialing` → `active`; `past_due|unpaid` → `past_due` (`past_due_since` ustawiane tylko gdy puste); `canceled` → `canceled`; zapis `current_period_end`, `cancel_at_period_end`. Studio szukane po `metadata.studio_id`, a gdy brak – po `stripe_subscription_id`; nieznane → 200 bez efektów.
  - `customer.subscription.deleted` → `canceled`, `current_period_end = ended_at`.
  - `invoice.paid` z `amount_paid > 0` → `platform_payments` (`plan_id` z `planForPrice(lines.data[0].price.id)`, okres z `lines.data[0].period`); `state = 'active'`, `past_due_since = NULL`; gdy `pending_plan_id` i okres faktury zaczyna się ≥ dotychczasowy `current_period_end` → `studios.plan_id = pending_plan_id`, `pending_plan_id = NULL`.
  - `invoice.payment_failed` → `past_due` + e-mail do właścicielki „Płatność za GLAM nie przeszła”.
  - Po każdym → `syncAccess`.

- [ ] **Step 1: Write the failing tests** (podstawka `http` jak w `stripe.test.ts`, `deps.platformStripe = { secret: 'sk_test_glam', webhookSecret: 'whsec_glam', prices: { start: 'price_start', studio: 'price_studio', siec: 'price_siec' } }`):
  - `checkout wymaga danych do faktury` – bez danych → 400; po `PUT details` → 200 i `{ url }`; wywołanie do `/v1/checkout/sessions` zawiera `mode=subscription`, `line_items[0][price]=price_studio`, `client_reference_id=st_rzeszow`, a dla studia w trialu `subscription_data[trial_end]` = epoka końca triala.
  - `zły podpis webhooka` → 403.
  - `invoice.paid zapisuje płatność i aktywuje` – kwota 39900 → wiersz w `platform_payments`, `studio_billing.state = 'active'`, `studios.status = 'active'`.
  - `faktura 0 zł za trial nie trafia na listę` – `invoice.paid` z `amount_paid: 0` → brak wiersza w `platform_payments`.
  - `duplikat zdarzenia` – to samo `invoice.paid` (ten sam `id`) dwa razy → jeden wiersz.
  - `kolejność: subscription.updated przed checkout.session.completed` – `updated` z `metadata.studio_id` ustawia stan; późniejsze `completed` nie cofa `current_period_end`.
  - `nieudana płatność → karencja → zawieszenie` – `payment_failed` → `past_due`, status `active`, e-mail; `runJobs(deps, now + 8 dni)` → `suspended`.
  - `obniżenie planu od następnego okresu` – studio na `studio` z aktywną subskrypcją, `POST plan {planId:'start'}` → `effective: 'next_period'`, `studios.plan_id` nadal `studio`; `invoice.paid` za nowy okres → `plan_id = 'start'`.
  - `bez konfiguracji Stripe` – osobna instancja `buildApp` bez `platformStripe`: `GET /api/owner/billing` → `configured: false`; `POST checkout` → 409.
- [ ] **Step 2: Run** – Expected: FAIL.
- [ ] **Step 3: Implement** zgodnie z Interfaces.
- [ ] **Step 4: Run** `npm test && npm run typecheck` – Expected: PASS.
- [ ] **Step 5: Commit** – ścieżki zadania.

---

### Task 6: Pieniądze i przegląd „Dziś” w API konsoli

**Files:**
- Modify: `apps/api/src/routes/platform/billing.ts`, `studios.ts`
- Test: `apps/api/test/platform-billing.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/platform/payments?status=uninvoiced|all` (admin, finance) → `{ id, studio, studioId, companyName, nip, amount, amountGrosze, periodStart, periodEnd, paidAt, invoicedAt, invoiceNumber }[]`
  - `POST /api/platform/payments/:id/invoice {number}` (admin, finance) – numer niepusty, ≤ 40 znaków; ponowne oznaczenie → 409; audit `payment.invoiced`
  - `GET /api/platform/payments.csv?from=YYYY-MM-DD&to=YYYY-MM-DD` → `text/csv; charset=utf-8`, separator `;`, BOM, kolumny: `Data płatności;Studio;Firma;NIP;Okres od;Okres do;Kwota brutto;Nr faktury`
  - `GET /api/platform/overview` (wszystkie role) → `{ mrr: string, mrrGrosze: number, paying: number, byPlan: { plan, studios, mrr }[], trialsEnding: Row[], pastDue: Row[], overLimit: Row[], overdueTickets: number, openIncidents: number }`, gdzie `Row = { id, name, hint }`. MRR = suma cen planów studiów z `studio_billing.state = 'active'` (z `PLANS`, nie z faktur).

- [ ] **Step 1: Write the failing tests:** finanse widzi płatność z Task 5 na `uninvoiced`; oznaczenie `FV/2026/11/001` → znika z `uninvoiced`, audit zawiera wpis; drugie oznaczenie → 409; wsparcie → 403; CSV zaczyna się od `﻿Data płatności;` i zawiera `FV/2026/11/001`; `overview.paying = 1`, `mrrGrosze = 39900` po aktywacji studia na planie `studio`.
- [ ] **Step 2: Run** – Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck` – Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Task 7: Twardy limit SMS studia

**Files:**
- Create: `apps/api/src/services/studio-sms.ts`
- Modify: `apps/api/src/services/dispatch.ts`, `apps/api/src/routes/client.ts` (3 miejsca: ~410, ~679, ~949), `apps/api/src/routes/staff.ts` (~631)
- Test: `apps/api/test/platform-billing.test.ts`

**Interfaces:**
- Consumes: `smsAllowed` (Task 1), `logUsage` (`dispatch.ts`).
- Produces: `export async function sendStudioSms(deps: Deps, studio: { id: string; plan_id: string | null }, phone: string, text: string): Promise<boolean>` – `false` bez wysyłki, gdy limit planu na bieżący miesiąc (`usage_log`, `kind = 'sms'`, od `date('now','start of month')`) wyczerpany; inaczej wysyła i `logUsage(..., 'sms', 1, SERVICE_PRICES.smsGrosze)`.
  Zachowanie przy `false`: `dispatch` – powiadomienie leci pushem (jak kanał domyślny); `client.ts` – błąd 429 `studio_sms_limit` „Studio wykorzystało w tym miesiącu pulę SMS. Podaj znajomej kod studia: {invite_code}.”; `staff.ts` – 429 „Pula SMS na ten miesiąc się skończyła. Skopiuj link i wyślij go klientce.” z linkiem w `details.link`.

- [ ] **Step 1: Write the failing tests:** wstaw do `usage_log` 300 SMS-ów dla studia na planie `start`; zaproszenie znajomej (trasa z `client.ts:~410`) → 429 `studio_sms_limit`, `ConsoleSmsGateway` nie dostał wiadomości; przy 299 → 200 i jeden nowy wpis w `usage_log`; dzienne limity klientki (`CLIENT_SMS`) nadal działają jak wcześniej (istniejące testy zielone).
- [ ] **Step 2: Run** – Expected: FAIL.
- [ ] **Step 3: Implement** i podmień 5 wywołań `deps.sms.send` + `logUsage` na `sendStudioSms`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` – Expected: PASS.
- [ ] **Step 5: Commit** – bez `routes/client.ts`, jeśli ma cudze zmiany (zgłoś w raporcie).

---

### Task 8: Powierzchnia `/konsola` – szkielet, Dziś, Studia

**Files:**
- Modify: `apps/web/src/api.ts` (`Surface` + `'konsola'`; `SURFACE` rozpoznaje `/konsola`)
- Modify: `apps/web/src/demo.ts` (`PERSONAS.konsola`: `admin` 500000009 „Zespół GLAM · admin”, `wsparcie` 500000010, `finanse` 500000011)
- Modify: `apps/web/src/App.tsx` (`if (SURFACE === 'konsola') return <Lazy><KonsolaApp /></Lazy>` – leniwie, przed `home`)
- Create: `apps/web/src/konsola/KonsolaApp.tsx` (logowanie demo jak `Surface`, `GET /platform/me`, menu boczne jak `StaffApp` z sekcjami wg roli, hash-routing `#sekcja/id`)
- Create: `apps/web/src/konsola/Today.tsx`, `apps/web/src/konsola/Studios.tsx`, `apps/web/src/konsola/StudioCard.tsx`

**Interfaces:**
- Consumes: `/api/platform/me`, `/overview`, `/studios?filter=`, `/studios/:id`, `/studios/:id/{suspend,unsuspend,trial,flags}`, `PUT /studios/:id {planId}`, `POST /api/platform/access` (Tasks 3–6). Wszystkie wywołania z `{ global: true }`.
- Produces: `KonsolaApp` z sekcjami `today | studios | money | support | team | log`; `Section = { id, label, icon, roles: PlatformRole[] }`; Tasks 9 dopisuje komponenty do tej listy.

- [ ] **Step 1:** Implementuj szkielet i sekcje. Dziś: `Stat` dla MRR i płacących; listy `ListRow` (triale kończące się, zaległe, ponad limitem) prowadzą do karty studia; liczniki zgłoszeń po SLA i incydentów prowadzą do „Wsparcie”. Studia: `Tabs` filtrów + `ListRow` (nazwa, `hint` = miasto · plan · klientki, `badge` = stan). Karta studia: plan (Select, tylko admin), stan i rozliczenia, `Progress` dla każdego `LimitUsage`, `Toggle` flag (admin; trzy stany: jak w planie / wł. / wył.), technikalia, kontakt do właścicielki, historia; „Zawieś” otwiera `Sheet` z polem powodu (przycisk aktywny od 10 znaków); „Przedłuż trial” – `Sheet` z wyborem 7/14/30 dni.
- [ ] **Step 2: Verify** `npm run typecheck` – PASS. Podgląd (`preview_start`): `/konsola` jako admin – Dziś i Studia się ładują, karta Rzeszowa pokazuje limity; `/konsola?jako=finanse` – brak sekcji Wsparcie/Zespół, brak przycisków zmiany planu; konsola przeglądarki bez błędów.
- [ ] **Step 3: Commit** – nowe pliki + `api.ts`, `demo.ts` (+ `App.tsx`, jeśli bez cudzych zmian).

---

### Task 9: Konsola – Pieniądze, Wsparcie, Zespół, Dziennik

**Files:**
- Create: `apps/web/src/konsola/Money.tsx`, `Support.tsx`, `Team.tsx`, `Log.tsx`
- Modify: `apps/web/src/konsola/KonsolaApp.tsx` (podpięcie sekcji)

**Interfaces:**
- Consumes: `/api/platform/payments*`, `/tickets*`, `/incidents*`, `/team*`, `/audit` (Tasks 3, 6; trasy help desku istniejące).

- [ ] **Step 1:** Implementuj. Pieniądze: `Tabs` „Do zafakturowania / Wszystkie”, `ListRow` (studio · okres, `badge` = kwota), wiersz otwiera `Sheet` z danymi firmy, NIP i polem „Numer faktury” → „Oznacz jako zafakturowaną”; przycisk „Eksport CSV” z wyborem miesiąca; podsumowanie MRR wg planów. Wsparcie: zgłoszenia posortowane jak API (po SLA), przekroczone oznaczone, wątek + odpowiedź + „Zamknij”; incydenty: zgłoś (komponent, status, opis) i „Rozwiąż”. Zespół: lista + „Zaproś” (telefon, imię, rola), zmiana roli, wyłączenie z potwierdzeniem. Dziennik: `ListRow` z działaniem, osobą, studiem i datą.
- [ ] **Step 2: Verify** typecheck + podgląd: oznacz płatność jako zafakturowaną (wymaga płatności z seeda – dopisz w `seed.ts` jedną opłaconą płatność platformy dla Rzeszowa), zaproś osobę, odpowiedz na zgłoszenie; wpisy widoczne w Dzienniku.
- [ ] **Step 3: Commit.**

---

### Task 10: `/start` – cennik i rejestracja

**Files:**
- Create: `apps/web/src/site/StartSite.tsx`
- Modify: `apps/web/src/App.tsx` (`/start` → `<Lazy><StartSite /></Lazy>`, przed `HomeOrDomain`; persona `signup` w `pickPersona`/`Surface`)
- Modify: `apps/web/src/api.ts` (`export function handOffSession(surface: 'panel', token: string, studioId: string): void` – zapisuje `glam.panel.token`, `glam.panel.studio`, `glam.panel.persona = 'signup'`)
- Modify: `apps/web/src/screens/Landing.tsx` (trzeci kafelek „Dla właścicielki · Załóż studio” → `/start`)

**Interfaces:**
- Consumes: `GET /api/platform/plans` (cennik), `PRESETS` z `@glam/core` (rodzaje studia – bez nowej trasy), `POST /api/auth/request-code`, `POST /api/signup/studio`.
- `Surface`: gdy `session.persona === 'signup'` i brak `?jako=` → używa zapisanego tokenu, nie loguje persony demo.

- [ ] **Step 1:** Implementuj. Cennik: trzy plany (nazwa, cena/mies., limity, funkcje), wyróżniony „Studio”, nagłówek „21 dni za darmo, bez karty”. Rejestracja w 3 krokach w jednym widoku z postępem: (1) telefon → „Wyślij kod” → pole kodu; (2) nazwa, miasto, rodzaj studia, plan (domyślnie wybrany z cennika); (3) imię i nazwisko, e-mail, checkbox regulaminu i DPA. „Dalej” aktywne tylko przy poprawnych polach (`validEmail` z core, długości jak w API). Błąd API (np. zły kod) pokazany przy polu, którego dotyczy. Po sukcesie `handOffSession` i `location.href = '/panel'`.
- [ ] **Step 2: Verify** podgląd: `/start` → rejestracja nowego studia (kod z `devCode`) → ląduje w `/panel` nowego studia (nie Joanny), „Abonament” pokazuje trial 21 dni; `/panel?jako=joanna` wraca do demo.
- [ ] **Step 3: Commit.**

---

### Task 11: „Abonament” w panelu studia i pasek

**Files:**
- Create: `apps/web/src/staff/Billing.tsx`
- Modify: `apps/web/src/staff/Settings.tsx` (zakładka `plan`: etykieta „Abonament i wsparcie”; sekcja planu z `PlanSupport` zastąpiona `<Billing />`; formularz zgłoszeń zostaje)
- Modify: `apps/web/src/staff/StaffApp.tsx` (pasek dla właścicielki)
- Modify: `apps/api/src/routes/platform/billing.ts` (`GET /api/owner/billing/banner` → `{ text: string; tone: 'info' | 'warn' } | null`)
- Test: `apps/api/test/platform-billing.test.ts` (banner)

**Interfaces:**
- Consumes: `/api/owner/billing*` (Task 5).
- Banner – kolejność priorytetu: `past_due` („Płatność za GLAM nie przeszła – zaktualizuj kartę do {data końca karencji}”), trial ≤ 5 dni bez karty („Okres próbny kończy się za {n} dni – dodaj kartę, żeby studio działało dalej”), jakikolwiek limit `over` („Studio przekroczyło limit: {label}. Zobacz plany”). Brak → `null`. Tylko rola `owner`.

- [ ] **Step 1: Write the failing test:** banner `null` dla studia `active` w limitach; trial za 3 dni bez karty → tekst zawiera „3 dni”; recepcja → 403.
- [ ] **Step 2: Run** – FAIL; **Step 3: Implement** endpoint i UI. Billing: wiersz stanu (plan, stan, następna płatność / koniec triala), liczniki `Progress` z `LimitUsage` (stan `near`/`over` + jedna propozycja wyższego planu), dane do faktury (pola z walidacją; NIP sprawdzany `validNip` w locie), przyciski: „Dodaj kartę” (gdy `!hasCard`), „Zmień plan” (`Sheet` z trzema planami i informacją „od razu” / „od {data}”), „Karta i płatności” (portal), „Zrezygnuj” / „Wznów”; lista opłaconych okresów. `configured: false` → zamiast przycisków jedno zdanie „Płatności abonamentu wkrótce – do tego czasu studio działa normalnie”. Powrót z Checkout (`?billing=ok`) → toast „Karta zapisana” i odświeżenie. Pasek: jedno zdanie + przycisk „Abonament” → `setSection('settings')` z zakładką `plan`.
- [ ] **Step 4: Verify** `npm test && npm run typecheck` + podgląd jako Joanna (`/panel#settings`): zakładka, liczniki, formularz danych; pasek widoczny po ustawieniu w bazie triala na 3 dni; niewidoczny dla `?jako=kasia`.
- [ ] **Step 5: Commit.**

---

### Task 12: Weryfikacja końcowa

- [ ] **Step 1:** `npm test` i `npm run typecheck` – wszystko zielone; zanotuj liczbę testów.
- [ ] **Step 2:** Podgląd w przeglądarce, ścieżka: `/` (kafelek „Załóż studio”) → `/start` → rejestracja → `/panel` „Abonament” → `/konsola` jako admin (nowe studio widoczne w Studiach i w „Dziś” jako trial) → `?jako=wsparcie` (przedłużenie triala, brak Pieniędzy) → `?jako=finanse` (Pieniądze, CSV). Zrzuty ekranu konsoli i „Abonamentu”.
- [ ] **Step 3:** Szerokość telefonu (375 px) dla `/start` i „Abonamentu” – bez poziomego przewijania.
- [ ] **Step 4:** Raport: co zacommitowane, które pliki zostały niezacommitowane z powodu cudzych zmian, czego nie dało się sprawdzić (prawdziwy Stripe – tylko podstawka; wymaga kluczy testowych GLAM i ręcznego testu Checkout/Portalu).
