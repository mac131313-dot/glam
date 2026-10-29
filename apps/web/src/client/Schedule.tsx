// Grafik (4.1): widok dnia / tygodnia / miesiąca, filtry (typ, trenerka, poziom, sala, wolne miejsca), zapis,
// trening we dwie (#6), rezerwacja „na stałe”, lista oczekujących, odwołanie, „umów się z dziewczynami”,
// playlista zajęć, synchronizacja z kalendarzem telefonu. Widok dnia: karuzela „Dopasowane do Ciebie” (ankieta
// + ulubione, core/classfit) i pod nią karuzela pozostałych zajęć tego dnia – duże karty ze zdjęciem, przewijane w bok.
import { useEffect, useRef, useState } from 'react';
import { FIT_THRESHOLD, fitReason, fitScore, type ClassAudience, type ClassFit } from '@glam/core';
import { Icon } from '../icons.tsx';
import { ClassFitSheet, fitShort } from './ClassFitQuestions.tsx';
import { addDaysStr, api, ApiError, fmtDay, fmtLongDay, fmtMinutes, fmtTime, localDate, useApi } from '../api.ts';
import { Empty, Field, Fold, Sheet, Spinner, Toggle, useToast } from '../ui.tsx';
import { ClassCover } from './ClassCover.tsx';
import { ClassHistory } from './ClassHistory.tsx';
import { useClient } from './ClientApp.tsx';
import { classCount, DayRest, DayStrip, DOW, MonthGrid, TrainerFace, useMorphSheet, useScheduleView, ViewSwitch, type DayRestKind } from './ScheduleParts.tsx';

export type Session = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: string;
  kind: string;
  template_id: string | null;
  class_name: string;
  class_type_id: string;
  color: string;
  level: string;
  description: string;
  photo_url: string | null;
  photo_ratio: number | null;
  zone_name: string;
  trainer_name: string;
  trainer_id: string;
  trainer_avatar_url: string | null;
  trainer_bio: string | null;
  playlist_name: string | null;
  playlist_url: string | null;
  taken: number;
  waiting: number;
  my_booking_id: string | null;
  my_status: 'booked' | 'waitlist' | 'attended' | null;
  my_confirmed_at: string | null;
  my_guest: string | null;
  my_recurring_id: string | null;
  audience: ClassAudience;
  /** godzina, minuta od północy i dzień tygodnia w strefie studia – do dopasowania dni i godzin z preferencji */
  local_hour: number;
  local_min: number;
  local_weekday: number;
};

export type ForYou = { s: Session; fav: boolean; reason: string | null };

/**
 * „Dopasowane do Ciebie” (Grafik i Start): przyszłe zajęcia z ulubionych albo z wynikiem ankiety od progu wzwyż.
 * Najpierw ulubione, potem lepszy wynik, potem wcześniejsza godzina.
 */
export function pickForYou(list: Session[], favorites: string[], fit: ClassFit | null): ForYou[] {
  return list
    .filter((s) => s.status !== 'cancelled' && Date.parse(s.starts_at) > Date.now())
    .map((s) => ({ s, fav: favorites.includes(s.class_type_id), score: fit ? fitScore(s.audience, fit, whenOf(s)) : 0 }))
    .filter((x) => x.fav || x.score >= FIT_THRESHOLD)
    .sort((a, b) => Number(b.fav) - Number(a.fav) || b.score - a.score || a.s.starts_at.localeCompare(b.s.starts_at))
    .map((x) => ({ s: x.s, fav: x.fav, reason: x.fav ? 'ulubione' : fit && fitReason(x.s.audience, fit) }));
}

/** Kiedy są zajęcia w języku preferencji: dzień tygodnia i minuty od północy (start i koniec) w strefie studia. */
const whenOf = (s: Session) => {
  const start = s.local_min ?? s.local_hour * 60;
  return { weekday: s.local_weekday, start, end: start + Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60_000) };
};

/** Zajęcia do otwarcia przy następnym wejściu do Grafiku (np. z podpowiedzi na Starcie): dzień i arkusz z zapisem. */
let pendingFocus: { id: string; day: string } | null = null;
export const focusSession = (s: Pick<Session, 'id' | 'starts_at'>) => {
  pendingFocus = { id: s.id, day: localDate(new Date(s.starts_at)) };
};

