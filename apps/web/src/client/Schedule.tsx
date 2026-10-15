// Grafik (4.1): widok dnia / tygodnia / miesiąca, filtry (typ, trenerka, poziom, sala, wolne miejsca), zapis,
// trening we dwie (#6), rezerwacja „na stałe”, lista oczekujących, odwołanie, „umów się z dziewczynami”,
// playlista zajęć, synchronizacja z kalendarzem telefonu.
import { useMemo, useState } from 'react';
import { addDaysStr, api, ApiError, fmtLongDay, fmtMinutes, fmtTime, localDate, useApi } from '../api.ts';
import { Empty, Field, Sheet, Spinner, Toggle, useToast } from '../ui.tsx';
import { ClassCover } from './ClassCover.tsx';
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
  playlist_name: string | null;
  playlist_url: string | null;
  taken: number;
  waiting: number;
  my_booking_id: string | null;
  my_status: 'booked' | 'waitlist' | 'attended' | null;
  my_confirmed_at: string | null;
  my_guest: string | null;
  my_recurring_id: string | null;
};

const DOW = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob'];
type View = 'day' | 'week' | 'month';

export function Schedule() {
  const { studio, openShop, open } = useClient();
  const today = localDate();
  const [view, setView] = useState<View>('day');
  // Tydzień może zacząć się od ostatniego dnia z paska (dziś + 13), więc pobieramy 21 dni.
  const span = view === 'month' ? 35 : 21;
  const { data, reload } = useApi<{ sessions: Session[] }>(`/schedule?from=${today}&days=${span}`, [span]);
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

  const started = (s: Session) => Date.parse(s.starts_at) <= Date.now();
  const lateCancel = (s: Session) => Date.parse(s.starts_at) - Date.now() < studio.policy.cancelMinutesBefore * 60_000;
  const days = Array.from({ length: 14 }, (_, i) => addDaysStr(today, i));
  const activeFilters = [type, trainer, level, zone].filter(Boolean).length + Number(onlyFree);

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
              <button key={d} className="day" style={{ flex: 'none', width: 52 }} aria-pressed={d === day} onClick={() => setDay(d)}>
                {d === today ? 'dziś' : DOW[date.getUTCDay()]}
                <b>{date.getUTCDate()}</b>
              </button>
            );
          })}
        </div>
      )}

      <div className="row between">
        <button className="chip" aria-pressed={showFilters || activeFilters > 0} onClick={() => setShowFilters(!showFilters)}>
          Filtry{activeFilters ? ` (${activeFilters})` : ''}
        </button>
        <button className="link small" onClick={() => open('security')}>
          Dodaj do kalendarza telefonu
        </button>
      </div>
      {showFilters && (
        <div className="stack" style={{ gap: 6 }}>
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

      {view !== 'month' && (
        <>
          {!data && <Spinner />}
          {data && list.length === 0 && <Empty>Nic nie pasuje. Zajrzyj na inny dzień albo zmień filtry.</Empty>}
          <div className="cover-list">
            {list.map((s, i) => {
              const free = s.capacity - s.taken;
              const past = Date.parse(s.starts_at) < Date.now();
              const newDay = view === 'week' && (i === 0 || localDate(new Date(list[i - 1].starts_at)) !== localDate(new Date(s.starts_at)));
              return (
                <div key={s.id} style={{ display: 'contents' }}>
                  {newDay && <div className="eyebrow" style={{ marginTop: 10 }}>{fmtLongDay(s.starts_at)}</div>}
                  <ClassCover
                    bleed
                    photoUrl={s.photo_url}
                    photoRatio={s.photo_ratio}
                    onClick={() => setDetail(s)}
                    dimmed={past || s.status === 'cancelled'}
                    eyebrow={`${fmtTime(s.starts_at)} · ${Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000)} min${s.kind === 'themed' ? ' · tematyczne' : s.kind === 'special' ? ' · specjalne' : ''}`}
                    title={s.class_name}
                    meta={`prowadzi ${s.trainer_name} · ${s.zone_name}`}
                    corner={
                      s.my_status === 'booked' ? (
                        <span className="badge ok">{s.my_guest ? 'zapisane we dwie' : 'zapisana'}</span>
                      ) : s.my_status === 'attended' ? (
                        <span className="badge">byłaś</span>
                      ) : s.my_status === 'waitlist' ? (
                        <span className="badge warn">na liście</span>
                      ) : s.status === 'cancelled' ? (
                        <span className="badge">odwołane</span>
                      ) : null
                    }
                    footer={s.status !== 'cancelled' && !past ? (free > 0 ? `${free} ${free === 1 ? 'wolne miejsce' : free < 5 ? 'wolne miejsca' : 'wolnych miejsc'}` : `Komplet · oczekujące: ${s.waiting}`) : null}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      {detail && (
        <Sheet onClose={() => (setDetail(null), setConfirmCancel(false))} label={detail.class_name}>
          <div className="stack">
            {detail.photo_url && (
              <div className="sheet-cover">
                <img src={detail.photo_url} alt="" />
              </div>
            )}
            <div className="eyebrow">{fmtLongDay(detail.starts_at)}</div>
            <h2 style={{ fontSize: '1.8rem' }}>
              {detail.class_name} <span className="serif">{fmtTime(detail.starts_at)}</span>
            </h2>
            <p className="muted">{detail.description}</p>
            <div className="row wrap small">
              <span className="badge">{detail.level}</span>
              <span className="badge">prowadzi {detail.trainer_name}</span>
              <span className="badge">{detail.zone_name}</span>
            </div>
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
                <button className="btn block" disabled={busy || (withFriend && !guest.trim())} onClick={() => act(() => api('/bookings', { method: 'POST', body: { sessionId: detail.id, guest: withFriend ? { name: guest } : null } }))}>
                  {withFriend ? 'Zarezerwuj dwa miejsca' : 'Zarezerwuj miejsce'}
                </button>
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
    </div>
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
      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {['pn', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'].map((d) => (
          <div key={d} className="tiny muted center">
            {d}
          </div>
        ))}
        {cells.map((d) => {
          const c = count.get(d);
          const past = d < today;
          return (
            <button key={d} className="day" disabled={past} aria-pressed={d === selected} onClick={() => onPick(d)} style={{ padding: '6px 0', opacity: past ? 0.35 : 1 }}>
              <b style={{ fontSize: '0.95rem' }}>{Number(d.slice(8))}</b>
              <span style={{ fontSize: '0.6rem' }}>{c ? (c.mine ? `● ${c.all}` : c.all) : ''}</span>
            </button>
          );
        })}
      </div>
      <p className="tiny muted">● – masz zapis tego dnia. Liczba – ile zajęć pasuje do filtrów.</p>
    </div>
  );
}
