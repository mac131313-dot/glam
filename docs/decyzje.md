# Dziennik decyzji GLAM

Odpowiedzi na otwarte pytania z sekcji 15 bazy wiedzy (v2.10). Numery = numery pytań z sekcji 15.
Format: decyzja → uzasadnienie → konsekwencje dla produktu.

## Blok A: Fundamenty platformy (2026-10-13)

### 17. Logowanie: tylko kod SMS + biometria
- **Decyzja:** brak haseł. Numer telefonu + jednorazowy kod SMS, potem Face ID / odcisk palca na urządzeniu.
- **Dlaczego:** mniej tarcia dla klientek, brak haseł do zapomnienia i wycieku.
- **Konsekwencje:**
  - Długie sesje (90 dni) i biometria ograniczają liczbę wysyłanych SMS-ów, a więc ich koszt.
  - Bez kodu awaryjnego e-mailem konto zależy od dostępu do numeru. Zmiana numeru wymaga kodu na stary i nowy numer (2.2); przy utracie starego numeru potrzebna ścieżka przez recepcję studia. **Do zaprojektowania.**
  - Spec 2.2 („hasło opcjonalne”) i 15.17: zamknięte.

### 22. Jedna aplikacja GLAM z marką studia
- **Decyzja:** jedna aplikacja w App Store i Google Play. Studia mają w niej własne logo, kolory i czcionki (poziom 1 z 1.2.4). White-label (poziom 2) dopiero później, po wycenie.
- **Dlaczego:** jedna publikacja, jeden przegląd w sklepach, wspólny rozwój.
- **Konsekwencje:**
  - Konto deweloperskie Apple i Google należy do GLAM (wydawca aplikacji).
  - Edytor wyglądu studia (paleta, czcionki, miękkość) zostaje kluczową funkcją sprzedażową.
  - Czcionki studiów muszą mieć licencję na osadzenie w aplikacji GLAM.

### 23. Abonament + własna bramka płatności studia
- **Decyzja:** studio płaci GLAM miesięczny abonament. Płatności klientek (karnety, wejściówki, wydarzenia) idą bezpośrednio na konto studia przez jego własną bramkę (np. Przelewy24 / BLIK). GLAM nie pośredniczy w pieniądzach klientek.
- **Dlaczego:** brak KYC studiów po stronie GLAM, brak rozdzielania płatności i ryzyka licencji płatniczej. Najszybszy start.
- **Konsekwencje:**
  - Onboarding studia (1.2.6) musi zawierać podpięcie jego bramki: klucze API, webhook.
  - Zwroty i chargebacki obsługuje studio w swoim panelu bramki (1.2.8). **Zmiana 2026-10-18:** zwrot (np. przypadkowy zakup) i wyjątkową podmianę karnetu właścicielka może też zlecić z panelu GLAM (`finance.refund`, tylko rola owner) – polecenie idzie kluczem bramki studia, pieniądze wracają z konta studia, GLAM dalej w nich nie pośredniczy. Zwroty zrobione w panelu Stripe wracają do GLAM webhookiem `charge.refunded`; chargebacki nadal tylko w panelu bramki.
  - Anulowanie przez klientkę = wyłączenie odnawiania, bez zwrotu: opłacony miesiąc i pozostałe wejścia zostają do końca ważności.
  - Plany abonamentowe (T9) do zaprojektowania: kryteria = liczba obiektów, aktywnych klientek, funkcje.
  - Prowizja / split (T10) przesunięta na później.
  - **Napięcie z kursami cyfrowymi:** sklepy wymagają In-App Purchase dla treści cyfrowych, a wtedy pieniądze trafiają do wydawcy aplikacji (GLAM), nie do studia. Rozstrzygamy w bloku B.

### 10. Społeczność tylko dla klientek danego studia
- **Decyzja:** feed, grupy i wyzwania są zamknięte w obrębie studia.
- **Dlaczego:** łatwiejsza moderacja, mniej ryzyka hejtu. Studio pozostaje administratorem danych, a GLAM podmiotem przetwarzającym (1.2.10).
- **Konsekwencje:**
  - Moderacja po stronie studia (właścicielka lub koordynatorka, pyt. 12).
  - Brak wspólnej sieci GLAM, więc nie zmienia się rola RODO.