export function Schedule() {
  const { studio, openShop, open, reloadMe } = useClient();
  // Czytamy bez czyszczenia – inicjalizator może się wykonać dwa razy (StrictMode); czyści efekt po otwarciu arkusza.
  const [focus] = useState(() => pendingFocus);
  /** Panel zajęć wybranego dnia pod kalendarzem miesiąca. */
  const monthDayRef = useRef<HTMLElement>(null);
  const { today, view, day, setDay, month, monthOffset, from, span, pickMonthDay, changeView, changeMonth } = useScheduleView(monthDayRef, focus?.day);
  const { data, error, reload } = useApi<{ sessions: Session[]; fit: ClassFit | null; favorites: string[] }>(`/schedule?from=${from}&days=${span}`);
  /** Serduszka zmieniamy od razu na ekranie, serwer dostaje zmianę w tle. */
  const [favs, setFavs] = useState<string[] | null>(null);
  const [askFit, setAskFit] = useState(false);
  const [detail, setDetail] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  /** Odwołanie po terminie (wejście przepada) wymaga drugiego dotknięcia. */
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [withFriend, setWithFriend] = useState(false);
  const [guest, setGuest] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const toast = useToast();
  /** Każde zajęcia otwierają się „na czysto” – „we dwie”, imię gościa i numer koleżanki nie przechodzą z poprzednich. */
  const openDetail = (s: Session) => {
    setDetail(s);
    setConfirmCancel(false);
    setWithFriend(false);
    setGuest('');
    setInvitePhone('');
  };
  /** Wejście z podpowiedzi na Starcie: po wczytaniu grafiku od razu arkusz tych zajęć (jednorazowo). */
  const focusDone = useRef(false);
  useEffect(() => {
    if (!focus || focusDone.current || !data) return;
    focusDone.current = true;
    pendingFocus = null;
    const s = data.sessions.find((x) => x.id === focus.id);
    if (s) openDetail(s);
  }, [data, focus]);
  /** Zdjęcie przelatuje z kafelka na górę arkusza, a przy zamknięciu wraca na swoje miejsce. */
  const { morph, setMorph, openFromTile, close: closeDetail } = useMorphSheet(openDetail, () => setDetail(null));

  const sessions = data?.sessions ?? [];
  const list = view === 'week' ? sessions.filter((s) => localDate(new Date(s.starts_at)) >= day && localDate(new Date(s.starts_at)) < addDaysStr(day, 7)) : sessions.filter((s) => localDate(new Date(s.starts_at)) === day);

  const act = async (fn: () => Promise<{ message?: string }>) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res?.message) toast(res.message);
      setDetail(null);
      setMorph(false);
      setConfirmCancel(false);
      setWithFriend(false);
      setGuest('');
      reload();
      window.dispatchEvent(new Event('glam:passes-changed'));
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'no_pass') {
        setDetail(null);
        openShop(err.message, err.details?.suggestions?.map((x: { productId: string }) => x.productId));
      } else toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const favorites = favs ?? data?.favorites ?? [];
  const isFav = (s: Session) => favorites.includes(s.class_type_id);
  const toggleFav = async (s: Session) => {
    const on = !isFav(s);
    setFavs(on ? [...favorites, s.class_type_id] : favorites.filter((x) => x !== s.class_type_id));
    try {
      await api(`/favorites/${s.class_type_id}`, { method: on ? 'PUT' : 'DELETE' });
      if (on) toast(`${s.class_name} w ulubionych – pokażemy je w „Dopasowanych do Ciebie”`);
    } catch (e) {
      setFavs(favorites);
      toast((e as ApiError).message, 'error');
    }
  };

  // Dzień: najpierw „Dopasowane do Ciebie” (ulubione + wynik z ankiety), potem reszta zajęć tego dnia.
  const fit = data?.fit ?? null;
  const forYou = view === 'day' ? pickForYou(list, favorites, fit) : [];
  const rest = list.filter((s) => !forYou.some((f) => f.s.id === s.id));

  const started = (s: Session) => Date.parse(s.starts_at) <= Date.now();
  /** Pusty dzień: „odpoczywa” – nic w grafiku, „done” – dziś wszystko już się odbyło. Wtedy zamiast list pokazujemy spokojną planszę. */
  const dayRest: DayRestKind | null =
    view !== 'day' ? null : list.length === 0 ? (day === today ? 'today-empty' : 'empty') : day === today && list.every((s) => started(s) || s.status === 'cancelled') ? 'done' : null;
  /** Najbliższe zajęcia po wybranym dniu (i po teraz) – plansza od razu do nich prowadzi. */
  const nextAfterDay = dayRest ? (data?.sessions ?? []).find((s) => s.status !== 'cancelled' && !started(s) && localDate(new Date(s.starts_at)) > day) ?? null : null;
  const canQuickBook = (s: Session) => !s.my_status && s.status !== 'cancelled' && !started(s) && s.taken < s.capacity;
  const lateCancel = (s: Session) => Date.parse(s.starts_at) - Date.now() < studio.policy.cancelMinutesBefore * 60_000;
  /** Tydzień pogrupowany po dniach – każdy dzień to osobna zwijana sekcja. */
  const weekDays: { date: string; items: Session[] }[] = [];
  if (view === 'week') {
    for (const s of list) {
      const d = localDate(new Date(s.starts_at));
      const last = weekDays[weekDays.length - 1];
      if (last?.date === d) last.items.push(s);
      else weekDays.push({ date: d, items: [s] });
    }
  }

  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Grafik</h1>
        <ViewSwitch view={view} onChange={changeView} />
      </div>

      {view === 'month' ? (
        <MonthGrid month={month} today={today} sessions={sessions} selected={day} onPick={pickMonthDay} offset={monthOffset} onMonth={changeMonth} />
      ) : (
        <DayStrip today={today} day={day} view={view} onPick={setDay} />
      )}

      {/* Błąd przy pierwszym wczytaniu – zamiast spinnera bez końca. */}
      {!data && error && (
        <Empty>
          Nie udało się wczytać grafiku.{' '}
          <button className="link" onClick={reload}>
            Spróbuj ponownie
          </button>
        </Empty>
      )}
      {view === 'day' && !data && !error && <Spinner />}
      {view === 'day' && data && dayRest && <DayRest kind={dayRest} next={nextAfterDay} onNext={(d) => setDay(d)} />}
      {/* Dzień: dwie zwijane sekcje zamiast długiej ściany kafelków. Stan rozwinięcia wraca do domyślnego przy zmianie dnia. */}
      {view === 'day' && data && !dayRest && list.length > 0 && (
        <div className="folds">
          <Fold key={`fit-${day}`} title={<>Dopasowane <span className="serif">do Ciebie</span></>} meta={forYou.length ? classCount(forYou.length) : fit ? '' : 'szybkie wybory'} defaultOpen={forYou.length > 0}>
            <div className="stack" style={{ gap: 12 }}>
              {forYou.length > 0 ? (
                <div className="cover-carousel">
                  {forYou.map(({ s, fav, reason }) => (
                    <SessionCard key={s.id} s={s} fav={fav} onFav={() => toggleFav(s)} onOpen={(el) => openFromTile(s, el)} reason={reason} />
                  ))}
                </div>
              ) : !fit ? (
                <button className="fit-prompt" onClick={() => setAskFit(true)}>
                  <span>
                    <b>Kilka dotknięć i wiemy, co Ci polecić</b>
                    <span className="small muted">Poziom, cel, dni i godziny – mniej niż minuta.</span>
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  Tego dnia nic szczególnie pod Ciebie – zerknij niżej albo na kolejny dzień.
                </p>
              )}
              {fit && (
                <button className="text-btn small" style={{ justifySelf: 'start' }} onClick={() => setAskFit(true)}>
                  Twoje preferencje: {fitShort(fit)}
                </button>
              )}
            </div>
          </Fold>
          {rest.length > 0 && (
            <Fold key={`rest-${day}`} title={forYou.length ? 'Pozostałe zajęcia' : 'Zajęcia tego dnia'} meta={classCount(rest.length)} defaultOpen>
              <div className="cover-carousel">
                {rest.map((s) => (
                  <SessionCard key={s.id} s={s} fav={isFav(s)} onFav={() => toggleFav(s)} onOpen={(el) => openFromTile(s, el)} />
                ))}
              </div>
            </Fold>
          )}
        </div>
      )}

      {/* Miesiąc: zajęcia wybranego dnia od razu pod kalendarzem, bez przechodzenia do widoku dnia. */}
      {view === 'month' && data && (
        <section ref={monthDayRef} key={day} className="month-day" aria-live="polite">
          <div className="month-day-head">
            <h2>{fmtLongDay(`${day}T12:00:00Z`)}</h2>
            {list.length > 0 && <span className="fold-meta">{classCount(list.length)}</span>}
          </div>
          {list.length > 0 ? (
            <div className="cover-carousel">
              {list.map((s) => (
                <SessionCard key={s.id} s={s} fav={isFav(s)} onFav={() => toggleFav(s)} onOpen={(el) => openFromTile(s, el)} />
              ))}
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              Tego dnia studio odpoczywa.
            </p>
          )}
        </section>
      )}
      {view === 'month' && !data && !error && <Spinner />}

      {view === 'week' && (
        <>
          {!data && !error && <Spinner />}
          {data && list.length === 0 && <Empty>W tym tygodniu nie ma zajęć.</Empty>}
          {/* Tydzień: każdy dzień to zwijana sekcja – rozwinięty tylko pierwszy, reszta to spokojna lista dni z liczbą zajęć. */}
          <div className="folds">
            {weekDays.map((g, i) => (
              <Fold key={`${day}-${g.date}`} title={fmtLongDay(g.items[0].starts_at)} meta={classCount(g.items.length) + (g.items.some((s) => s.my_status === 'booked' || s.my_status === 'waitlist') ? ' · Twój zapis' : '')} defaultOpen={i === 0}>
                <div className="cover-carousel">
                  {g.items.map((s) => (
                    <SessionCard key={s.id} s={s} fav={isFav(s)} onFav={() => toggleFav(s)} onOpen={(el) => openFromTile(s, el)} />
                  ))}
                </div>
              </Fold>
            ))}
          </div>
        </>
      )}

      {askFit && <ClassFitSheet initial={fit} onClose={() => setAskFit(false)} onSaved={() => (reload(), void reloadMe())} />}

      {detail && (
        <Sheet onClose={closeDetail} label={detail.class_name} className={morph ? 'class-sheet morph' : 'class-sheet'}>
          <div className="stack">
            {/* Ze zdjęciem: zdjęcie na całą szerokość arkusza, data i nazwa leżą na nim. Bez zdjęcia – zwykły nagłówek. */}
            {detail.photo_url ? (
              <div className="sheet-hero">
                <img src={detail.photo_url} alt="" />
                <button type="button" className={`fav-btn${detail.photo_url ? ' on-photo' : ' inline'}`} aria-pressed={isFav(detail)} aria-label={isFav(detail) ? `Usuń ${detail.class_name} z ulubionych` : `Dodaj ${detail.class_name} do ulubionych`} onClick={() => toggleFav(detail)}>
                <Icon name="heart" />
              </button>
                <div className="sheet-hero-text">
                  <div className="eyebrow">{fmtLongDay(detail.starts_at)}</div>
                  <h2>
                    {detail.class_name} <span className="serif">{fmtTime(detail.starts_at)}</span>
                  </h2>
                </div>
              </div>
            ) : (
              <>
                <div className="eyebrow">{fmtLongDay(detail.starts_at)}</div>
                <div className="sheet-title">
                  <h2 style={{ fontSize: '1.8rem' }}>
                    {detail.class_name} <span className="serif">{fmtTime(detail.starts_at)}</span>
                  </h2>
                  <button type="button" className={`fav-btn${detail.photo_url ? ' on-photo' : ' inline'}`} aria-pressed={isFav(detail)} aria-label={isFav(detail) ? `Usuń ${detail.class_name} z ulubionych` : `Dodaj ${detail.class_name} do ulubionych`} onClick={() => toggleFav(detail)}>
                    <Icon name="heart" />
                  </button>
                </div>
              </>
            )}
            {/* Poziom i sala to informacje, nie przyciski – jedna spokojna linijka zamiast plakietek. */}
            <div className="meta-line">
              {[detail.level, detail.zone_name, fmtMinutes(Math.round((Date.parse(detail.ends_at) - Date.parse(detail.starts_at)) / 60_000))].filter(Boolean).map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            {detail.description && <p className="muted" style={{ margin: 0 }}>{detail.description}</p>}
            <TrainerCard s={detail} onProfile={() => (setDetail(null), open(`trainer/${detail.trainer_id}`))} onWrite={() => (setDetail(null), open(`dm/${detail.trainer_id}`))} />
            {/* Szybki zapis od razu pod prowadzącą – bez przewijania. „We dwie” i lista oczekujących zostają niżej. */}
            {canQuickBook(detail) && !withFriend && (
              <button className="btn block" disabled={busy} onClick={() => act(() => api('/bookings', { method: 'POST', body: { sessionId: detail.id, guest: null } }))}>
                Zarezerwuj miejsce
              </button>
            )}
            {detail.playlist_url && (
              <a className="small" href={detail.playlist_url} target="_blank" rel="noreferrer">
                Na zajęciach: {detail.playlist_name}
              </a>
            )}
            {detail.my_status === 'attended' ? (
              <p className="small">Byłaś na tych zajęciach. Ocenisz je w Profilu, w historii zajęć.</p>
            ) : detail.my_status === 'booked' ? (
              <>
                {detail.my_guest && <p className="small">Zapisane we dwie – z Tobą idzie {detail.my_guest}.</p>}
                {!detail.my_confirmed_at && !started(detail) && Date.parse(detail.starts_at) - Date.now() < 24 * 3_600_000 && (
                  <button className="btn block" disabled={busy} onClick={() => act(() => api(`/bookings/${detail.my_booking_id}/confirm`, { method: 'POST' }))}>
                    Potwierdzam obecność
                  </button>
                )}
                {started(detail) ? (
                  <p className="small muted">Zajęcia już się zaczęły – tej rezerwacji nie da się odwołać.</p>
                ) : (
                  <>
                    {lateCancel(detail) && <p className="small" style={{ color: 'var(--danger)' }}>Do zajęć zostało mniej niż {fmtMinutes(studio.policy.cancelMinutesBefore)} – po odwołaniu wejście przepada, ale miejsce dostanie inna osoba.</p>}
                    {confirmCancel ? (
                      <div className="row">
                        <button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={() => setConfirmCancel(false)}>
                          Zostaję
                        </button>
                        <button className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={() => act(() => api(`/bookings/${detail.my_booking_id}`, { method: 'DELETE' }))}>
                          Tak, odwołuję
                        </button>
                      </div>
                    ) : (
                      <button className="btn danger block" disabled={busy} onClick={() => (lateCancel(detail) ? setConfirmCancel(true) : act(() => api(`/bookings/${detail.my_booking_id}`, { method: 'DELETE' })))}>
                        Odwołaj rezerwację
                      </button>
                    )}
                  </>
                )}
              </>
            ) : detail.my_status === 'waitlist' ? (
              <>
                <p className="small">Jesteś na liście oczekujących. Gdy zwolni się miejsce, zapiszemy Cię automatycznie i damy znać.</p>
                <button className="btn ghost block" disabled={busy} onClick={() => act(() => api(`/bookings/${detail.my_booking_id}`, { method: 'DELETE' }))}>
                  Wypisz mnie z listy
                </button>
              </>
            ) : detail.status === 'cancelled' ? (
              <p>Te zajęcia zostały odwołane.</p>
            ) : started(detail) ? (
              <p className="small muted">Te zajęcia już się odbyły – zapisz się na kolejny termin.</p>
            ) : detail.taken >= detail.capacity ? (
              <button className="btn block" disabled={busy} onClick={() => act(() => api('/bookings', { method: 'POST', body: { sessionId: detail.id } }))}>
                Dopisz mnie do listy oczekujących
              </button>
            ) : (
              <>
                {detail.capacity - detail.taken >= 2 && <Toggle label="Rezerwuję we dwie" hint="Dwa miejsca jednym kliknięciem – z wejścia z gościem albo drugiego wejścia z karnetu" checked={withFriend} onChange={setWithFriend} />}
                {withFriend && (
                  <Field label="Imię osoby, która idzie z Tobą">
                    <input className="input" value={guest} onChange={(e) => setGuest(e.target.value)} />
                  </Field>
                )}
                {withFriend && (
                  <button className="btn block" disabled={busy || !guest.trim()} onClick={() => act(() => api('/bookings', { method: 'POST', body: { sessionId: detail.id, guest: { name: guest } } }))}>
                    Zarezerwuj dwa miejsca
                  </button>
                )}
              </>
            )}
            {detail.template_id && detail.status !== 'cancelled' && (
              <Toggle
                label="Na stałe"
                hint={`Zapisujemy Cię automatycznie co tydzień (${DOW[new Date(`${localDate(new Date(detail.starts_at))}T12:00:00Z`).getUTCDay()]} ${fmtTime(detail.starts_at)})`}
                checked={!!detail.my_recurring_id}
                onChange={(v) => act(() => (v ? api('/recurring', { method: 'POST', body: { templateId: detail.template_id } }) : api(`/recurring/${detail.my_recurring_id}`, { method: 'DELETE' })))}
              />
            )}
            {detail.status !== 'cancelled' && Date.parse(detail.starts_at) > Date.now() && (
              <details>
                <summary className="small" style={{ cursor: 'pointer' }}>Umów się z dziewczynami</summary>
                <div className="row" style={{ marginTop: 8 }}>
                  <input className="input" inputMode="tel" placeholder="Numer koleżanki" value={invitePhone} onChange={(e) => setInvitePhone(e.target.value)} />
                  <button className="btn sm" disabled={!invitePhone || busy} onClick={() => act(() => api(`/sessions/${detail.id}/invite`, { method: 'POST', body: { phone: invitePhone } }).then((r) => (setInvitePhone(''), r)))}>
                    Zaproś
                  </button>
                </div>
              </details>
            )}
            <p className="tiny muted center">
              Zapis i bezpłatne odwołanie do {fmtMinutes(studio.policy.cancelMinutesBefore)} przed zajęciami.
            </p>
          </div>
        </Sheet>
      )}

      {/* Historia zajęć (przeniesiona z Profilu) – na samym dole Grafiku. */}
      <ClassHistory />
    </div>
  );
}

