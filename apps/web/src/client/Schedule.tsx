// Grafik (4.1): widok dnia / tygodnia / miesiąca, filtry (typ, trenerka, poziom, sala, wolne miejsca), zapis,
// trening we dwie (#6), rezerwacja „na stałe”, lista oczekujących, odwołanie, „umów się z dziewczynami”,
// playlista zajęć, synchronizacja z kalendarzem telefonu. Widok dnia: karuzela „Dopasowane do Ciebie” (ankieta
// + ulubione, core/classfit) i pod nią karuzela pozostałych zajęć tego dnia.
import { useMemo, useState } from 'react';
import { dayTimesOf, FIT_THRESHOLD, fitReason, fitScore, type ClassAudience, type ClassFit } from '@glam/core';
import { Icon } from '../icons.tsx';
import { ClassFitSheet } from './ClassFitQuestions.tsx';
import { addDaysStr, api, ApiError, fmtLongDay, fmtMinutes, fmtTime, localDate, useApi } from '../api.ts';
import { Empty, Field, Sheet, Spinner, Toggle, useToast } from '../ui.tsx';
import { ClassCover } from './ClassCover.tsx';
import { ClassHistory } from './ClassHistory.tsx';
import { useClient } from './ClientApp.tsx';

type Session = {
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
  /** godzina i dzień tygodnia w strefie studia – do dopasowania pory z ankiety */
  local_hour: number;
  local_weekday: number;
};

type ForYou = { s: Session; fav: boolean; reason: string | null };

const DOW = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob'];
/** Nazwa dnia w kalendarzu miesiąca (dla czytnika ekranu) – daty to „YYYY-MM-DD” w południe UTC. */
const MONTH_DAY = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
type View = 'day' | 'week' | 'month';

