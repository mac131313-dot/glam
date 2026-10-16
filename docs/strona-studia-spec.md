# Specyfikacja strony studia (GLAM, `/s/:slug`)

Wersja dopasowana do GLAM z ogólnej specyfikacji „SOLVA Skin Studio” (gabinet kosmetyczny).
Ze źródła zostają: rytm edytorialny, animacje, zasada „jedno słowo w kursywie”, wydajność i dostępność.
Zmienia się prawie cała treść, bo GLAM to nie jedna marka, tylko **szablon strony dla każdego studia ruchu na platformie**.

Przykład w tym dokumencie: studio **SS&G** (reformery, zajęcia grupowe, aerial, siłownia), dane demo z `apps/api/src/seed-ssg.ts`.

---

## 0. Co zmieniamy względem SOLVA i dlaczego

| SOLVA (gabinet) | GLAM (studio ruchu) | Powód |
|---|---|---|
| Jedna marka, teksty na sztywno | Szablon dla wielu studiów. Treść z danych studia i edytora strony w panelu | GLAM to SaaS. Każde studio ma swoją stronę pod `/s/:slug` |
| Własna paleta „szałwia + glina” | Paleta, czcionki i miękkość z **wyglądu studia** (`packages/core/src/look.ts`) | Właścicielka ustawia wygląd raz, w panelu. Strona, aplikacja i panel wyglądają tak samo |
| Zabiegi | **Zajęcia** (typy zajęć z sal) + **grafik** na żywo | Klientka przychodzi po termin, nie po opis zabiegu |
| Cennik 3 pakietów | **Karnety** z silnika produktów (pule wejść, ważność, sale) | Cena i reguły to dane. Zmiana = nowa wersja produktu (C5) |
| Taśma produktów kosmetycznych | Taśma **zajęć** + istniejący **Sklep** (skarpety, napoje, odzież) | Sklep już jest (`ShopSite.tsx`, zakup w aplikacji) |
| „Umów wizytę”, formularz kontaktowy | **„Zapisz się”**: każde CTA prowadzi do aplikacji (`/app?go=…`) | Zapis, płatność i lista oczekujących żyją w aplikacji. Strona ich nie dubluje |
| Newsletter e-mail | **„Pobierz aplikację”** + wejściówka dla znajomej | Konto = numer telefonu i kod SMS. Nie zbieramy e-maili (decyzja 17) |
| Blog | **Wydarzenia i kursy** (warsztaty, Kurs Szpagatu, kursy online) | To mamy w danych. Blog byłby pustą sekcją w 90% studiów |
| Next.js + osobne podstrony | Jedna strona z kotwicami + istniejące podstrony sklepu i kursu | Obecny stack: React + Vite. Nie przepisujemy |

**Zasada nadrzędna (prostota dla każdego):** każda sekcja musi wyglądać dobrze bez zdjęć i z krótkim tekstem. Sekcja bez danych (brak opinii, brak wydarzeń) **znika sama**. Nie pokazujemy pustych miejsc.

---

## 1. Stack technologiczny

| Warstwa | Wybór | Uwagi |
|---|---|---|
| Framework | React 19 + Vite (bez zmian) | Strona: `apps/web/src/site/StudioSite.tsx`, routing w `App.tsx` |
| Style | Obecny `site.css` + zmienne CSS z wyglądu studia | Tailwind nie jest potrzebny. Tokeny pochodzą z danych, nie z configu |
| Animacje | **Bez biblioteki:** IntersectionObserver + CSS (`site/motion.ts`, `Reveal`, `SplitHeading`) | Zero kilobajtów więcej. `motion` dopiero, gdy będzie potrzebny `layoutId` lub sprężyny (pływające zdjęcie w 4.8) |
| Płynny scroll | **Bez Lenisa** | Strona jest głównie oglądana na telefonie (link z Instagrama). Lenis psuje natywny scroll iOS i kotwice |
| Slidery | CSS `scroll-snap` | Na telefonie swipe jest natywny. Embla tylko, jeśli zabraknie autoplay |
| Obrazy | `siteImageUrl()` + `loading="lazy"`, `fetchpriority="high"` tylko w hero | Zdjęcia i filmy w pętli wgrywa studio w edytorze |

---

