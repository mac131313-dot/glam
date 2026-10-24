// Wspólne kawałki grafiku klientki i recepcji: pasek dni, kalendarz miesiąca, plansza pustego dnia, twarz
// prowadzącej na kafelku i przelot zdjęcia kafelek → arkusz. Jeden wygląd i te same animacje w obu aplikacjach.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from '../icons.tsx';
import { addDaysStr, fmtTime, localDate } from '../api.ts';
import { reducedMotion } from '../ui.tsx';

export const DOW = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob'];
export type View = 'day' | 'week' | 'month';

/** „jedne zajęcia”, „3 zajęcia”, „12 zajęć” – zajęcia mają tylko liczbę mnogą. */
export const classCount = (n: number) => (n === 1 ? 'jedne zajęcia' : `${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'zajęcia' : 'zajęć'}`);

/** Przelot zdjęcia kafelek → arkusz tylko tam, gdzie przeglądarka je ma i nikt nie wyłączył animacji (system albo ustawienia aplikacji). */
const canMorph = () => typeof document.startViewTransition === 'function' && !reducedMotion();

/** Arkusz zajęć otwierany z kafelka: zdjęcie przelatuje z kafelka na górę arkusza i wraca przy zamknięciu. */
export function useMorphSheet<T>(onOpen: (item: T) => void, onClose: () => void) {
  const photoRef = useRef<HTMLElement | null>(null);
  const [morph, setMorph] = useState(false);
  const openFromTile = (item: T, tile: HTMLElement) => {
    const photo = tile.querySelector<HTMLElement>('.cover-img');
    photoRef.current = photo;
    if (!photo || !canMorph()) return (setMorph(false), onOpen(item));
    // Przed zmianą nazwa przejścia jest na zdjęciu kafelka, po zmianie – na zdjęciu arkusza (.class-sheet.morph .sheet-hero > img).
    photo.style.viewTransitionName = 'class-photo';
    document.startViewTransition(() => {
      photo.style.viewTransitionName = '';
      flushSync(() => (setMorph(true), onOpen(item)));
    });
  };
  const close = () => {
    const photo = photoRef.current;
    if (!morph || !photo?.isConnected || !canMorph()) return (onClose(), setMorph(false));
    const t = document.startViewTransition(() => {
      flushSync(() => (onClose(), setMorph(false)));
      photo.style.viewTransitionName = 'class-photo';
    });
    t.finished.finally(() => (photo.style.viewTransitionName = ''));
  };
  return { morph, setMorph, openFromTile, close };
}

/** Pasek 14 dni od dziś; wybrany dzień płynnie jedzie na środek – także gdy zmienił się z planszy „Najbliższe” albo z miesiąca. */
export function DayStrip({ today, day, view, onPick }: { today: string; day: string; view: View; onPick: (d: string) => void }) {
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !chip) return;
    strip.scrollTo({ left: chip.offsetLeft - strip.offsetLeft - (strip.clientWidth - chip.clientWidth) / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [day, view]);
  const days = Array.from({ length: 14 }, (_, i) => addDaysStr(today, i));
  return (
    <div className="chips" role="group" aria-label="Wybierz dzień" ref={stripRef}>
      {days.map((d) => {
        const date = new Date(`${d}T12:00:00Z`);
        return (
          <button key={d} className="day ring" aria-pressed={d === day} onClick={() => onPick(d)}>
            <svg viewBox="0 0 56 56" aria-hidden="true">
              <circle cx="28" cy="28" r="26" pathLength={24} />
            </svg>
            {d === today ? 'dziś' : DOW[date.getUTCDay()]}
            <b>{date.getUTCDate()}</b>
          </button>
        );
      })}
    </div>
  );
}

