// „Dziś” trenerki / recepcji (3, 4.11): sesje dnia, uczestniczki z celem i uwagami zdrowotnymi (za zgodą),
// check-in z listy, QR albo po telefonie (także wejście do strefy z wolnym wstępem – C3), lista oczekujących,
// ręczne dodanie (płatność na miejscu), nieobecność, zmiana prowadzącej, odwołanie zajęć, wydarzenia dnia.
import { useEffect, useRef, useState } from 'react';
import { can, type Role } from '@glam/core';
import { addDaysStr, api, fmtLongDay, fmtTime, localDate, useApi } from '../api.ts';
import { Avatar, Empty, Select, Sheet, Spinner, Toggle, useAction } from '../ui.tsx';

type Participant = { booking_id: string; status: string; user_id: string; name: string; phone?: string; goal: string | null; visits: number; guest_name: string | null; confirmed_at: string | null; rating: number | null; health: { limitations?: string; injuries?: string; pregnancy?: boolean } | null };
type Session = { id: string; starts_at: string; class_name: string; trainer_name: string; trainer_id: string; zone_name: string; capacity: number; status: string; kind: string; playlist_name: string | null; rating: { avg: number | null; n: number }; participants: Participant[] };
type Day = { date: string; sessions: Session[]; events: { id: string; kind: string; activity: string; starts_at: string; guests: number; status: string; client_name: string; client_note: string | null; trainer_name: string | null }[] };