## 2. Design tokens: z wyglądu studia

Kolory **nie są wpisane w kod**. Strona czyta paletę studia i tłumaczy ją na role:

```css
/* nadawane przez StudioBrand / look.ts na .site-root */
--bg        /* tło strony (paleta studia, np. „sand”) */
--bg-alt    /* co druga sekcja: tło lekko przyciemnione */
--accent    /* akcent studia (SS&G: #b9cfe0), hover przycisków, podkreślenia */
--accent-soft
--ink       /* tekst i przyciski-pigułki: zawsze ink, nigdy taupe pod białym tekstem (kontrast) */
--muted
--line
```

Typografia: **cztery role z wyglądu studia** (display / head / body / label). Dla SS&G: Playfair (kursywa), Urbanist, Plus Jakarta Sans.

| Rola | Rola czcionki studia | Rozmiar (desktop / mobile) |
|---|---|---|
| Wielka nazwa studia w hero i stopce | head, 800 | `clamp(80px, 18vw, 280px)` |
| H2 | head, 600 | 64 / 40 px |
| Słowo w kursywie | **display, italic** (jedyny ozdobnik) | jak nagłówek |
| Tytuł karty | head, 600 | 24 / 20 px |
| Tekst | body | 18 / 16 px |
| Etykiety, godziny | label, UPPERCASE 13 px | tracking 0.12em |

Zasada stylu zostaje: **w każdym H2 jedno słowo kursywą**. Mamy to już w edytorze: pola „Tytuł” i „Dopisek w kursywie”.

Bez emoji w interfejsie strony. Emoji mogą być tylko w treściach pisanych przez studio.

Miękkość (`softness`) steruje zaokrągleniami: karty 16–28 px, zdjęcia 12–24 px, przyciski zawsze pigułka.

Odstępy, siatka, breakpointy i easingi zostają jak w SOLVA (kontener 1320 px, sekcje 160/96 px, `ease.out = [0.22, 1, 0.36, 1]`). Easingi trafiają do `apps/web/src/site/motion.ts`.

---

## 3. Globalne zachowania

Zostają bez zmian z SOLVA: **Reveal** przy scrollu, **SplitHeading** (słowo po słowie, kursywa z `rotate 4° → 0`), **przycisk-pigułka** z „rolką” tekstu i strzałką.

Zmiany:
- **Kursor własny: nie robimy.** Minimalizm, a większość ruchu jest z telefonu.
- **Przejścia między stronami:** tylko między stroną studia a podstroną sklepu lub kursu. Overlay w kolorze `--ink` z logo studia (`StudioBrand`).
- **Znak studia w rogu** (`Look.watermark`) zostaje. Nie animujemy go.
- **Tryb edytora:** gdy strona jest w podglądzie edytora (`EditorBridge`), animacje wejścia są wyłączone. Wszystko widać od razu, a kliknięcie sekcji nadal ją zaznacza (`data-edit-target`).

---

## 4. Sekcje strony (w kolejności domyślnej)

Kolejność, widoczność i etykiety w menu ustawia właścicielka w edytorze strony. Poniżej kolejność proponowana dla nowego studia.

### 4.1 Nawigacja
- Jak w SOLVA: przezroczysta nad hero, po 80 px tło z blurem, chowa się przy scrollu w dół.
- Po lewej logo studia (`StudioBrand`) albo nazwa. Na środku linki z pól `nav` sekcji (Studio, Grafik, Zajęcia, Trenerki, Karnety, Sklep). Po prawej przycisk z `nav.button` (domyślnie **„Zapisz się →”**), który otwiera aplikację.
- Mobile: hamburger → pełny ekran z `clip-path`, linki po kolei co 0.07 s.

### 4.2 Hero
- Wysokość `100svh`. Zdjęcie lub **film w pętli** z edytora (już obsługiwane: układy `full` / `side` / `cover`). Zostają promienie światła (`SideRays`).
- Lewy dolny róg: krótki wstęp (1 zdanie), przycisk „Zapisz się” i link „Grafik”.
- **Najbliższe zajęcia** (opcja w edytorze): 3 najbliższe terminy z godziną i liczbą wolnych miejsc. To nasz odpowiednik „Umów konsultację”, tylko żywy.
- **Nowości:** dyskretny dopisek „Nowość: Aerial Pilates”, jeśli studio dodało nowy typ zajęć.
- Na dole wielka nazwa studia (np. **SS&G**), litery wjeżdżają od dołu co 0.05 s. Przy scrollu nazwa jedzie w górę i blednie, zdjęcie robi parallax.

