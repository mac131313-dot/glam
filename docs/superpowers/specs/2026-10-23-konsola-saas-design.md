# Konsola GLAM i GLAM jako SaaS – projekt

Data: 2026-10-23 · Status: do przeglądu

## 1. Cel i zakres

Dwie rzeczy, które dziś mają backend, ale nie mają interfejsu, oraz brakujący przepływ pieniędzy GLAM ↔ studio:

1. **Konsola GLAM** (`/konsola`) – panel dla zespołu GLAM do zarządzania platformą i kontami studiów.
2. **Samoobsługa studia** – publiczny cennik i rejestracja (`/start`) oraz ekran „Abonament” w panelu studia.
3. **Abonament** – GLAM pobiera opłatę od studiów przez własne konto Stripe; faktury VAT wystawiane ręcznie na podstawie listy w konsoli.

### Ustalenia z rozmowy

| Temat | Decyzja |
|---|---|
| Odbiorcy | Konsola dla zespołu GLAM + samoobsługa dla studiów |
| Abonament | Stripe (konto GLAM) pobiera automatycznie; faktury ręcznie, konsola daje listę „do zafakturowania” (integracja z fakturownią + KSeF później) |
| Zespół | Role: Admin, Wsparcie, Finanse; zapraszanie numerem telefonu |
| Limity | Miękkie (klientki, kadra, wideo, obiekty) – licznik i propozycja wyższego planu; **twardy limit SMS** |
| Architektura | Nowa powierzchnia `/konsola` w `apps/web`, wspólne API i komponenty |
| Karta | Niewymagana przy rejestracji; 21 dni triala bez karty |

### Poza zakresem (kolejne etapy)

- Podgląd panelu studia przez wsparcie (sesja tylko do odczytu z banerem). Dziś „wejście w dane” = wpis w `platform_access_log`.
- Automatyczne faktury VAT / KSeF.
- Osobna domena konsoli (możliwa później bez przepisywania – powierzchnie rozpoznawane są po ścieżce).

## 2. Stan wyjściowy

- `apps/api/src/routes/platform.ts`: lista studiów z metrykami, zmiana planu/statusu, flagi funkcji, log dostępu, help desk z SLA, incydenty i `/api/status`, `/api/signup/studio` z weryfikacją e-maila. **Brak UI** – nic w `apps/web` tego nie woła.
- Admin platformy = numer z `GLAM_PLATFORM_ADMINS`, bez ról.
- `packages/core/src/saas.ts`: `PLANS` (Start / Studio / Sieć) z limitami, `TRIAL_DAYS = 21`, `featureEnabled`. Limity nigdzie nie są egzekwowane.
- `/api/owner/plan` (owner.ts) liczy zużycie: aktywne klientki, SMS w miesiącu, storage, kadra, obiekty.
- `jobs.ts`: po końcu triala studio przechodzi w `suspended`.
- `studios.status` ma `CHECK (status IN ('trial','active','suspended'))`; `context.ts` blokuje klientki zawieszonego studia (423).

## 3. Dane

Stan **dostępu** zostaje w `studios.status` (bez migracji CHECK). Stan **rozliczeń** trafia do osobnej tabeli; jedna funkcja w `core` przekłada rozliczenia na dostęp.

```sql
CREATE TABLE IF NOT EXISTS platform_staff (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'support', 'finance')),
  invited_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS studio_billing (
  studio_id TEXT PRIMARY KEY REFERENCES studios(id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  state TEXT NOT NULL DEFAULT 'none' CHECK (state IN ('none', 'active', 'past_due', 'canceled')),
  current_period_end TEXT,
  past_due_since TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  pending_plan_id TEXT,              -- obniżenie planu od następnego okresu
  manual_suspension TEXT,            -- powód ręcznego zawieszenia przez Admina; NULL = brak
  company_name TEXT,
  nip TEXT,
  address TEXT,
  invoice_email TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_payments (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  amount_grosze INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  invoiced_at TEXT,
  invoice_number TEXT,
  invoiced_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS platform_stripe_events (
  id TEXT PRIMARY KEY,               -- id zdarzenia Stripe (idempotencja)
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,              -- np. studio.plan, studio.suspend, studio.flag, team.invite, payment.invoiced
  studio_id TEXT REFERENCES studios(id),
  details_json TEXT,
  created_at TEXT NOT NULL
);
```

Przy starcie API: każdy numer z `GLAM_PLATFORM_ADMINS`, który nie ma wpisu w `platform_staff`, dostaje rolę `admin` (bootstrap). Dalej zespołem zarządza się w konsoli.

## 4. Reguły domeny (`packages/core/src/saas.ts`)

