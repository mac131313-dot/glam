# GLAM

Aplikacja i platforma SaaS dla studiów ruchu i wellness dla kobiet.
Źródło prawdy: **Baza wiedzy GLAM v2.10** (numery sekcji w kodzie i poniżej odnoszą się do niej). Warto wrzucić ją do `docs/baza-wiedzy.md`.

## Szybki start

```bash
npm install
npm run dev        # seed danych demo + API (:3001) + aplikacja (:5173)
npm test           # silnik reguł, izolacja studiów, rezerwacje, wygląd, oddech…
npm run typecheck
```

Wymaga Node 24+ (TypeScript uruchamiany natywnie, wbudowany `node:sqlite` – bez kroku budowania i bez zewnętrznej bazy).

**Tryb demo – bez logowania** (na razie): każda powierzchnia loguje się sama na konto demo.

| Adres | Co to jest | Konto domyślne |
|---|---|---|
| http://localhost:5173/ | strona startowa z oboma wejściami | – |
| http://localhost:5173/panel | panel studia (zarządzanie wszystkim) | Joanna, właścicielka |
| http://localhost:5173/app | aplikacja mobilna klientki (na komputerze w ramce telefonu) | Magda, klientka w 2 studiach |

Inne konto: dopisz `?jako=` – panel: `marzena` (trenerka), `kasia` (recepcja), `beata` (inne studio); aplikacja: `ania` (nowa klientka).
Logowanie demo działa tylko poza produkcją (`/api/dev/login`); ekran z kodem SMS (`screens/Login.tsx`) wraca po ustawieniu `DEMO_MODE = false` w `apps/web/src/api.ts`.
**Na telefonie:** serwer aplikacji jest widoczny w sieci lokalnej (`host: true` w `apps/web/vite.config.ts`). Telefon w tej samej sieci Wi-Fi otwiera `http://<adres-komputera>:5173/app` – adres pokazuje `npm run dev` w linii „Network”. API zostaje na 127.0.0.1 i jest dostępne tylko przez proxy serwera aplikacji.
Aplikacja jest domyślnie w trybie jasnym; klientka może wybrać ciemny lub „jak w systemie” w Profilu.

## Architektura

```
packages/core   Domena jako czyste funkcje (współdzielona przez API i aplikację)
  products.ts   Silnik produktów 1.1.3: pula wejść, dostęp czasowy, okno, limity, opisy w języku klientki
  booking.ts    Regulamin czasowy, miejsca, lista oczekujących (4.1)
  schedule.ts   Harmonogram cykliczny z wyjątkami → sesje (C7)
  push.ts       Ciche godziny, limity dzienne, „Potrzebuję ciszy” (8, 8.1)
  time.ts       Strefa czasowa studia (poprawnie przez zmianę czasu)
apps/api        Fastify + node:sqlite
  scope.ts      StudioScope – izolacja najemców: SQL bez $studio się nie wykona (1.2.3)
  auth.ts       Telefon + kod SMS: 6 cyfr / 5 min / ponownie po 60 s / blokada 15 min po 5 błędach
  services/     rezerwacje i awans z listy, auto-uzupełnianie grafiku, blokady sal, powiadomienia
  routes/       konto, klientka, personel, właścicielka, platforma
apps/web        React + Vite, mobile-first PWA: klientka (5 zakładek) + panele ról
```

**Zasady, które kod egzekwuje:**
- Konfiguracja to dane, nie kod. Produkt = reguły z ograniczonej listy klocków.
- Kupiony karnet ma kopię reguł z wersji produktu. Zmiana ceny lub reguł tworzy nową wersję (C5).
- Każdy rekord ma `studio_id`. Studio bierzemy z uwierzytelnionego kontekstu, nigdy z danych od klienta. Brak członkostwa zwraca 404.
- Jeden aktywny motyw na studio pilnuje unikalny indeks w bazie (7.7).
- Powitanie pisze człowiek: limit 400 znaków i max 3 wykrzykniki (6.5–6.6).