### 4.3 Studio: dlaczego tu (zamiast „4 filarów marki”)
- H2 np. „Ruch, który *Ci służy*”. Opis studia z edytora.
- **Do 4 kart-filarów**, pisanych przez studio (nowe pole w edytorze, opcjonalne). Propozycje na start dla SS&G:
  - **Małe grupy.** Na reformerach ćwiczy kilka osób, trenerka widzi każdą z nich.
  - **Dwie sale, jeden karnet.** Reformery, hamaki, drążek i siłownia w jednym miejscu.
  - **Zapis w dwa kliknięcia.** Grafik, karnet i lista oczekujących są w aplikacji.
  - **Każdy poziom.** Od pierwszych zajęć na reformerze po Kurs Szpagatu.
- Pod spodem fakty z danych (już są): sale i liczba zajęć w tygodniu, godziny recepcji, FAQ.
- Animacja kart jak w SOLVA (stagger 0.1 s, hover `y: -6px`). Ikona liniowa z naszego zestawu `icons.tsx`.

### 4.4 Zajęcia: taśma (zamiast taśmy produktów)
- Nagłówek: „CODZIENNY *ruch*”.
- **Taśma 1 → w lewo:** typy zajęć z pierwszej sali (SS&G: reformery). Karta: zdjęcie 4:5 albo kolor typu zajęć (każdy typ ma kolor w danych), nazwa, poziom, jedno zdanie opisu.
- **Taśma 2 → w prawo:** druga sala (zajęcia grupowe, aerial). Studio z jedną salą ma jedną taśmę.
- Między taśmami claim studia (pole z edytora).
- Mechanika jak w SOLVA: lista ×2, `x: 0 → -50%`, 40 px/s, na hover zwalnia do 0, przyspiesza od prędkości scrolla.
- Hover karty: zdjęcie `scale 1.05`, wysuwa się przycisk **„Grafik”**, który przewija do grafiku z filtrem tej sali.
- **Mniej niż 5 typów zajęć w sali:** zamiast taśmy zwykła siatka. Taśma z 2 kartami wygląda na pustą.

### 4.5 Pierwsza wizyta: tekst przypięty przy scrollu (zamiast sekcji edukacyjnej)
- Sekcja `300vh`, w środku `sticky`. Po lewej akapit, słowa podświetlają się od scrolla.
- Po prawej **3 kroki** zamiast 3 zdjęć, każdy wjeżdża z `clip-path` przy 33% i 66%:
  1. **Pobierz aplikację i podaj numer.** Bez haseł, kod przyjdzie SMS-em.
  2. **Wybierz zajęcia i karnet.** Na start pojedyncze wejście albo wejściówka od znajomej.
  3. **Przyjdź 10 minut wcześniej.** Weź skarpety antypoślizgowe, resztę mamy na miejscu.
- Tekst domyślny (studio może podmienić): „Nie musisz umieć. Wystarczy przyjść. Trenerka pokaże Ci sprzęt, dobierze tempo i zostanie z Tobą do końca zajęć.”
- To odpowiada na największą barierę nowej klientki („nie wiem, jak to wygląda”). Kroki 1–2 są z danych platformy, krok 3 pisze studio.

### 4.6 Manifest
- Bez zmian w mechanice: tło `--bg-alt`, 3 linie, w środkowej kursywa, wtopione pigułki ze zdjęciami (`scaleX`, nie `width`), rozjazd linii przy scrollu.
- Treść z edytora. Domyślna: „ZNAJDŹ / *swój rytm* / W NASZYM STUDIU”.
- Pigułki biorą zdjęcia z galerii studia. Bez zdjęć sekcja jest samym tekstem.