- `accessFromBilling(studio, billing, now): 'trial' | 'active' | 'suspended'`
  - trial przed `trial_ends_at` → `trial`;
  - `billing.state = 'active'` → `active`;
  - `past_due` krócej niż `BILLING_GRACE_DAYS` (7) od `past_due_since` → `active`; dłużej → `suspended`;
  - `canceled` po `current_period_end` → `suspended`;
  - koniec triala bez subskrypcji → `suspended`.
  - Ręczne zawieszenie ma pierwszeństwo: `billing.manual_suspension` niepuste → `suspended`. Odwieszenie przez Admina czyści pole i status wraca do wyniku reguł powyżej. Każda zmiana trafia do `platform_audit`.
- `planUsage(usage, plan)` → dla każdego limitu `{ used, limit, state: 'ok' | 'near' | 'over' }`; `near` od 80%.
- `smsAllowed(usedThisMonth, plan)` → twardy limit SMS.

## 5. Stripe GLAM

- Konfiguracja z env: `GLAM_STRIPE_SECRET`, `GLAM_STRIPE_WEBHOOK_SECRET`, `GLAM_STRIPE_PRICE_START|STUDIO|SIEC`. Osobno od bramek studiów (`gateway_enc`).
- Reużycie helperów z `services/stripe.ts` (`formEncode`, `createCustomer`, `verifyStripeSignature`, `signStripePayload` w testach); REST przez `fetch`, bez SDK.
- **Dodanie karty**: Checkout `mode=subscription`, `subscription_data.trial_end` = koniec triala studia (gdy jeszcze trwa). Metadane `studio_id`.
- **Zmiana karty, historia w Stripe**: hostowany Billing Portal.
- **Zmiana planu**: podwyższenie – natychmiast z proporcją; obniżenie – `pending_plan_id`, zmiana od następnego okresu.
- **Rezygnacja**: `cancel_at_period_end = true`.
- **Webhook** `POST /api/platform/stripe` (surowe body, jak istniejący webhook studiów): `checkout.session.completed`, `invoice.paid` (→ `platform_payments`), `invoice.payment_failed` (→ `past_due`), `customer.subscription.updated`, `customer.subscription.deleted`. Każde zdarzenie najpierw do `platform_stripe_events`; duplikat = 200 bez efektów.
- Po każdej zmianie rozliczeń oraz w dziennym jobie: `studios.status = accessFromBilling(...)`. Zastępuje obecne zawieszanie po trialu w `jobs.ts`.
- Bez konfiguracji Stripe: trial działa, ekran „Abonament” pokazuje „Płatności abonamentu wkrótce”, Admin może ręcznie ustawić status w konsoli.

## 6. API

`routes/platform.ts` rozbity na `routes/platform/`:

| Plik | Trasy |
|---|---|
| `studios.ts` | lista z filtrami, karta studia, plan/status/trial, flagi, `fill`, dostęp z powodem |
| `team.ts` | `GET/POST /api/platform/team`, zmiana roli, wyłączenie (unieważnia sesje) |
| `billing.ts` | webhook, `/api/platform/payments` (do zafakturowania, oznaczenie), eksport CSV, MRR; `/api/owner/billing` (stan, checkout, portal, zmiana planu, rezygnacja, dane do faktury) |
| `support.ts` | help desk platformy i studia, incydenty, `/api/status` |
| `signup.ts` | `/api/signup/studio` (+ wpis `studio_billing`), weryfikacja e-maila |
| `index.ts` | `requirePlatform(...roles)`, `platformAudit()` |

Pozostałe trasy z obecnego `platform.ts` (kalendarz `.ics`, linki płatności, webhooki studiów, `/api/checkout/:id`) przenoszą się bez zmian do `routes/payments-public.ts`.

### Macierz uprawnień

| Działanie | Admin | Wsparcie | Finanse |
|---|---|---|---|
| Dziś (przegląd) | ✓ | ✓ | ✓ |
| Studia – podgląd | ✓ | ✓ | ✓ |
| Plan, status, flagi, zawieszenie | ✓ | – | – |
| Przedłużenie triala | ✓ | ✓ | – |
| Wejście w dane z powodem | ✓ | ✓ | – |
| Pieniądze, faktury, CSV | ✓ | – | ✓ |
| Help desk, incydenty | ✓ | ✓ | – |
| Zespół | ✓ | – | – |
| Dziennik | ✓ | ✓ | – |

Serwer egzekwuje macierz; UI jedynie ukrywa niedostępne elementy. Konsola nie zwraca danych klientek (T7/T8) – tylko liczby i dane firmy studia.

## 7. Konsola GLAM (`/konsola`)

Nowa leniwie ładowana powierzchnia (`SURFACE = 'konsola'`), własna sesja `glam.konsola.token`, logowanie SMS; w demo persona „Zespół GLAM”. Wygląd zgodny z panelem: minimalizm, `ListRow`, cyfry bez szeryfu, mało przycisków.