## Blok B: Kursy (2026-10-13)

### 1. Sprzedawca kursu: do wyboru przez studio
- **Decyzja:** w ustawieniach studio wybiera, czy kurs sprzedaje studio (trenerka dostaje udział), czy trenerka jako osobny sprzedawca.
- **Konsekwencje:**
  - Model kursu ma pole `seller: 'studio' | 'trainer'`.
  - Wariant „trenerka” wymaga podpięcia jej własnej bramki płatności i jej danych do rachunków. To ta sama mechanika co bramka studia z decyzji 23, tylko na poziomie trenerki.
  - Na start to nieaktywne, bo kursy są w karnecie (patrz niżej). Pole staje się istotne przy płatnych kursach.

### 2. Podział przychodów: ustala studio, domyślnie 70/30
- **Decyzja:** 70% dla trenerki, 30% dla studia. Studio może zmienić podział per trenerka i osobno dla kursów stacjonarnych.
- **Konsekwencje:** GLAM tylko liczy raport wypłat (K6) i nie dotyka pieniędzy (zgodnie z 23).

### 5. Moderacja: autorka kursu + właścicielka
- **Decyzja:** trenerka-autorka odpowiada na pytania i moderuje. Właścicielka może ukryć każdy komentarz.
- **Konsekwencje:** filtr wulgaryzmów, przycisk „Zgłoś”, log ukrytych treści.

### Kanał sprzedaży kursów: na start kursy w karnecie
- **Decyzja:** w pierwszej wersji kursy online są dodatkiem dla posiadaczek karnetu albo częścią kursów stacjonarnych (K13). Osobna sprzedaż kursów cyfrowych wchodzi po weryfikacji zasad App Store / Google Play.
- **Dlaczego:** sklepy wymagają In-App Purchase za treści cyfrowe, a wtedy pieniądze trafiają do wydawcy aplikacji (GLAM), co łamie decyzję 23.
- **Konsekwencje:**
  - Reguły produktu (1.1.3) dostają nowy klocek: dostęp do kursów, np. „karnet daje dostęp do kursów X, Y”.
  - Funkcje K2 (zakup kursu w apce) i K14 (zniżka dla karnetowiczek) przesuwają się z MVP do wersji po weryfikacji.

### Kanał sprzedaży kursów: www + karnet (2026-10-15, zmienia poprzednią decyzję)
- **Decyzja:** kurs ma dwa kanały naraz. (1) Zakup pakietu na publicznej stronie kursu `/s/:slug/kurs/:id`, płatność w bramce studia. (2) Dostęp w karnecie, jak dotąd (klocek „dostęp do kursów” albo produkt wskazany w kursie).
- **Dlaczego:** zakup na stronie www nie przechodzi przez App Store / Google Play, więc nie wymaga In-App Purchase i pieniądze idą prosto do studia (zgodnie z 23). Zakup w aplikacji (K2) zostaje za flagą `courses_paid`.
- **Konsekwencje:**
  - Model kursu: edycje (`course_editions`: start, koniec sprzedaży, koniec dostępu, temat, „co nowego”), pakiety (`course_tiers`: nazwa, cena, lista różnic, limit miejsc), prowadzące i eksperci (`course_people`, także osoby bez konta; lekcja ma `person_id`), treści strony w `courses.page_json` (obietnica, efekty, dla kogo, sprzęt, FAQ). Kalendarz treningowy liczy się z `unlock_day` / dripu lekcji.
  - Konto zakładane z numeru telefonu (+ e-mail). Strona **nie wydaje sesji** – nie wie, czy numer należy do kupującej. Wejście do `/app` kodem SMS na ten numer; istniejącemu kontu nie nadpisujemy imienia ani e-maila.
  - Dostęp po zakupie: do końca edycji albo N dni od zakupu – wcześniejsza z dat. Przy edycji z przyszłym startem kalendarz liczy się od startu edycji.
  - Zgoda na utratę prawa odstąpienia (5.6) i akceptacja regulaminu są obowiązkowe, jak w aplikacji. Kody rabatowe i zapis płatności – te same co przy karnetach (`priceWithCoupon`, `recordPayment`).
  - Karnet daje dostęp do kursu bez pakietu (bez `tier_id`). Różnice pakietów (społeczność, konsultacja) są na razie tylko opisem – egzekwowanie ich w aplikacji do zrobienia.