/** Duża karta zajęć do poziomej karuzeli: godzina, nazwa, prowadząca i sala, wolne miejsca – reszta w arkuszu. `day` – z dniem przed godziną (poza Grafikiem). */
export function SessionCard({ s, fav, onFav, onOpen, reason, day }: { s: Session; fav: boolean; onFav: () => void; onOpen: (tile: HTMLElement) => void; reason?: string | null; day?: boolean }) {
  const free = s.capacity - s.taken;
  const past = Date.parse(s.starts_at) < Date.now();
  return (
    <div className="fav-wrap cc-item">
      <ClassCover
        photoUrl={s.photo_url}
        onClick={(e) => onOpen(e.currentTarget)}
        dimmed={past || s.status === 'cancelled'}
        eyebrow={`${day ? `${fmtDay(s.starts_at)} · ` : ''}${fmtTime(s.starts_at)} · ${Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000)} min`}
        title={s.class_name}
        meta={`prowadzi ${s.trainer_name} · ${s.zone_name}`}
        aside={<TrainerFace name={s.trainer_name} url={s.trainer_avatar_url} />}
        corner={
          s.my_status === 'booked' ? (
            <span className="badge ok">{s.my_guest ? 'we dwie' : 'zapisana'}</span>
          ) : s.my_status === 'attended' ? (
            <span className="badge">byłaś</span>
          ) : s.my_status === 'waitlist' ? (
            <span className="badge warn">na liście</span>
          ) : s.status === 'cancelled' ? (
            <span className="badge">odwołane</span>
          ) : reason && reason !== 'ulubione' ? (
            <span className="badge">{reason}</span>
          ) : s.kind === 'themed' || s.kind === 'special' ? (
            <span className="badge">{s.kind === 'themed' ? 'tematyczne' : 'specjalne'}</span>
          ) : null
        }
        footer={s.status !== 'cancelled' && !past ? (free > 0 ? `${free} ${free === 1 ? 'wolne miejsce' : free < 5 ? 'wolne miejsca' : 'wolnych miejsc'}` : 'Komplet') : null}
      />
      <button type="button" className={`fav-btn${s.photo_url ? ' on-photo' : ''}`} aria-pressed={fav} aria-label={fav ? `Usuń ${s.class_name} z ulubionych` : `Dodaj ${s.class_name} do ulubionych`} onClick={onFav}>
        <Icon name="heart" size={16} />
      </button>
    </div>
  );
}

/** Wizytówka prowadzącej w arkuszu zajęć: zdjęcie z konta, imię, krótkie bio. Całość prowadzi do profilu, obok – napisz. */
function TrainerCard({ s, onProfile, onWrite }: { s: Session; onProfile: () => void; onWrite: () => void }) {
  return (
    <div className="trainer-card">
      <button type="button" className="trainer-card-main" onClick={onProfile} aria-label={`Profil prowadzącej: ${s.trainer_name}`}>
        <span className="trainer-card-photo">{s.trainer_avatar_url ? <img src={s.trainer_avatar_url} alt="" /> : s.trainer_name.charAt(0)}</span>
        <span className="trainer-card-text">
          <span className="eyebrow">Prowadzi</span>
          <span className="trainer-card-name">{s.trainer_name}</span>
          {s.trainer_bio && <span className="trainer-card-bio">{s.trainer_bio}</span>}
        </span>
        <Icon name="chevron" />
      </button>
      <button type="button" className="trainer-card-write" onClick={onWrite} aria-label={`Napisz do ${s.trainer_name}`}>
        <Icon name="chat" />
      </button>
    </div>
  );
}