- **Dziś** – MRR i liczba płacących studiów; triale kończące się w 7 dni; nieudane płatności; zgłoszenia po SLA; studia ponad limitem; otwarte incydenty. Każda pozycja prowadzi do szczegółu.
- **Studia** – lista (nazwa, miasto, plan, stan, klientki, sygnały) z filtrami trial/aktywne/zaległe/zawieszone. Karta studia: plan i rozliczenia, zużycie vs limity, flagi, technikalia (zapytania, błędy, średni czas, storage), kontakt do właścicielki, historia z `platform_audit`. Zawieszenie wymaga powodu; właścicielka dostaje e-mail.
- **Pieniądze** – płatności do zafakturowania (oznacz „zafakturowano” + numer), zaległości, MRR wg planów, eksport CSV.
- **Wsparcie** – help desk z SLA, incydenty strony statusu.
- **Zespół** – lista, zaproszenie numerem + rola, wyłączenie.
- **Dziennik** – `platform_audit` + `platform_access_log`.

## 8. Samoobsługa studia

### `/start` – cennik i rejestracja (publiczne)
- Plany z `PLANS` (cena, limity, funkcje z `FEATURE_LABEL`) – zero treści na sztywno. „21 dni za darmo, bez karty”.
- Rejestracja w 3 krokach, pola same pilnują wartości:
  1. telefon + kod SMS (`/api/auth/request-code`);
  2. studio: nazwa, miasto, rodzaj (`PRESETS`), plan;
  3. właścicielka: imię, e-mail, zgoda na regulamin i DPA.
- Po sukcesie przejście do `/panel` z sesją zwróconą przez `/api/signup/studio`.

### Panel studia → Ustawienia → „Abonament” (tylko właścicielka)
- Plan i stan („Okres próbny – zostało 12 dni”, „Następna płatność 14.11 · 399 zł”, „Płatność nieudana – zaktualizuj kartę do 30.10”).
- Liczniki limitów (cyfry bez szeryfu, delikatny pasek); `near`/`over` z jedną propozycją wyższego planu.
- Akcje: **Dodaj kartę** / **Zmień plan** (Checkout lub aktualizacja subskrypcji), **Karta i płatności** (Billing Portal), lista opłaconych okresów.
- Dane do faktury (firma, NIP z walidacją `validNip`, adres, e-mail) – wymagane przed dodaniem karty.
- **Zrezygnuj** – koniec odnawiania na koniec opłaconego okresu.

### Pasek w panelu
Tylko właścicielka, tylko gdy: ≤ 5 dni triala bez karty, nieudana płatność, przekroczony limit. Jedno zdanie, jeden przycisk do „Abonamentu”.

### E-maile do właścicielki
5 dni i 1 dzień przed końcem triala, nieudana płatność, zawieszenie (`deps.email`).

### Twardy limit SMS
Wysyłka SMS studia sprawdza `smsAllowed` na podstawie `usage_log` z bieżącego miesiąca. Po przekroczeniu powiadomienie idzie kanałem push/e-mail, a właścicielka widzi stan w „Abonamencie”. Limity klientek (`CLIENT_SMS`) działają jak dotąd, niezależnie.

## 9. Testy i weryfikacja

- `packages/core/test/saas.test.ts`: `accessFromBilling` (trial, aktywne, karencja, po karencji, rezygnacja przed/po końcu okresu, ręczne zawieszenie), `planUsage`, `smsAllowed`.
- `apps/api/test/platform.test.ts`:
  - macierz ról × trasy (403 dla braku roli i dla wyłączonej osoby);
  - webhook: zły podpis → 403; duplikat zdarzenia → bez efektu; `invoice.paid` → wpis w `platform_payments` i `active`; `payment_failed` → `past_due`; `subscription.deleted` → `suspended` po końcu okresu;
  - rejestracja zakłada `studio_billing`;
  - oznaczenie faktury → wpis w `platform_audit`;
  - twardy limit SMS.
- `npm test`, `npm run typecheck`; w przeglądarce: `/start` → `/panel` (Abonament) → `/konsola` (Dziś, Studia, Pieniądze, Zespół).

## 10. Ryzyka

- **Równoległe sesje** w repo: rozbicie `platform.ts` dotyka pliku, który mogą edytować inne sesje – przed przeniesieniem sprawdzić mtime/`git status` i robić w jednym kroku.
- **Rozjazd Stripe ↔ baza** przy zgubionym webhooku – łagodzi go dzienny job przeliczający dostęp; w razie potrzeby Admin ręcznie ustawia status.
- **Faktury ręczne** nie skalują się – lista „do zafakturowania” jest pomostem do integracji z fakturownią/KSeF.