## Blok C: Relacje (2026-10-13)

### 3. Powitanie od trenerki: opcjonalne, z przypomnieniem i zapasem
- **Decyzja:** trenerka dostaje zadanie „Napisz powitanie” z przypomnieniem 48 h i 24 h przed pierwszymi zajęciami klientki. Jeśli go nie napisze, klientka dostaje krótkie powitanie **od studia**, podpisane „Od studia”, a nie imieniem trenerki.
- **Dlaczego:** każda klientka ma ciepły start, a zasada 6.6 (nie udajemy osobistego kontaktu) zostaje zachowana.
- **Konsekwencje:**
  - Nowe ustawienie studia: treść powitania zapasowego (szablon z imieniem klientki), edytowana przez właścicielkę.
  - Powitanie zapasowe wysyłane np. 12 h przed pierwszymi zajęciami, jeśli trenerka nie napisała. Jeśli trenerka napisze później, klientka dostaje też jej powitanie (każde popup pokazuje się raz).
  - Pulpit właścicielki: liczba powitań napisanych przez trenerki oraz zapasowych (do statystyk P8).
  - **Stan demo:** jest lista „bez powitania” i edytor; brakuje przypomnień i powitania zapasowego.

### 4. Wideo powitalne: z galerii telefonu
- **Decyzja:** trenerka dodaje wideo przez systemowy wybór pliku, który na telefonie oferuje też „Nagraj”. Aplikacja przycina do 30 s, kompresuje i wymusza kadr pionowy 9:16.
- **Konsekwencje:**
  - Priorytet bez zmian: wideo (P3) w wersji 1.1, tekst w MVP.
  - Miejsce na wideo liczy się do limitów planu abonamentowego (1.2.11).
  - Napisy automatyczne (6.3) wymagają usługi transkrypcji. **Do wyboru dostawcy** (koszt, polski język, RODO).

### 8. Polecenia: darmowe wejście dla obu
- **Decyzja (domyślne zasady, studio może zmienić):**
  - Znajoma dostaje pierwsze zajęcia gratis, raz na numer telefonu w danym studiu.
  - Zapraszająca dostaje 1 wejście, gdy znajoma kupi swój pierwszy karnet.
  - Limit: max 5 bonusów miesięcznie na osobę.
