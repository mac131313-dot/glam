// Wejście (recepcja, 4.11, C3): jedno pole na czytnik kodów, telefon i kod wejściówki od znajomej – czytnik USB/Bluetooth
// „pisze” kod i Enter, więc pole trzyma fokus. Kamera skanuje bez przerwy. Wynik duży i z dźwiękiem; gdy trzeba
// zdecydować (brak rezerwacji, nieaktywna wejściówka) – jedno kliknięcie. Obok najbliższe zajęcia: kto jeszcze nie weszła.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, api, fmtTime, localDate, useApi } from '../api.ts';
import { Avatar, Spinner, useAction } from '../ui.tsx';

type Who = { name: string; userId: string; firstVisit: boolean; health: string | null; activated: string | null };
type Entered = Who & { kind: 'class' | 'zone' | 'already' | 'activated'; message: string; className?: string; startsAt?: string; pass?: string | null; payAtDesk?: boolean };
type WalkIn = { sessionId: string; className: string; startsAt: string; zoneName: string; free: number; covered: boolean };
type Input = { code?: string; phone?: string; guest?: { name: string; phone: string } };
type Outcome =
  | { state: 'ok'; r: Entered; seq: number }
  | { state: 'choose'; input: Input; who: Who; message: string; options: WalkIn[]; zone: { id: string; name: string } | null }
  | { state: 'guest'; input: Input; message: string; variant: string; phone: string | null }
  | { state: 'error'; message: string };

const isPhone = (s: string) => /^[+\d][\d\s\-()]+$/.test(s) && s.replace(/\D/g, '').length >= 9;
const toInput = (raw: string): Input => (isPhone(raw) ? { phone: raw } : { code: raw });

let audio: AudioContext | null = null;
/** Krótki sygnał: wysoki – wejście, dwa niskie – trzeba spojrzeć na ekran. */
function signal(ok: boolean) {
  navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
  try {
    audio ??= new AudioContext();
    const at = audio.currentTime;
    (ok ? [0] : [0, 0.18]).forEach((delay) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.frequency.value = ok ? 880 : 330;
      gain.gain.setValueAtTime(0.15, at + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, at + delay + 0.14);
      osc.connect(gain).connect(audio!.destination);
      osc.start(at + delay);
      osc.stop(at + delay + 0.15);
    });
  } catch {}
}

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** Kamera z BarcodeDetector: skanuje ciągle; ten sam kod przez kilka sekund liczy się raz. */
function useQrCamera(enabled: boolean, paused: boolean, onCode: (code: string) => void, onUnsupported: () => void) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onCode);
  handler.current = onCode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    if (!enabled) return;
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!Ctor) return onUnsupported();
    let stream: MediaStream | null = null;
    let timer = 0;
    let last = { code: '', at: 0 };
    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!video.current) return;
      video.current.srcObject = stream;
      await video.current.play();
      const det = new Ctor({ formats: ['qr_code'] });
      timer = window.setInterval(async () => {
        if (!video.current || pausedRef.current) return;
        const code = (await det.detect(video.current).catch(() => []))[0]?.rawValue;
        if (!code || (code === last.code && Date.now() - last.at < 5000)) return;
        last = { code, at: Date.now() };
        handler.current(code);
      }, 300);
    })().catch(onUnsupported);
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return video;
}

type Arrival = { id: string; userId: string; name: string; at: string; what: string };