### 4.7 Grafik (nowa sekcja, której SOLVA nie ma, już istnieje)
- To najważniejsza sekcja dla klientki, która już zna studio. Zostaje obecna: przełącznik dni, wiersze z godziną, nazwą, trenerką i wolnymi miejscami („Ostatnie 2 miejsca”, „Lista oczekujących”).
- Dodajemy animacje: zmiana dnia to wyjście wierszy `y 0 → -12, opacity → 0` i wejście nowych ze staggerem 0.04 s. Aktywny dzień ma wskaźnik przesuwany przez `layoutId`.
- Przycisk „Zapisz się” przy wierszu otwiera aplikację od razu na tych zajęciach.

### 4.8 Zajęcia: akordeon z podglądem zdjęcia (zamiast zabiegów)
- H2 „Zajęcia dla *każdego ciała*”. Filtr sal (już jest: „Sala”).
- Lista typów zajęć z numerami 01–n: nazwa, poziom, strzałka. Desktop: hover przesuwa tekst o 16 px, a obok kursora pływa zdjęcie zajęć (sprężyna 150/20).
- Kliknięcie rozwija opis, poziom, salę, trenerki prowadzące i **„Najbliżej: wt 18:00”** + przycisk „Zapisz się”.
- Mobile: bez pływającego zdjęcia, zdjęcie w rozwiniętej treści.

### 4.9 Trenerki (istnieje)
- Karty ze zdjęciem i imieniem (bez odmiany imion: „prowadzi Weronika”). Panel z bio i zajęciami po kliknięciu, jak teraz.
- Animacja: zdjęcie odsłania się `clip-path` od dołu, stagger 0.08 s.

### 4.10 Opinie: slider
- H2 „Historie *pewności siebie*”. Karta: cytat kursywą (display), imię i zajęcia.
- **Tylko prawdziwe opinie, za zgodą klientek.** Źródło: oceny zajęć w aplikacji (`Feedback.tsx`). Klientka przy wystawianiu opinii zaznacza „Możecie pokazać ją na stronie”, a właścicielka wybiera w panelu, które trafią na stronę. Bez gwiazdek, bez zdjęć klientek (prywatność).
- Mechanika jak w SOLVA (autoplay 6 s, pauza na hover, licznik „01 / 04”, pasek postępu).
- Mniej niż 2 opinie: sekcja się nie pokazuje.

### 4.11 Karnety (zamiast cennika 3 pakietów)
- H2 „Wybierz *swój rytm*”. Dane z silnika produktów, nie z edytora strony.
- **3 karty wyróżnione** przez studio (np. Pojedyncze wejście / Karnet Open / Reformer 8 wejść), środkowa w kolorze `--ink` z tagiem „Najczęściej wybierany”. Treść kart pochodzi z opisu karnetu w języku klientki (`products.ts` już to generuje: „8 wejść na reformer, ważny 30 dni”).
- Pod spodem link „Wszystkie karnety (21) →”, który rozwija pełną listę pogrupowaną po salach.
- Promocje (np. „Back to school & Glow”) mają tag „Promocja” i datę końca.
- Przycisk karty: **„Kup w aplikacji”** → `/app?go=pass/:id`.
- **Wejściówka dla znajomej:** osobny wiersz pod kartami: „Pierwszy raz? Wejście dla znajomej za 80 zł”.
- Animacje jak w SOLVA (wejście `y 60 → 0`, hover z obramowaniem `--accent`, ✓ rysowane `pathLength`).
- Mobile: karty jako poziomy swipe (`scroll-snap`).

### 4.12 Wydarzenia i kursy (zamiast bloga)
- H2 „Co *przed nami*”. Karty: zdjęcie 16:10, data, nazwa, liczba miejsc, „Zapisz się”.
- Źródło: wydarzenia studia (`EventsAdmin`) i strony kursów (`/s/:slug/kurs/:id`).
- Hover jak blog w SOLVA (zdjęcie `scale 1.06`, podkreślenie tytułu od lewej).
- Brak wydarzeń: sekcja znika.

### 4.13 Sklep (istnieje)
- Produkty z Instagrama i przycisk „Kup teraz”, który otwiera zakup w aplikacji. Karty w stylu taśmy z 4.4 (hover: wysuwany przycisk „Kup”).

### 4.14 Galeria / Instagram (istnieje: siatka, pasek, mozaika)
- Układ „Pasek” dostaje ruch ticker 30 px/s. Hover zdjęcia: nakładka z ikoną. Uchwyt Instagrama studia z ustawień.