## Co jest zrobione (MVP z sekcji 9)

| # | Funkcja | Status |
|---|---|---|
| 1, 44 | Logowanie numerem + kod SMS, limity, wylogowanie zdalne | ✅ (adapter SMS konsolowy) |
| 3–5, 7 | Grafik, rezerwacja, odwołanie, auto-uzupełnianie, limity, lista oczekujących z awansem, blokady | ✅ |
| 8–10 | Karnety, zakup w apce, stan karnetu + „Przedłuż”, historia | ✅ (płatność symulowana) |
| 12 | Push transakcyjny (skrzynka w aplikacji, reguły wysyłki) | ✅ bez APNs/FCM |
| 14 | Raporty podstawowe (pulpit) | ✅ |
| 21–22 | Ćwiczenia oddechowe (4–6, box), cel tygodnia | ✅ |
| V1–V3, V5 | Wejściówka dla znajomej: aplikacja / kasa, SMS, aktywacja numerem, statusy | ✅ |
| P1, P2, P4–P7 | Popup od trenerki, edytor, szablony, akceptacja, lista bez powitania, skrzynka | ✅ |
| M2, M4, M9 | Ręczne motywy, opt-out „Zawsze standard”, podgląd na telefonie | ✅ |
| C1–C5, C7 | Strefy i typy, silnik produktów, typy dostępu, podgląd klientki, wersjonowanie, harmonogram | ✅ (kreator stref – v1.1) |
| T1–T4, T7, T8 | Wiele studiów, konto w wielu studiach, izolacja + testy, marka studia, admin platformy, log dostępu | ✅ |
| N2, N3 | Data urodzin bez roku, „Potrzebuję ciszy” | ✅ (wysyłka życzeń – kolejny krok) |

**Następne kroki (kolejność proponowana):** trening we dwie (#6) → bramka SMS i płatności produkcyjne (P24/BLIK, webhooki) → push APNs/FCM z kolejką wysyłek → ankieta uśpionych (#13) → kursy K1–K6 → biblioteka medytacji (#20) → feed studia (#25) → onboarding studia i kreator obiektu (T6, C1) → Postgres + RLS → Expo/Capacitor do App Store i Google Play.

## Wygląd i czcionki

Estetyka: minimalizm i miękkość z moodboardów (Isola, Unbound). Neutralne tony, geometryczny sans, a jedynym ozdobnikiem jest szeryf w kursywie. Zaokrąglone płaszczyzny, przyciski-pigułki, pływający pasek nawigacji. W interfejsie nie ma emoji; zostają tylko w treściach pisanych przez ludzi (powitania, życzenia).

Wygląd to **dane studia** (`packages/core/src/look.ts`): paleta, cztery role czcionek (akcent / nagłówki / tekst / etykiety i kody) i miękkość. Właścicielka zmienia go w panelu: **Wygląd**, z podglądem telefonu na żywo.

**Czcionki w rejestrze:**
- Dostępne od razu (Google Fonts, OFL): Plus Jakarta Sans, Ballet, DM Mono (zastępczo za Apercu Mono) oraz zastępniki z moodboardu.
- Czekające na pliki: Alte Haas Grotesk, Louis George Café, Circular Std, Jane Austen, Relationship of Mélodrame, Altesse Std, Apercu Mono. W edytorze są widoczne, ale nie da się ich wybrać; serwer też je odrzuca.

**Dodanie plików:** oczekiwane nazwy i katalogi są w [apps/web/public/fonts/README.md](apps/web/public/fonts/README.md). Po wrzuceniu `.woff2` usuwa się flagę `pending` przy danym kroju. Licencja musi obejmować web i osadzenie w aplikacji mobilnej.

## Twój ruch: `pickPass()`

`packages/core/src/products.ts`: gdy klientka ma **kilka karnetów pasujących do tych samych zajęć**, system musi wybrać, z którego zdjąć wejście. To decyzja biznesowa, którą zostawiłem Tobie (teraz bierze pierwszy z brzegu).