export function Today({ roles }: { roles: Role[] }) {
  const [date, setDate] = useState(localDate());
  const { data, reload } = useApi<Day>(`/staff/day?date=${date}`, [date]);
  const cfg = useApi<{ trainers: { id: string; name: string }[] }>(can(roles, 'schedule.edit') ? '/owner/config' : null);
  const { run } = useAction();
  const [add, setAdd] = useState<Session | null>(null);
  const [manage, setManage] = useState<Session | null>(null);
  const isDesk = can(roles, 'participants.manage');

  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div>
          <h1 style={{ marginBottom: 0 }}>{date === localDate() ? 'Dziś' : 'Dzień'}</h1>
          <p className="muted" style={{ margin: 0 }}>{fmtLongDay(`${date}T12:00:00Z`)}</p>
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={() => setDate(addDaysStr(date, -1))} aria-label="Poprzedni dzień">
            ←
          </button>
          <button className="btn quiet sm" onClick={() => setDate(localDate())}>
            Dziś
          </button>
          <button className="btn ghost sm" onClick={() => setDate(addDaysStr(date, 1))} aria-label="Następny dzień">
            →
          </button>
        </div>
      </div>

      <CheckinBox onDone={reload} />

      {data?.events.map((e) => (
        <section key={e.id} className="card soft stack" style={{ gap: 4 }}>
          <div className="eyebrow">Wydarzenie prywatne · {e.status}</div>
          <b>
            {fmtTime(e.starts_at)} · {e.activity} · {e.guests} os.
          </b>
          <span className="small">organizuje {e.client_name} · prowadzi {e.trainer_name}</span>
          {e.client_note && <span className="small muted">Notatka: {e.client_note}</span>}
        </section>
      ))}

      {!data && <Spinner />}
      {data?.sessions.length === 0 && <Empty>Brak zajęć tego dnia.</Empty>}
      {data?.sessions.map((s) => {
        const booked = s.participants.filter((p) => p.status !== 'waitlist');
        const waiting = s.participants.filter((p) => p.status === 'waitlist');
        return (
          <section key={s.id} className="card stack">
            <div className="row between wrap">
              <div>
                <h3 style={{ margin: 0 }}>
                  {fmtTime(s.starts_at)} · {s.class_name} {s.kind !== 'regular' && <span className="badge">{s.kind === 'event' ? 'wydarzenie' : s.kind === 'themed' ? 'tematyczne' : 'specjalne'}</span>}
                </h3>
                <div className="small muted">
                  {s.zone_name} · prowadzi {s.trainer_name}
                  {s.playlist_name && ` · 🎵 ${s.playlist_name}`}
                  {s.rating.n > 0 && ` · ★ ${s.rating.avg} (${s.rating.n})`}
                </div>
              </div>
              <div className="row">
                {s.status === 'cancelled' ? (
                  <span className="badge">odwołane</span>
                ) : (
                  <span className={`badge ${booked.length >= s.capacity ? 'warn' : 'ok'}`}>
                    {booked.filter((p) => p.status !== 'no_show').length} / {s.capacity}
                  </span>
                )}
                {isDesk && s.status !== 'cancelled' && (
                  <button className="btn ghost sm" onClick={() => setAdd(s)}>
                    + Dodaj
                  </button>
                )}
                {can(roles, 'schedule.edit') && s.status !== 'cancelled' && (
                  <button className="btn ghost sm" onClick={() => setManage(s)}>
                    Zarządzaj
                  </button>
                )}
              </div>
            </div>
            {booked.length === 0 && <p className="muted small">Nikt jeszcze się nie zapisał.</p>}
            {booked.map((p) => (
              <div key={p.booking_id} className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, alignItems: 'flex-start' }}>
                <Avatar name={p.name} size="sm" />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>
                    {p.name} {p.visits === 0 && !p.guest_name && <span className="badge accent">pierwszy raz</span>} {p.confirmed_at && <span className="badge">potwierdziła</span>}
                  </div>
                  <div className="tiny muted">
                    {p.goal ? `Cel: ${p.goal}` : `${p.visits} wizyt`}
                    {p.phone && ` · ${p.phone}`}
                  </div>
                  {p.health && (p.health.limitations || p.health.injuries || p.health.pregnancy) && (
                    <div className="tiny" style={{ color: 'var(--brand-strong)' }}>
                      ⚑ {[p.health.pregnancy && 'ciąża', p.health.limitations, p.health.injuries].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                {p.status === 'attended' ? (
                  <span className="badge ok">obecna ✓</span>
                ) : p.status === 'no_show' ? (
                  <span className="badge">nieobecna</span>
                ) : (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn sm" onClick={() => run(() => api(`/staff/bookings/${p.booking_id}/checkin`, { method: 'POST' }).then(reload), `${p.name} – obecna ✓`)}>
                      Check-in
                    </button>
                    <button className="btn ghost sm" onClick={() => run(() => api(`/staff/bookings/${p.booking_id}/no-show`, { method: 'POST' }).then(reload), 'Oznaczono nieobecność')}>
                      Nie przyszła
                    </button>
                    {isDesk && (
                      <button className="btn danger sm" onClick={() => run(() => api(`/staff/bookings/${p.booking_id}`, { method: 'DELETE' }).then(reload), 'Odwołane, wejście wróciło')}>
                        Odwołaj
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {waiting.length > 0 && (
              <p className="small muted" style={{ margin: 0 }}>
                Lista oczekujących: {waiting.map((w) => w.name).join(', ')}
              </p>
            )}
          </section>
        );
      })}
      {add && <AddParticipant session={add} onClose={() => setAdd(null)} onDone={reload} />}
      {manage && <ManageSession session={manage} trainers={cfg.data?.trainers ?? []} onClose={() => setManage(null)} onDone={reload} />}
    </div>
  );
}

/** Check-in QR (kamera z BarcodeDetector) albo po numerze telefonu. */
function CheckinBox({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  const [scanning, setScanning] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { run } = useAction();
  const submit = (input: string) =>
    run(async () => {
      const body = input.startsWith('GLAM1.') ? { code: input } : { phone: input };
      const r = await api<{ message: string }>('/staff/checkin', { method: 'POST', body });
      setLast(r.message);
      setValue('');
      onDone();
      return r;
    });
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    (async () => {
      if (!Detector) {
        setScanning(false);
        alert('Ta przeglądarka nie czyta kodów QR. Wpisz numer telefonu albo użyj czytnika.');
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
      }
      const det = new Detector({ formats: ['qr_code'] });
      timer = window.setInterval(async () => {
        if (!video.current) return;
        const codes = await det.detect(video.current).catch(() => []);
        if (codes[0]?.rawValue) {
          setScanning(false);
          submit(codes[0].rawValue);
        }
      }, 400);
    })().catch(() => setScanning(false));
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);
  return (
    <section className="card soft stack" style={{ gap: 10 }}>
      <div className="eyebrow">Check-in</div>
      <div className="row">
        <input className="input" placeholder="Numer telefonu albo kod z aplikacji" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && value && submit(value)} />
        <button className="btn sm" disabled={!value} onClick={() => submit(value)}>
          Wejście
        </button>
        <button className="btn ghost sm" onClick={() => setScanning(!scanning)}>
          {scanning ? 'Zamknij kamerę' : 'Skanuj QR'}
        </button>
      </div>
      {scanning && <video ref={video} style={{ width: '100%', maxWidth: 360, borderRadius: 16 }} muted playsInline />}
      {last && <div className="small">{last}</div>}
    </section>
  );
}

function AddParticipant({ session, onClose, onDone }: { session: Session; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const clients = useApi<{ id: string; name: string | null; phone?: string; hasActivePass: boolean }[]>(`/staff/clients?q=${encodeURIComponent(q)}`, [q]);
  const [payAtDesk, setPayAtDesk] = useState(false);
  const [guest, setGuest] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const { run, busy } = useAction();
  const addUser = (userId: string) =>
    run(() => api(`/staff/sessions/${session.id}/participants`, { method: 'POST', body: { userId, payAtDesk, guest: guest ? { name: guest } : null } }).then((r) => (onDone(), onClose(), r)));
  return (
    <Sheet onClose={onClose} label="Dodaj uczestniczkę">
      <div className="stack">
        <h2>
          {fmtTime(session.starts_at)} · {session.class_name}
        </h2>
        <input className="input" placeholder="Szukaj: imię lub telefon" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <Toggle label="Płatność na miejscu" hint="Zapis bez karnetu – rozliczenie w recepcji" checked={payAtDesk} onChange={setPayAtDesk} />
        <input className="input" placeholder="Gość (trening we dwie) – imię, opcjonalnie" value={guest} onChange={(e) => setGuest(e.target.value)} />
        <div className="stack" style={{ gap: 4, maxHeight: 260, overflow: 'auto' }}>
          {clients.data?.slice(0, 20).map((c) => (
            <button key={c.id} className="list-row" disabled={busy} onClick={() => addUser(c.id)}>
              <span className="grow" style={{ textAlign: 'left' }}>
                {c.name} <span className="tiny muted">{c.phone}</span>
              </span>
              {!c.hasActivePass && <span className="badge">bez karnetu</span>}
            </button>
          ))}
        </div>
        <details>
          <summary className="small">Nowa klientka (pierwsza wizyta)</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            <input className="input" placeholder="Imię" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="input" inputMode="tel" placeholder="Telefon" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            <button
              className="btn ghost"
              disabled={!newName || !newPhone || busy}
              onClick={() => run(async () => {
                const r = await api<{ id: string }>('/staff/clients', { method: 'POST', body: { name: newName, phone: newPhone } });
                await addUser(r.id);
              })}
            >
              Zarejestruj i dodaj
            </button>
          </div>
        </details>
      </div>
    </Sheet>
  );
}

function ManageSession({ session, trainers, onClose, onDone }: { session: Session; trainers: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [trainer, setTrainer] = useState(session.trainer_id);
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  return (
    <Sheet onClose={onClose} label="Zarządzaj zajęciami">
      <div className="stack">
        <h2>
          {fmtTime(session.starts_at)} · {session.class_name}
        </h2>
        <div className="field">
          <span className="field-label">Prowadząca (zastępstwo)</span>
          <Select ariaLabel="Prowadząca" value={trainer} onChange={setTrainer} options={trainers.map((t) => ({ value: t.id, label: t.name }))} />
          <button className="btn ghost" disabled={trainer === session.trainer_id || busy} onClick={() => run(() => api(`/staff/sessions/${session.id}/trainer`, { method: 'POST', body: { trainerId: trainer } }).then((r) => (onDone(), onClose(), r)))}>
            Zmień i powiadom klientki
          </button>
        </div>
        <div className="field">
          <span className="field-label">Odwołanie zajęć</span>
          <input className="input" placeholder="Powód (np. choroba trenerki)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn danger" disabled={busy} onClick={() => window.confirm('Odwołać zajęcia? Klientki dostaną zwrot wejść i powiadomienie.') && run(() => api(`/staff/sessions/${session.id}/cancel`, { method: 'POST', body: { reason } }).then((r) => (onDone(), onClose(), r)))}>
            Odwołaj zajęcia
          </button>
        </div>
      </div>
    </Sheet>
  );
}