/** Przełącznik Dzień / Tydzień / Miesiąc obok nagłówka. */
export function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Widok grafiku">
      {(
        [
          ['day', 'Dzień'],
          ['week', 'Tydzień'],
          ['month', 'Miesiąc'],
        ] as const
      ).map(([v, l]) => (
        <button key={v} aria-pressed={view === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Samo zdjęcie prowadzącej na karcie zajęć (imię dla czytników ekranu i w podpowiedzi). */
export function TrainerFace({ name, url }: { name: string; url: string | null }) {
  return (
    <span className="cover-face" title={`prowadzi ${name}`} aria-label={`prowadzi ${name}`} role="img">
      {url ? <img src={url} alt="" loading="lazy" /> : name.charAt(0)}
    </span>
  );
}

export type DayRestKind = 'today-empty' | 'empty' | 'done';

const DAY_REST: Record<DayRestKind, { title: [string, string]; text: string }> = {
  done: { title: ['Na dziś', 'to wszystko'], text: 'Do zobaczenia na macie.' },
  'today-empty': { title: ['Dziś studio', 'odpoczywa'], text: 'Czas na regenerację.' },
  empty: { title: ['Tego dnia', 'odpoczywamy'], text: 'Zajrzyj na inny dzień.' },
};

/** Plansza pustego dnia: ikonka, krótki nagłówek, jedno zdanie i ciche wyjście do najbliższych zajęć. */
export function DayRest({ kind, next, onNext }: { kind: DayRestKind; next: { starts_at: string } | null; onNext: (day: string) => void }) {
  const t = DAY_REST[kind];
  const nextDay = next ? localDate(new Date(next.starts_at)) : null;
  const when = nextDay === addDaysStr(localDate(), 1) ? 'jutro' : next ? DOW[new Date(`${nextDay}T12:00:00Z`).getUTCDay()] + '.' : '';
  return (
    <section className="day-rest" aria-live="polite">
      <span className="day-rest-icon">
        <Icon name={kind === 'done' ? 'moon' : 'leaf'} size={20} />
      </span>
      <h2>
        {t.title[0]} <span className="serif">{t.title[1]}</span>
      </h2>
      <p>{t.text}</p>
      {next && nextDay && (
        <button className="day-rest-next" onClick={() => onNext(nextDay)}>
          Najbliższe: {when} {fmtTime(next.starts_at)} <Icon name="chevron" size={16} />
        </button>
      )}
    </section>
  );
}

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_OF = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

/** Pierwszy i ostatni dzień miesiąca (YYYY-MM-DD) – bieżącego albo o `offset` dalej. */
export function monthBounds(today: string, offset: number) {
  const [y, m] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(y, m + offset, 0));
  return { first: first.toISOString().slice(0, 10), last: last.toISOString().slice(0, 10), month: first.getUTCMonth(), year: first.getUTCFullYear() };
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Nazwa miesiąca ze strzałkami między bieżącym (0) a następnym (1). */
export function MonthHead({ month, offset, onMonth }: { month: ReturnType<typeof monthBounds>; offset: number; onMonth: (o: number) => void }) {
  return (
    <div className="month-head">
      <button type="button" className="month-nav prev" disabled={offset === 0} onClick={() => onMonth(0)} aria-label="Poprzedni miesiąc">
        <Icon name="chevron" size={18} />
      </button>
      <span className="month-name">
        {MONTHS[month.month]} <span className="muted">{month.year}</span>
      </span>
      <button type="button" className="month-nav" disabled={offset === 1} onClick={() => onMonth(1)} aria-label="Następny miesiąc">
        <Icon name="chevron" size={18} />
      </button>
    </div>
  );
}

/** Kalendarz jednego miesiąca: tylko jego dni, kropka – są zajęcia, ciemna kropka – Twój zapis. Minione dni wyciszone. */
export function MonthGrid({
  month,
  today,
  sessions,
  selected,
  onPick,
  offset,
  onMonth,
}: {
  month: ReturnType<typeof monthBounds>;
  today: string;
  sessions: { starts_at: string; status: string; my_status?: string | null }[];
  selected: string;
  onPick: (d: string) => void;
  offset: number;
  onMonth: (o: number) => void;
}) {
  const lead = (new Date(`${month.first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells = Array.from({ length: daysBetween(month.first, month.last) + 1 }, (_, i) => addDaysStr(month.first, i));
  const count = new Map<string, { all: number; mine: number }>();
  for (const s of sessions) {
    if (s.status === 'cancelled') continue;
    const d = localDate(new Date(s.starts_at));
    const c = count.get(d) ?? { all: 0, mine: 0 };
    c.all++;
    if (s.my_status === 'booked' || s.my_status === 'waitlist') c.mine++;
    count.set(d, c);
  }
  return (
    <div className="month">
      <MonthHead month={month} offset={offset} onMonth={onMonth} />
      <div className="month-grid" role="group" aria-label={`${MONTHS[month.month]} ${month.year}`}>
        {['pn', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'].map((d) => (
          <span key={d} className="month-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden="true" />
        ))}
        {cells.map((d) => {
          const c = count.get(d);
          const n = Number(d.slice(8));
          return (
            <button
              key={d}
              type="button"
              className={d === today ? 'month-cell is-today' : 'month-cell'}
              disabled={d < today}
              aria-pressed={d === selected}
              aria-label={`${n} ${MONTHS_OF[month.month]}, ${c ? classCount(c.all) : 'bez zajęć'}${c?.mine ? ', Twój zapis' : ''}`}
              onClick={() => onPick(d)}
            >
              {n}
              <i className={c?.mine ? 'mine' : c ? 'has' : ''} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Stan widoku grafiku: dzień, tydzień albo miesiąc i zakres dni do pobrania – taki sam u klientki i w recepcji. */
export function useScheduleView(monthDayRef: RefObject<HTMLElement | null>) {
  const today = localDate();
  const [view, setView] = useState<View>('day');
  const [day, setDay] = useState(today);
  /** Miesiąc: bieżący (0) albo następny (1) – zapisy i tak otwierają się z wyprzedzeniem najwyżej kilku tygodni. */
  const [monthOffset, setMonthOffset] = useState(0);
  const month = monthBounds(today, monthOffset);
  // Dzień i tydzień: od dziś co najmniej 21 dni i zawsze 7 dni za wybranym dniem (pasek dni sięga dziś + 13).
  // Miesiąc: od dziś (albo od 1. dnia następnego miesiąca) do ostatniego dnia miesiąca.
  const from = view === 'month' && month.first > today ? month.first : today;
  const span = view === 'month' ? daysBetween(from, month.last) + 1 : Math.min(42, Math.max(21, daysBetween(today, day) + 7));
  /** Panel zajęć wybranego dnia pod kalendarzem miesiąca – po wybraniu dnia strona płynnie do niego podjeżdża. */
  const pickMonthDay = (d: string) => {
    setDay(d);
    requestAnimationFrame(() => {
      const el = monthDayRef.current;
      if (el && el.getBoundingClientRect().top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
  };
  const changeView = (v: View) => {
    // Miesiąc otwiera się na miesiącu wybranego dnia (pasek dni może sięgać już następnego).
    if (v === 'month') setMonthOffset(day > monthBounds(today, 0).last ? 1 : 0);
    setView(v);
  };
  const changeMonth = (o: number) => {
    setMonthOffset(o);
    const b = monthBounds(today, o);
    setDay(b.first > today ? b.first : today);
  };
  return { today, view, day, setDay, month, monthOffset, from, span, pickMonthDay, changeView, changeMonth };
}