/** Check-in: czytnik / telefon / kod wejściówki, kamera, decyzje jednym kliknięciem; udane wejście – okienko, które samo znika. */
export function CheckinPanel({ onDone, big = false }: { onDone: () => void; big?: boolean }) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [popup, setPopup] = useState<{ r: Entered; seq: number } | null>(null);
  const arrivals = useApi<Arrival[]>(big ? '/staff/arrivals' : null);
  const [busy, setBusy] = useState(false);
  const [guest, setGuest] = useState({ name: '', phone: '' });
  const field = useRef<HTMLInputElement>(null);
  const focus = () => big && setTimeout(() => field.current?.focus(), 0);

  const send = useCallback(
    async (input: Input & { sessionId?: string; payAtDesk?: boolean; zoneId?: string }) => {
      setBusy(true);
      let decide = false;
      try {
        const r = await api<Entered>('/staff/checkin', { method: 'POST', body: input });
        if (r.kind === 'class' || r.kind === 'zone') {
          setPopup({ r, seq: Date.now() });
          setOutcome(null);
        } else setOutcome({ state: 'ok', r, seq: Date.now() });
        signal(true);
        arrivals.reload();
        onDone();
      } catch (e) {
        const err = e as ApiError;
        const base = { input: { code: input.code, phone: input.phone, guest: input.guest } };
        decide = err.code === 'no_booking' || err.code === 'guest_pass_new';
        if (err.code === 'no_booking') setOutcome({ state: 'choose', ...base, who: err.details, message: err.message, options: err.details.options, zone: err.details.zone });
        else if (err.code === 'guest_pass_new') {
          setGuest({ name: '', phone: err.details.phone ?? '' });
          setOutcome({ state: 'guest', ...base, message: err.message, variant: err.details.variant, phone: err.details.phone });
        } else setOutcome({ state: 'error', message: err.message });
        signal(false);
      } finally {
        setBusy(false);
        setValue('');
        if (!decide) focus();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onDone],
  );

  const deciding = outcome?.state === 'choose' || outcome?.state === 'guest';
  const video = useQrCamera(camera, busy || deciding, (code) => send(toInput(code)), () => {
    setCamera(false);
    setOutcome({ state: 'error', message: 'Ta przeglądarka nie czyta kodów QR kamerą. Użyj czytnika albo wpisz numer telefonu.' });
  });

  useEffect(() => {
    if (!big) return;
    // Czytnik „pisze” tam, gdzie jest fokus – po kliknięciu w puste miejsce wracamy do pola skanowania.
    const back = (e: FocusEvent) => !(e.relatedTarget instanceof HTMLInputElement) && !deciding && focus();
    const el = field.current;
    el?.addEventListener('blur', back);
    return () => el?.removeEventListener('blur', back);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big, deciding]);

  const submit = () => value.trim() && send(toInput(value.trim()));

  return (
    <section className={`card ${big ? '' : 'soft'} stack`} style={{ gap: 12 }}>
      {!big && <div className="eyebrow">Check-in</div>}
      <div className="row checkin-row">
        <input
          ref={field}
          className={`input ${big ? 'scan-input' : ''}`}
          placeholder="Zeskanuj kod albo wpisz telefon"
          aria-label="Kod z aplikacji, kod wejściówki albo numer telefonu"
          value={value}
          autoFocus={big}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className={`btn ${big ? '' : 'sm'}`} disabled={!value.trim() || busy} onClick={submit}>
          Wpuść
        </button>
        <button className={`btn ghost ${big ? '' : 'sm'}`} aria-pressed={camera} onClick={() => setCamera(!camera)}>
          {camera ? 'Wyłącz kamerę' : 'Kamera'}
        </button>
      </div>
      {camera && <video ref={video} className="scan-video" muted playsInline />}

      {outcome?.state === 'ok' && <Result key={outcome.seq} r={outcome.r} big={big} />}
      {outcome?.state === 'error' && (
        <div className="entry-result error" role="alert">
          <b>{outcome.message}</b>
        </div>
      )}
      {outcome?.state === 'choose' && (
        <div className="entry-result warn" role="alert">
          <WhoLine who={outcome.who} big={big} />
          <span>{outcome.message}</span>
          <div className="stack gap-2">
            {outcome.options.map((o) => (
              <div key={o.sessionId} className="row wrap">
                <button className="btn entry-option grow" disabled={busy} onClick={() => send({ ...outcome.input, sessionId: o.sessionId, payAtDesk: !o.covered })}>
                  <span>
                    {fmtTime(o.startsAt)} · {o.className}
                  </span>
                  <span className="tiny">
                    {o.free} wolne · {o.covered ? 'z karnetu' : 'płatność na miejscu'}
                  </span>
                </button>
              </div>
            ))}
            {outcome.zone && (
              <button className="btn ghost" disabled={busy} onClick={() => send({ ...outcome.input, zoneId: outcome.zone!.id })}>
                Tylko wejście: {outcome.zone.name}
              </button>
            )}
            <button className="btn quiet sm" onClick={() => (setOutcome(null), focus())}>
              Anuluj
            </button>
          </div>
        </div>
      )}
      {outcome?.state === 'guest' && (
        <form
          className="entry-result warn"
          onSubmit={(e) => {
            e.preventDefault();
            send({ ...outcome.input, guest });
          }}
        >
          <b>{outcome.message}</b>
          <div className="row wrap">
            <input className="input grow" placeholder="Imię" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} autoFocus />
            <input className="input grow" inputMode="tel" placeholder="Telefon" value={guest.phone} readOnly={!!outcome.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
          </div>
          <div className="row">
            <button className="btn grow" disabled={busy || guest.name.trim().length < 2 || !guest.phone}>
              Aktywuj i wpuść
            </button>
            <button type="button" className="btn quiet" onClick={() => (setOutcome(null), focus())}>
              Anuluj
            </button>
          </div>
        </form>
      )}

      {big && arrivals.data && (
        <div className="stack" style={{ gap: 2 }}>
          <div className="eyebrow">Obecne dziś · {arrivals.data.length}</div>
          {arrivals.data.length === 0 && <p className="muted small" style={{ margin: 0 }}>Jeszcze nikt nie weszła.</p>}
          {arrivals.data.map((a, i) => {
            const fresh = i === 0 && popup?.r.userId === a.userId;
            return (
              <div key={fresh ? `${a.id}-${popup!.seq}` : a.id} className={`row small arrival ${fresh ? 'arrival-new' : ''}`}>
                <span className="muted tiny" style={{ width: 40 }}>
                  {fmtTime(a.at)}
                </span>
                <Avatar name={a.name} size="sm" />
                <span className="grow">{a.name}</span>
                <span className="muted tiny">{a.what}</span>
              </div>
            );
          })}
        </div>
      )}
      {popup && <EntryPopup key={popup.seq} r={popup.r} onClose={() => setPopup(null)} />}
    </section>
  );
}