### 4.15 Stopka
- Tło `--ink`, tekst `--bg`. 4 kolumny: **adres i sale**, **recepcja** (telefon, godziny z ustawień wsparcia, bo SS&G ma inne w każdy dzień), **nawigacja**, **aplikacja**: „Pobierz aplikację” + kod QR do `/app` (biblioteka `qrcode-generator` już jest).
- Na dole wielka nazwa studia, litery wjeżdżają po kolei (0.04 s).
- Pasek prawny: © rok · nazwa studia · Regulamin studia (pole `regulations`) · Polityka prywatności · „Strona działa na GLAM”.

---

## 5. Podstrony

| Strona | Stan | Zawartość |
|---|---|---|
| `/s/:slug` | jest | wszystkie sekcje powyżej, kotwice zamiast podstron |
| `/s/:slug/sklep` | jest | sklep studia |
| `/s/:slug/kurs/:id` | jest | strona sprzedażowa kursu |
| `/s/:slug/zajecia/:id` | **nowa (opcjonalnie)** | opis zajęć, dla kogo, co zabrać, trenerki, najbliższe terminy, FAQ. Ważna dla SEO („pilates reformer Kraków”) |
| 404 | do zrobienia | wielkie „404” kursywą i link do strony studia |

O nas, kontakt i blog jako osobne podstrony **nie są potrzebne**. Studio ma to w sekcjach, a każda podstrona to dodatkowe pole w edytorze do wypełnienia.

---

## 6. Responsywność
Jak w SOLVA, plus:
- **Grafik na telefonie** jest pierwszą sekcją po hero, gdy klientka wchodzi z linku „Grafik” (np. z bio na Instagramie: `/s/ssg#grafik`).
- `prefers-reduced-motion`: bez parallaxu, taśm (statyczne listy), blura i staggera. Zostaje fade 0.3 s. Już respektujemy to przy filmach (`prefersReducedMotion`).

## 7. Wydajność i dostępność
Bez zmian względem SOLVA (tylko `transform`/`opacity`/`clip-path`/`filter`, LCP < 2.5 s, kontrast 4.5:1, `:focus-visible` 2 px w kolorze akcentu, `aria-hidden` na kopii taśmy i przycisk pauzy).
Dodatkowo:
- **Kontrast zależy od palety studia.** Edytor wyglądu musi ostrzegać, gdy `--muted` na `--bg` spada poniżej 4.5:1. Najlepiej sam przyciemnia kolor, zamiast pokazywać błąd.
- `motion` ładowany dynamicznie tylko na stronie studia, nie w `/app` i `/panel`.

## 8. Pliki
```
apps/web/src/site/
  StudioSite.tsx        // istnieje: sekcje, nav, hero, stopka
  motion.ts             // NOWY: ease, dur, wariant reduced-motion
  motion/Reveal.tsx, SplitHeading.tsx, Ticker.tsx, ScrollWords.tsx  // NOWE
  sections/Pillars.tsx, ClassTicker.tsx, FirstVisit.tsx, Manifesto.tsx,
           ClassAccordion.tsx, Testimonials.tsx, Passes.tsx, Events.tsx  // NOWE
packages/core/src/site.ts  // nowe typy sekcji: pillars, firstVisit, manifesto, testimonials, passes, events
```
Nowe sekcje dochodzą do `SystemSectionType` i `SECTION_SPECS`, więc od razu pojawiają się w edytorze strony z polami i domyślnymi tekstami.

## 9. Lista kontrolna przed publikacją strony studia
- [ ] Zdjęcia i filmy są studia albo mają licencję
- [ ] Opinie mają zgodę klientek (znacznik w aplikacji)
- [ ] Karnety i ceny pochodzą z panelu (nic nie jest wpisane ręcznie na stronie)
- [ ] Regulamin studia i polityka prywatności podpięte (studio = administrator danych)
- [ ] Test na iOS Safari (sticky, `100svh`, filmy w pętli) i Androidzie, również wejście z przeglądarki Instagrama
- [ ] Lighthouse: Performance ≥ 90, Accessibility ≥ 95, także dla ciemnej palety
- [ ] `prefers-reduced-motion` przetestowane
- [ ] Strona wygląda dobrze z pustym studiem (bez zdjęć, opinii, wydarzeń)