- **Konsekwencje:**
  - To dwa różne produkty: **polecenie** (darmowe, #17–18) i **wejściówka-prezent** (płatna, V1–V3, jest w demo). Oba kończą się tym samym: jednorazowym karnetem z regułami z 1.1.3.
  - Bonus zapraszającej = karnet „Bonus za polecenie”, 1 wejście, ważny np. 60 dni.
  - Pakiet startowy („tylko przy pierwszym zakupie”) pozostaje dostępny po darmowym wejściu z polecenia, bo to nie był zakup.
  - Ochrona przed nadużyciami: unikalność numeru telefonu na studio; nowe karty SIM to akceptowane ryzyko.
  - Statusy zaproszeń (4.3: „Ania zaakceptowała”, „Ania ma już pierwszy trening”) i push do zapraszającej.

### 12. Koordynatorka społeczności: tak, bez finansów
- **Decyzja:** opcjonalna rola w studiu. Moderuje feed i komentarze, prowadzi wyzwania i grupy, zarządza edycjami sezonowymi i playlistą. Widzi tylko imiona klientek: bez finansów, telefonów, e-maili i kampanii push.
- **Konsekwencje:**
  - Nowa kolumna w siatce ról (2.1).
  - Rola `coordinator` w modelu uprawnień (#43, wersja 1.1).
  - Realizuje moderację z decyzji 10.

## Blok D: Treści (2026-10-13, w toku)

### 9. Medytacje i oddech prowadzi aplikacja, nie osoba
- **Decyzja:** brak lektorki i nagrań głosu. Sesje prowadzi aplikacja:
  - tempo oddechu wyznacza obraz zależny od rytmu: przy wyciszeniu piwonia, która rozkwita na wdechu i mięknie na wydechu; przy skupieniu (rytm pudełkowy 4-4-4-4) kwadrat oddechu, po którym wędruje kropka, a każdy bok to jedna faza,
  - bez cyfr i licznika sekund – upływ fazy pokazuje sam obraz,
  - krótkie podpowiedzi pojawiają się na ekranie, jedna naraz, zawsze w tym samym miejscu,
  - haptyka daje sygnał na początku każdej fazy,
  - w tle gra spokojny szum.
  Haptykę i szum można włączyć i wyłączyć osobno, także w trakcie sesji. Wybór jest zapamiętany na urządzeniu.
- **Gdzie:** zakładka „Dla mnie” uruchamia sesje (karty „Wycisz się” i „Skup się”); skrót „Trzy minuty oddechu” na ekranie Start.
- **Konsekwencje:**
  - Zmiana w 4.4: „lektorka po polsku + tła dźwiękowe” zastępuje sesja prowadzona przez aplikację.
  - Biblioteka (#20, „min. 20 nagrań”) to teraz min. 20 **scenariuszy**: dane w `packages/core/src/mindful.ts`, czyli rytm + podpowiedzi z czasem. Nowa medytacja = nowy wpis, bez nagrań i bez kodu.
  - Pytanie 13 (budżet): odpada koszt nagrań medytacji; zostaje koszt napisania scenariuszy.
  - Haptyka: w natywnej aplikacji przez systemowe API (iOS i Android). W przeglądarce działa tylko na Androidzie (Safari na iOS nie ma Vibration API).
  - Szum generowany na żywo (Web Audio, bez plików). W aplikacji natywnej musi grać także przy wygaszonym ekranie – do sprawdzenia przy wyborze technologii mobilnej.
  - Dostępność: przy „ogranicz ruch” znikają ozdobne animacje (drganie płatków, płynne pojawianie się napisów), ale piwonia dalej rozkwita i mięknie, a kropka dalej obiega kwadrat, bo to one niosą rytm. Rytm podaje też słowo fazy. Licznika sekund nie ma – **do sprawdzenia**, czy przy „ogranicz ruch” go przywrócić.
  - Ukończona sesja zapisuje się na serwerze i liczy do celu tygodnia („3 treningi + 2 medytacje”, 4.4) oraz do KPI „medytacje tygodniowo” (12).
  - Obraz wynika z rytmu, nie z miejsca uruchomienia (`visualFor()` w `mindful.ts`): każda sesja pudełkowa dostaje kwadrat, pozostałe piwonię. Wyciszenie to rytmy z dłuższym wydechem (4–6, 4–7–8), skupienie to box.
  - Aktualizacja 2026-10-18: zamiast animowanego koła piwonia (wyciszenie) i kwadrat oddechu (skupienie); usunięty licznik sekund; podpowiedzi o „kole” przepisane.

## Do prawnika / księgowej

| Pyt. | Temat | Co trzeba ustalić |
|---|---|---|
| 6 | Zwroty za treści cyfrowe | Zgoda klientki i potwierdzenie utraty prawa odstąpienia przed rozpoczęciem dostępu (ustawa o prawach konsumenta); treść checkboxa i regulaminu |
| 1 | Trenerka jako sprzedawca | VAT, rachunki/faktury, PIT trenerki; czy studio może być pośrednikiem |
| — | Kursy w sklepach | Czy płatne kursy wymagają In-App Purchase; czy dopuszczalny zakup na www + dostęp w aplikacji (zasady Apple / Google, DMA w UE); kto jest sprzedawcą przy IAP |
| 24 | Rola RODO platformy | Potwierdzenie: studio = administrator, GLAM = podmiot przetwarzający; wzór umowy powierzenia (DPA) |

## Nowe pytania otwarte (z rozmowy)

- **N1. Wynagrodzenie trenerki za kursy w karnecie.** Skoro nikt nie płaci za konkretny kurs, od czego liczyć jej udział? Opcje: stała kwota od studia za kurs; podział puli wg liczby ukończeń / obejrzeń; brak udziału (kurs jako część etatu/umowy).
- **N3. Dostawca transkrypcji** do napisów pod wideo powitalnym (polski, koszt, RODO, przetwarzanie wizerunku).
- **N2. Utrata numeru telefonu** przy logowaniu tylko SMS: jak klientka odzyskuje konto (weryfikacja w recepcji studia?).