/** Okienko „weszła”: animacja potwierdzenia, imię i zajęcia; znika samo. Dłużej, gdy jest coś do przekazania. */
function EntryPopup({ r, onClose }: { r: Entered; onClose: () => void }) {
  const ms = r.firstVisit || r.health || r.payAtDesk ? 4000 : 2400;
  useEffect(() => {
    const t = window.setTimeout(onClose, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const detail = r.className && r.startsAt ? `${fmtTime(r.startsAt)} · ${r.className}` : r.message.replace(`${r.name} – `, '').replace(/ ✓$/, '');
  return createPortal(
    <div className="entry-pop-layer" style={{ '--out': `${ms - 350}ms` } as CSSProperties}>
      <div className="entry-pop" role="status" aria-live="assertive" onClick={onClose}>
        <ConfirmMark size={104} />
        <div className="entry-name">{r.name}</div>
        <div className="entry-pop-detail">{detail}</div>
        {r.pass && <span className="small muted">{r.pass}</span>}
        {(r.firstVisit || r.health || r.payAtDesk) && (
          <div className="stack gap-2" style={{ alignItems: 'center', marginTop: 4 }}>
            {r.firstVisit && <span className="badge accent">pierwszy raz – przywitaj i pokaż szatnię</span>}
            {r.health && <span className="tiny" style={{ color: 'var(--brand-strong)' }}>⚑ {r.health}</span>}
            {r.payAtDesk && <span className="small">Bez karnetu – rozlicz w kasie.</span>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function WhoLine({ who, big }: { who: Who; big: boolean }) {
  return (
    <div className="row grow" style={{ alignItems: 'center' }}>
      <Avatar name={who.name} size={big ? undefined : 'sm'} />
      <div className="grow">
        <div className={big ? 'entry-name' : ''} style={{ fontWeight: 600 }}>
          {who.name}
        </div>
        <div className="row wrap gap-2">
          {who.firstVisit && <span className="badge accent">pierwszy raz – przywitaj i pokaż szatnię</span>}
          {who.activated && <span className="badge">aktywowano: {who.activated}</span>}
          {who.health && <span className="tiny" style={{ color: 'var(--brand-strong)' }}>⚑ {who.health}</span>}
        </div>
      </div>
    </div>
  );
}

/** Potwierdzenie wejścia (wg Confirm.json): aureola i koło „wyskakują”, potem rysuje się ptaszek i rozchodzi fala. */
function ConfirmMark({ size }: { size: number }) {
  return (
    <svg className="confirm-mark" width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
      <circle className="ripple" cx="40" cy="40" r="38" />
      <circle className="halo" cx="40" cy="40" r="40" />
      <circle className="disc" cx="40" cy="40" r="24" />
      <path className="tick" d="M31.95 39.68 L37.89 45.62 L50.64 32.87" pathLength={1} />
    </svg>
  );
}

/** „Już odhaczona” i „wejściówka aktywna” – informacja w panelu, bez okienka. */
function Result({ r, big }: { r: Entered; big: boolean }) {
  return (
    <div className="entry-result warn" role="status" aria-live="polite">
      <WhoLine who={r} big={big} />
      <b>{r.message}</b>
      {r.pass && <span className="small muted">{r.pass}</span>}
      {r.payAtDesk && <span className="small">Bez karnetu – rozlicz w kasie (karnet lub jednorazowe wejście).</span>}
    </div>
  );
}

type Participant = { booking_id: string; status: string; name: string; visits: number; guest_name: string | null };
type Session = { id: string; starts_at: string; class_name: string; trainer_name: string; zone_name: string; capacity: number; status: string; participants: Participant[] };

/** Ekran recepcji: wejście + najbliższe zajęcia (kto już jest, kto jeszcze nie weszła). */
export function Entrance() {
  const day = useApi<{ sessions: Session[] }>(`/staff/day?date=${localDate()}`);
  const [now, setNow] = useState(() => Date.now());
  const { run } = useAction();
  useEffect(() => {
    const t = window.setInterval(() => (setNow(Date.now()), day.reload()), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const upcoming = (day.data?.sessions ?? []).filter((s) => s.status !== 'cancelled' && Date.parse(s.starts_at) > now - 60 * 60_000 && Date.parse(s.starts_at) < now + 4 * 3_600_000);
  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div>
          <h1 style={{ marginBottom: 0 }}>Wejście</h1>
          <p className="muted" style={{ margin: 0 }}>
            Kod z aplikacji, QR wejściówki od znajomej albo numer telefonu – jedno pole, Enter.
          </p>
        </div>
        <div className="entry-clock" aria-label="Godzina">
          {fmtTime(new Date(now).toISOString())}
        </div>
      </div>
      <div className="entrance-grid">
        <CheckinPanel big onDone={day.reload} />
        <div className="stack">
          <div className="eyebrow" style={{ margin: 0 }}>
            Najbliższe zajęcia
          </div>
          {!day.data && <Spinner />}
          {day.data && upcoming.length === 0 && <p className="muted small">W najbliższych godzinach nie ma zajęć.</p>}
          {upcoming.map((s) => {
            const booked = s.participants.filter((p) => p.status === 'booked' || p.status === 'attended');
            const inside = booked.filter((p) => p.status === 'attended').length;
            const missing = booked.filter((p) => p.status === 'booked');
            return (
              <section key={s.id} className="card flat stack gap-2" style={{ padding: 18 }}>
                <div className="row between">
                  <b>
                    {fmtTime(s.starts_at)} · {s.class_name}
                  </b>
                  <span className={`badge ${inside === booked.length && booked.length > 0 ? 'ok' : ''}`}>
                    {inside} / {booked.length} na sali
                  </span>
                </div>
                <div className="tiny muted">
                  {s.zone_name} · {s.trainer_name} · {s.capacity - booked.length > 0 ? `${s.capacity - booked.length} wolne` : 'komplet'}
                </div>
                <div className="arrivals-bar" aria-hidden="true">
                  <span style={{ width: `${booked.length ? (inside / booked.length) * 100 : 0}%` }} />
                </div>
                {missing.map((p) => (
                  <div key={p.booking_id} className="row small gap-2">
                    <span className="grow">
                      {p.name} {p.visits === 0 && !p.guest_name && <span className="badge accent">pierwszy raz</span>}
                    </span>
                    <button className="btn sm ghost" onClick={() => run(() => api(`/staff/bookings/${p.booking_id}/checkin`, { method: 'POST' }).then(day.reload), `${p.name} – obecna ✓`)}>
                      Wpuść
                    </button>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