export function Schedule() {
  const { studio, openShop, open } = useClient();
  const today = localDate();
  const [view, setView] = useState<View>('day');
  // Tydzień może zacząć się od ostatniego dnia z paska (dziś + 13), więc pobieramy 21 dni.
  const span = view === 'month' ? 35 : 21;
  const { data, reload } = useApi<{ sessions: Session[]; fit: ClassFit | null; favorites: string[] }>(`/schedule?from=${today}&days=${span}`, [span]);
  /** Serduszka zmieniamy od razu na ekranie, serwer dostaje zmianę w tle. */
  const [favs, setFavs] = useState<string[] | null>(null);
  const [askFit, setAskFit] = useState(false);
  const [day, setDay] = useState(today);
  const [type, setType] = useState<string | null>(null);
  const [trainer, setTrainer] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [onlyFree, setOnlyFree] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [detail, setDetail] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  /** Odwołanie po terminie (wejście przepada) wymaga drugiego dotknięcia. */
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [withFriend, setWithFriend] = useState(false);
  const [guest, setGuest] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const toast = useToast();

  const uniq = (key: keyof Session) => [...new Set((data?.sessions ?? []).map((s) => s[key]).filter(Boolean))] as string[];
  const types = useMemo(() => uniq('class_name'), [data]);
  const trainers = useMemo(() => uniq('trainer_name'), [data]);
  const levels = useMemo(() => uniq('level'), [data]);
  const zones = useMemo(() => uniq('zone_name'), [data]);
  const matches = (s: Session) => (!type || s.class_name === type) && (!trainer || s.trainer_name === trainer) && (!level || s.level === level) && (!zone || s.zone_name === zone) && (!onlyFree || s.taken < s.capacity);
  const filtered = (data?.sessions ?? []).filter(matches);
  const list = view === 'day' ? filtered.filter((s) => localDate(new Date(s.starts_at)) === day) : filtered.filter((s) => localDate(new Date(s.starts_at)) >= day && localDate(new Date(s.starts_at)) < addDaysStr(day, 7));

  const act = async (fn: () => Promise<{ message?: string }>) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res?.message) toast(res.message);
      setDetail(null);
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
  const forYou: ForYou[] = [];
  if (view === 'day') {
    const scored = list
      .filter((s) => s.status !== 'cancelled' && Date.parse(s.starts_at) > Date.now())
      .map((s) => ({ s, fav: isFav(s), score: fit ? fitScore(s.audience, fit, dayTimesOf(s.local_hour, s.local_weekday)) : 0 }))
      .filter((x) => x.fav || x.score >= FIT_THRESHOLD)
      .sort((a, b) => Number(b.fav) - Number(a.fav) || b.score - a.score || a.s.starts_at.localeCompare(b.s.starts_at));
    for (const x of scored) forYou.push({ s: x.s, fav: x.fav, reason: x.fav ? 'ulubione' : fit && fitReason(x.s.audience, fit) });
  }
  const rest = list.filter((s) => !forYou.some((f) => f.s.id === s.id));

  const started = (s: Session) => Date.parse(s.starts_at) <= Date.now();
  const activeFilters = [type, trainer, level, zone].filter(Boolean).length + Number(onlyFree);
  /** Pusty dzień (bez filtrów): „odpoczywa” – nic w grafiku, „done” – dziś wszystko już się odbyło. Wtedy zamiast list pokazujemy spokojną planszę. */
  const dayRest: DayRestKind | null =
    view !== 'day' || activeFilters > 0 ? null : list.length === 0 ? (day === today ? 'today-empty' : 'empty') : day === today && list.every((s) => started(s) || s.status === 'cancelled') ? 'done' : null;
  /** Najbliższe zajęcia po wybranym dniu (i po teraz) – plansza od razu do nich prowadzi. */
  const nextAfterDay = dayRest ? (data?.sessions ?? []).find((s) => s.status !== 'cancelled' && !started(s) && localDate(new Date(s.starts_at)) > day) ?? null : null;
  const canQuickBook = (s: Session) => !s.my_status && s.status !== 'cancelled' && !started(s) && s.taken < s.capacity;
  const lateCancel = (s: Session) => Date.parse(s.starts_at) - Date.now() < studio.policy.cancelMinutesBefore * 60_000;
  const days = Array.from({ length: 14 }, (_, i) => addDaysStr(today, i));

  // „Dopasowane do Ciebie”: karuzela, gdy coś pasuje; bez ankiety – zachęta do niej. Ankieta jest, a nic nie pasuje – sekcji nie ma.
  const forYouSection = (
    <section className="stack gap-2" aria-label="Dopasowane do Ciebie">
      <div className="row between">
        <h2 className="carousel-title">
          Dopasowane <span className="serif">do Ciebie</span>
        </h2>
        {fit && (
          <button className="link small" style={{ whiteSpace: 'nowrap' }} onClick={() => setAskFit(true)} aria-label="Zmień odpowiedzi z ankiety">
            Zmień
          </button>
        )}
      </div>
      {forYou.length > 0 ? (
        <div className="cover-carousel">
          {forYou.map(({ s, fav, reason }) => (
            <SessionCard key={s.id} s={s} fav={fav} onFav={() => toggleFav(s)} onOpen={() => setDetail(s)} reason={reason} />
          ))}
        </div>
      ) : (
        <button className="fit-prompt" onClick={() => setAskFit(true)}>
          <b>Trzy pytania i wiemy, co Ci polecić</b>
          <span className="small muted">Poziom, cel i pora dnia – zajmie mniej niż minutę. Serduszkiem dodasz też ulubione zajęcia.</span>
        </button>
      )}
    </section>
  );

  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Grafik</h1>
        <div className="segmented" role="group" aria-label="Widok grafiku">
          {(
            [
              ['day', 'Dzień'],
              ['week', 'Tydzień'],
              ['month', 'Miesiąc'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {view === 'month' ? (
        <MonthGrid today={today} sessions={filtered} selected={day} onPick={(d) => (setDay(d), setView('day'))} />
      ) : (
        <div className="chips" role="group" aria-label="Wybierz dzień">
          {days.map((d) => {
            const date = new Date(`${d}T12:00:00Z`);
            return (
              <button key={d} className="day ring" aria-pressed={d === day} onClick={() => setDay(d)}>
                <svg viewBox="0 0 56 56" aria-hidden="true">
                  <circle cx="28" cy="28" r="26" pathLength={24} />
                </svg>
                {d === today ? 'dziś' : DOW[date.getUTCDay()]}
                <b>{date.getUTCDate()}</b>
              </button>
            );
          })}
        </div>
      )}

      {/* Kalendarz telefonu jest w Profilu (Logowanie i urządzenia) – w grafiku tylko filtry. */}
      <div className="row">
        <button className="chip" aria-pressed={showFilters || activeFilters > 0} onClick={() => setShowFilters(!showFilters)}>
          Filtry{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>
      {showFilters && (
        <div className="stack gap-2">
          {[
            ['Typ', types, type, setType],
            ['Trenerka', trainers, trainer, setTrainer],
            ['Poziom', levels, level, setLevel],
            ['Sala', zones, zone, setZone],
          ].map(([label, options, value, set]) => (
            <div key={label as string} className="chips" role="group" aria-label={`Filtr: ${label}`}>
              {(options as string[]).map((o) => (
                <button key={o} className="chip" aria-pressed={value === o} onClick={() => (set as (v: string | null) => void)(value === o ? null : o)}>
                  {o}
                </button>
              ))}
            </div>
          ))}
          <div className="chips">
            <button className="chip" aria-pressed={onlyFree} onClick={() => setOnlyFree(!onlyFree)}>
              Tylko wolne miejsca
            </button>
          </div>
        </div>
      )}

      {view === 'day' && !data && <Spinner />}
      {view === 'day' && data && dayRest && <DayRest kind={dayRest} next={nextAfterDay} onNext={(d) => setDay(d)} />}
      {view === 'day' && data && !dayRest && (
        <>
          {/* Nic ulubionego ani dopasowanego → najpierw wszystkie zajęcia dnia; zachęta do ankiety ląduje pod nimi. */}
          {forYou.length > 0 && forYouSection}

          {rest.length > 0 && (
            <section className="stack gap-2" aria-label="Pozostałe zajęcia tego dnia">
              <h2 className="carousel-title">{forYou.length ? 'Pozostałe zajęcia' : 'Zajęcia tego dnia'}</h2>
              <div className="cover-carousel">
                {rest.map((s) => (
                  <SessionCard key={s.id} s={s} fav={isFav(s)} onFav={() => toggleFav(s)} onOpen={() => setDetail(s)} />
                ))}
              </div>
            </section>
          )}
          {forYou.length === 0 && !fit && forYouSection}
          {list.length === 0 && filtered.length > 0 && activeFilters > 0 && <Empty>Nic nie pasuje do filtrów tego dnia.</Empty>}
        </>
      )}

      {view === 'week' && (
        <>
          {!data && <Spinner />}
          {data && list.length === 0 && <Empty>Nic nie pasuje. Zajrzyj na inny dzień albo zmień filtry.</Empty>}
          <div className="cover-list">
            {list.map((s, i) => {
              const newDay = i === 0 || localDate(new Date(list[i - 1].starts_at)) !== localDate(new Date(s.starts_at));
              return (
                <div key={s.id} style={{ display: 'contents' }}>
                  {newDay && <div className="eyebrow" style={{ marginTop: 10 }}>{fmtLongDay(s.starts_at)}</div>}
                  <SessionCard s={s} fav={isFav(s)} onFav={() => toggleFav(s)} onOpen={() => setDetail(s)} bleed />
                </div>
              );
            })}
          </div>
        </>
      )}

      {askFit && <ClassFitSheet initial={fit} onClose={() => setAskFit(false)} onSaved={reload} />}

      {detail && (
        <Sheet onClose={() => (setDetail(null), setConfirmCancel(false))} label={detail.class_name}>
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
                {!detail.my_confirmed_at && Date.parse(detail.starts_at) - Date.now() < 24 * 3_600_000 && (
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

/** Karta zajęć z serduszkiem. W karuzeli – stała wysokość, w tygodniu – pełna szerokość jak dotąd. */
function SessionCard({ s, fav, onFav, onOpen, reason, bleed }: { s: Session; fav: boolean; onFav: () => void; onOpen: () => void; reason?: string | null; bleed?: boolean }) {
  const free = s.capacity - s.taken;
  const past = Date.parse(s.starts_at) < Date.now();
  return (
    <div className={bleed ? 'fav-wrap' : 'fav-wrap cc-item'}>
      <ClassCover
        bleed={bleed}
        photoUrl={s.photo_url}
        photoRatio={s.photo_ratio}
        onClick={onOpen}
        dimmed={past || s.status === 'cancelled'}
        eyebrow={`${fmtTime(s.starts_at)} · ${Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000)} min${s.kind === 'themed' ? ' · tematyczne' : s.kind === 'special' ? ' · specjalne' : ''}`}
        title={s.class_name}
        aside={<TrainerFace name={s.trainer_name} url={s.trainer_avatar_url} />}
        corner={
          s.my_status === 'booked' ? (
            <span className="badge ok">{s.my_guest ? 'zapisane we dwie' : 'zapisana'}</span>
          ) : s.my_status === 'attended' ? (
            <span className="badge">byłaś</span>
          ) : s.my_status === 'waitlist' ? (
            <span className="badge warn">na liście</span>
          ) : s.status === 'cancelled' ? (
            <span className="badge">odwołane</span>
          ) : reason && reason !== 'ulubione' ? (
            <span className="badge">{reason}</span>
          ) : null
        }
        footer={s.status !== 'cancelled' && !past ? (free > 0 ? `${free} ${free === 1 ? 'wolne miejsce' : free < 5 ? 'wolne miejsca' : 'wolnych miejsc'}` : `Komplet · oczekujące: ${s.waiting}`) : null}
      />
      <button type="button" className={`fav-btn${s.photo_url ? ' on-photo' : ''}`} aria-pressed={fav} aria-label={fav ? `Usuń ${s.class_name} z ulubionych` : `Dodaj ${s.class_name} do ulubionych`} onClick={onFav}>
        <Icon name="heart" size={20} />
      </button>
    </div>
  );
}

/** Samo zdjęcie prowadzącej na karcie zajęć (imię dla czytników ekranu i w podpowiedzi). */
function TrainerFace({ name, url }: { name: string; url: string | null }) {
  return (
    <span className="cover-face" title={`prowadzi ${name}`} aria-label={`prowadzi ${name}`} role="img">
      {url ? <img src={url} alt="" loading="lazy" /> : name.charAt(0)}
    </span>
  );
}

type DayRestKind = 'today-empty' | 'empty' | 'done';

const DAY_REST: Record<DayRestKind, { title: [string, string]; text: string }> = {
  done: { title: ['Na dziś', 'to wszystko'], text: 'Do zobaczenia na macie.' },
  'today-empty': { title: ['Dziś studio', 'odpoczywa'], text: 'Czas na regenerację.' },
  empty: { title: ['Tego dnia', 'odpoczywamy'], text: 'Zajrzyj na inny dzień.' },
};

/** Plansza pustego dnia: ikonka, krótki nagłówek, jedno zdanie i ciche wyjście do najbliższych zajęć. */
function DayRest({ kind, next, onNext }: { kind: DayRestKind; next: Session | null; onNext: (day: string) => void }) {
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

function MonthGrid({ today, sessions, selected, onPick }: { today: string; sessions: Session[]; selected: string; onPick: (d: string) => void }) {
  const first = new Date(`${today}T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const start = addDaysStr(today, -offset);
  const cells = Array.from({ length: 35 }, (_, i) => addDaysStr(start, i));
  const count = new Map<string, { all: number; mine: number }>();
  for (const s of sessions) {
    const d = localDate(new Date(s.starts_at));
    const c = count.get(d) ?? { all: 0, mine: 0 };
    c.all++;
    if (s.my_status) c.mine++;
    count.set(d, c);
  }
  return (
    <div>
      <div className="month-days">
        {['pn', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'].map((d) => (
          <div key={d} className="tiny muted center">
            {d}
          </div>
        ))}
        {cells.map((d) => {
          const c = count.get(d);
          const past = d < today;
          const label = `${MONTH_DAY.format(new Date(`${d}T12:00:00Z`))}${c ? ` · zajęcia: ${c.all}${c.mine ? ', jesteś zapisana' : ''}` : ' · brak zajęć'}`;
          return (
            <button
              key={d}
              className={`month-day${c && !past ? ' has-classes' : ''}${c?.mine && !past ? ' mine' : ''}`}
              disabled={past}
              aria-pressed={d === selected}
              aria-label={label}
              onClick={() => onPick(d)}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="tiny muted month-legend">
        <span className="month-swatch has-classes" /> zajęcia
        <span className="month-swatch mine" /> Twój zapis
      </p>
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
