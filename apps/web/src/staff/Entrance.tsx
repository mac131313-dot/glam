// Recepcja: przegląd dnia (Entrance) i skaner kodów w sekcji Wejściówki (Passes, CheckinPanel).
// Check-in (4.11, C3): jedno pole na czytnik kodów, telefon i kod wejściówki od znajomej – czytnik USB/Bluetooth
// „pisze” kod i Enter, więc pole trzyma fokus. Kamera skanuje bez przerwy. Wynik duży i z dźwiękiem; gdy trzeba
// zdecydować (brak rezerwacji, nieaktywna wejściówka) – jedno kliknięcie. Obok najbliższe zajęcia: kto jeszcze nie weszła.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { can, type Permission, type Role } from '@glam/core';
import { ApiError, api, fmtDay, fmtTime, localDate, useApi } from '../api.ts';
import { Avatar, Spinner, Stat } from '../ui.tsx';
import { Icon, type IconName } from '../icons.tsx';

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

/** Czytnik klatki: BarcodeDetector (Chrome, Android), a gdzie go nie ma (Safari na iPadzie, Firefox) – jsQR na kanwie. */
async function frameReader(): Promise<(v: HTMLVideoElement) => Promise<string | undefined>> {
  const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  if (Ctor) {
    const det = new Ctor({ formats: ['qr_code'] });
    return async (v) => (await det.detect(v).catch(() => []))[0]?.rawValue;
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (v) => {
    if (!v.videoWidth) return;
    // Wystarczy mniejsza klatka – kod z telefonu jest duży, a skanowanie szybsze.
    const scale = Math.min(1, 640 / v.videoWidth);
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    g.drawImage(v, 0, 0, canvas.width, canvas.height);
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || undefined;
  };
}

/** Kamera skanuje ciągle; ten sam kod przez kilka sekund liczy się raz. facing – „user” dla tabletu na stojaku przodem do klientek. */
function useQrCamera(enabled: boolean, paused: boolean, onCode: (code: string) => void, onUnsupported: () => void, facing: 'environment' | 'user' = 'environment') {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onCode);
  handler.current = onCode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    if (!enabled) return;
    if (!navigator.mediaDevices?.getUserMedia) return onUnsupported();
    let stream: MediaStream | null = null;
    let timer = 0;
    let alive = true;
    let last = { code: '', at: 0 };
    (async () => {
      const read = await frameReader();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
      if (!alive || !video.current) return stream.getTracks().forEach((t) => t.stop());
      video.current.srcObject = stream;
      await video.current.play();
      timer = window.setInterval(async () => {
        if (!video.current || pausedRef.current) return;
        const code = await read(video.current);
        if (!code || (code === last.code && Date.now() - last.at < 5000)) return;
        last = { code, at: Date.now() };
        handler.current(code);
      }, 300);
    })().catch(() => alive && onUnsupported());
    return () => {
      alive = false;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, facing]);
  return video;
}

type Arrival = { id: string; userId: string; name: string; at: string; what: string };

/** Check-in: czytnik / telefon / kod wejściówki, kamera, decyzje jednym kliknięciem; udane wejście – okienko, które samo znika. */
export function CheckinPanel({ onDone, big = false, scanner = false }: { onDone: () => void; big?: boolean; scanner?: boolean }) {
  const [value, setValue] = useState('');
  // Tryb skanera (zakładka Wejściówki): kamera włączona od razu, domyślnie przednia – tablet stoi przodem do klientek.
  const [camera, setCamera] = useState(scanner);
  const [facing, setFacing] = useState<'environment' | 'user'>(() => {
    try {
      return localStorage.getItem('glam:scan-facing') === 'environment' ? 'environment' : 'user';
    } catch {
      return 'user';
    }
  });
  const flip = () => {
    const next = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    try {
      localStorage.setItem('glam:scan-facing', next);
    } catch {}
  };
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [popup, setPopup] = useState<{ r: Entered; seq: number } | null>(null);
  const arrivals = useApi<Arrival[]>(big ? '/staff/arrivals' : null);
  const [busy, setBusy] = useState(false);
  const [guest, setGuest] = useState({ name: '', phone: '' });
  const field = useRef<HTMLInputElement>(null);
  // Na tablecie ze skanerem nie łapiemy fokusu – wysuwałaby się klawiatura i zasłaniała kamerę.
  const focus = () => big && !scanner && setTimeout(() => field.current?.focus(), 0);

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
  const video = useQrCamera(
    camera,
    busy || deciding,
    (code) => send(toInput(code)),
    () => {
      setCamera(false);
      setOutcome({ state: 'error', message: 'Nie udało się włączyć kamery. Zezwól przeglądarce na dostęp do kamery albo użyj czytnika i wpisz numer telefonu.' });
    },
    scanner ? facing : 'environment',
  );

  useEffect(() => {
    if (!big || scanner) return;
    // Czytnik „pisze” tam, gdzie jest fokus – po kliknięciu w puste miejsce wracamy do pola skanowania.
    const back = (e: FocusEvent) => !(e.relatedTarget instanceof HTMLInputElement) && !deciding && focus();
    const el = field.current;
    el?.addEventListener('blur', back);
    return () => el?.removeEventListener('blur', back);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big, scanner, deciding]);

  const submit = () => value.trim() && send(toInput(value.trim()));

  return (
    <section className={`card ${big ? '' : 'soft'} stack`} style={{ gap: 12 }}>
      {!big && <div className="eyebrow">Check-in</div>}
      {scanner && (
        <>
          <div className={`scanner ${camera ? 'on' : ''} ${busy || deciding ? 'held' : ''}`}>
            {camera ? (
              <video ref={video} className={`scanner-video ${facing === 'user' ? 'mirror' : ''}`} muted playsInline />
            ) : (
              <button className="scanner-start" onClick={() => (setOutcome(null), setCamera(true))}>
                <Icon name="qr" size={34} />
                <span>Włącz skaner</span>
              </button>
            )}
            {camera && (
              <>
                <div className="scanner-frame" aria-hidden="true">
                  <span />
                </div>
                <div className="scanner-status" role="status">
                  {busy ? 'Sprawdzam…' : deciding ? 'Wybierz poniżej' : 'Pokaż kod z aplikacji'}
                </div>
              </>
            )}
          </div>
          {camera && (
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn ghost sm" onClick={flip}>
                <Icon name="swap" size={16} /> {facing === 'user' ? 'Kamera tylna' : 'Kamera przednia'}
              </button>
              <button className="btn quiet sm" onClick={() => setCamera(false)}>
                Wyłącz kamerę
              </button>
            </div>
          )}
        </>
      )}
      <div className="row checkin-row">
        <input
          ref={field}
          className={`input ${big ? 'scan-input' : ''}`}
          placeholder="Zeskanuj kod, wpisz 6 liter albo telefon"
          aria-label="Kod z aplikacji, kod wejściówki albo numer telefonu"
          value={value}
          autoFocus={big && !scanner}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className={`btn ${big ? '' : 'sm'}`} disabled={!value.trim() || busy} onClick={submit}>
          Wpuść
        </button>
        {!scanner && (
          <button className={`btn ghost ${big ? '' : 'sm'}`} aria-pressed={camera} onClick={() => setCamera(!camera)}>
            {camera ? 'Wyłącz kamerę' : 'Kamera'}
          </button>
        )}
      </div>
      {camera && !scanner && <video ref={video} className="scan-video" muted playsInline />}

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

type Health = { limitations?: string; injuries?: string; pregnancy?: boolean } | null;
type Participant = { booking_id: string; status: string; user_id: string; name: string; visits: number; guest_name: string | null; health: Health };
type Session = { id: string; starts_at: string; class_name: string; trainer_name: string; zone_name: string; capacity: number; status: string; participants: Participant[] };
type PrivateEvent = { id: string; activity: string; starts_at: string; guests: number; status: string; client_name: string; client_note: string | null; trainer_name: string | null };
type Day = { sessions: Session[]; events: PrivateEvent[] };

const healthNote = (h: Health) => (h ? [h.pregnancy && 'ciąża', h.limitations, h.injuries].filter(Boolean).join(' · ') : '');
const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

/** Recepcja – przegląd dnia: liczby dnia, szybkie akcje, „do zrobienia” (czat, sklep, nagrody, kartki, prośby o termin),
 *  obecne dziś, kto dziś pierwszy raz / z uwagami zdrowotnymi i wydarzenia prywatne.
 *  Skaner kodów jest w osobnej sekcji Wejściówki. Każdy kafelek pobiera dane tylko, gdy rola ma do nich uprawnienie. */
export function Entrance({ roles, go }: { roles: Role[]; go: (place: string) => void }) {
  const has = (p: Permission) => can(roles, p);
  const day = useApi<Day>(`/staff/day?date=${localDate()}`);
  const arrivals = useApi<Arrival[]>('/staff/arrivals');
  const chats = useApi<{ unread: number }[]>(has('chat.answer') ? '/staff/chats' : null);
  const followups = useApi<unknown[]>(has('clients.contact') ? '/staff/followups' : null);
  const shop = useApi<{ orders: { status: string }[] }>(has('shop.manage') ? '/staff/shop' : null);
  const locker = useApi<{ status: string }[]>(has('cards.manage') || has('shop.manage') ? '/staff/locker' : null);
  const cards = useApi<{ status: string }[]>(has('cards.manage') ? '/staff/cards' : null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => (setNow(Date.now()), day.reload(), arrivals.reload(), chats.reload()), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessions = (day.data?.sessions ?? []).filter((s) => s.status !== 'cancelled');
  const taken = (s: Session) => s.participants.filter((p) => p.status === 'booked' || p.status === 'attended');
  const booked = sessions.reduce((n, s) => n + taken(s).length, 0);
  const capacity = sessions.reduce((n, s) => n + s.capacity, 0);
  const attended = sessions.reduce((n, s) => n + s.participants.filter((p) => p.status === 'attended').length, 0);
  const waiting = sessions.reduce((n, s) => n + s.participants.filter((p) => p.status === 'waitlist').length, 0);
  const next = sessions.find((s) => Date.parse(s.starts_at) > now);
  // Kogo warto dziś zauważyć: pierwsza wizyta albo uwagi zdrowotne (za zgodą klientki).
  const notice = sessions.flatMap((s) =>
    taken(s)
      .filter((p) => (p.visits === 0 && !p.guest_name) || healthNote(p.health))
      .map((p) => ({ ...p, when: `${fmtTime(s.starts_at)} · ${s.class_name}` })),
  );

  const todo: { key: string; label: string; n: number; to: string }[] = [
    { key: 'chats', label: 'Nieprzeczytane wiadomości od klientek', n: (chats.data ?? []).reduce((n, c) => n + (c.unread ? 1 : 0), 0), to: 'messages' },
    { key: 'followups', label: 'Klientki proszą o propozycję terminu', n: followups.data?.length ?? 0, to: 'messages' },
    { key: 'orders', label: 'Zamówienia ze sklepu do przygotowania i wydania', n: (shop.data?.orders ?? []).filter((o) => ['reserved', 'paid', 'ready'].includes(o.status)).length, to: 'shop' },
    { key: 'locker', label: 'Nagrody do przygotowania lub wydania', n: (locker.data ?? []).filter((l) => l.status !== 'shipped').length, to: 'gifts' },
    { key: 'cards', label: 'Kartki od trenerek do wysłania lub wydania', n: (cards.data ?? []).filter((c) => c.status === 'written').length, to: 'gifts' },
    { key: 'waitlist', label: 'Osoby na liście rezerwowej dziś', n: waiting, to: 'schedule/plan' },
  ];
  const open = todo.filter((t) => t.n > 0);
  const actions: { label: string; to: string; icon: IconName; perm: Permission }[] = [
    { label: 'Sprzedaj karnet', to: 'reception/desk', icon: 'card', perm: 'desk.sell' },
    { label: 'Skaner wejściówek', to: 'passes', icon: 'qr', perm: 'participants.manage' },
    { label: 'Dodaj klientkę', to: 'clients', icon: 'people', perm: 'clients.create' },
    { label: 'Wiadomość do grupy', to: 'messages', icon: 'chat', perm: 'messages.group.all' },
    { label: 'Grafik', to: 'schedule', icon: 'calendar', perm: 'schedule.view' },
  ];

  if (!day.data) return <Spinner />;
  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div>
          <h1 style={{ marginBottom: 0 }}>Dzień w recepcji</h1>
          <p className="muted" style={{ margin: 0 }}>
            {fmtDay(new Date(now).toISOString())} · {next ? `najbliższe zajęcia ${fmtTime(next.starts_at)} · ${next.class_name}` : sessions.length ? 'na dziś nie ma już zajęć' : 'dziś bez zajęć w grafiku'}
          </p>
        </div>
        <div className="entry-clock" aria-label="Godzina">
          {fmtTime(new Date(now).toISOString())}
        </div>
      </div>

      <div className="kpis">
        <Stat label="Zajęcia dziś" value={sessions.length} hint={next ? `kolejne o ${fmtTime(next.starts_at)}` : sessions.length ? 'wszystkie za nami' : 'dziś bez zajęć'} />
        <Stat label="Zapisane" value={<>{booked}<span className="muted" style={{ fontSize: '1rem' }}> / {capacity}</span></>} hint={`wolne miejsca: ${Math.max(0, capacity - booked)}`} />
        <Stat label="Obecne" value={arrivals.data?.length ?? attended} hint={`na zajęciach: ${attended}`} />
        <Stat label="Pierwszy raz" value={notice.filter((p) => p.visits === 0 && !p.guest_name).length} hint="przywitaj i pokaż szatnię" />
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        {actions
          .filter((a) => has(a.perm))
          .map((a) => (
            <button key={a.to} className="btn ghost sm" onClick={() => go(a.to)}>
              <Icon name={a.icon} size={16} /> {a.label}
            </button>
          ))}
      </div>

      <div className="grid-2 dash-grid">
        <section className="card stack" style={{ gap: 8 }}>
          <h3>Do zrobienia</h3>
          {open.length === 0 && <p className="small muted" style={{ margin: 0 }}>Wszystko ogarnięte.</p>}
          <div>
            {open.map((t) => (
              <button key={t.key} className="todo-row" onClick={() => go(t.to)}>
                <span className="grow">{t.label}</span>
                <span className="badge">{t.n}</span>
                <Chevron />
              </button>
            ))}
          </div>
        </section>

        <section className="card stack" style={{ gap: 2 }}>
          <h3 style={{ marginBottom: 8 }}>Obecne dziś · {arrivals.data?.length ?? 0}</h3>
          {arrivals.data?.length === 0 && <p className="muted small" style={{ margin: 0 }}>Jeszcze nikt nie weszła.</p>}
          {(arrivals.data ?? []).slice(0, 12).map((a) => (
            <div key={a.id} className="row small arrival">
              <span className="muted tiny" style={{ width: 40 }}>
                {fmtTime(a.at)}
              </span>
              <Avatar name={a.name} size="sm" />
              <span className="grow">{a.name}</span>
              <span className="muted tiny">{a.what}</span>
            </div>
          ))}
        </section>

        <section className="card stack" style={{ gap: 8 }}>
          <h3>Warto zauważyć</h3>
          {notice.length === 0 && <p className="small muted" style={{ margin: 0 }}>Dziś bez nowych osób i uwag zdrowotnych.</p>}
          {notice.map((p) => (
            <div key={p.booking_id} className="row small" style={{ gap: 10, alignItems: 'flex-start' }}>
              <Avatar name={p.name} size="sm" />
              <div className="grow">
                <div className="row wrap" style={{ gap: 6 }}>
                  <b>{p.name}</b>
                  {p.visits === 0 && !p.guest_name && <span className="badge accent">pierwszy raz</span>}
                  {p.status === 'attended' && <span className="badge ok">jest</span>}
                </div>
                <div className="tiny muted">{p.when}</div>
                {healthNote(p.health) && (
                  <div className="tiny" style={{ color: 'var(--brand-strong)' }}>
                    ⚑ {healthNote(p.health)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>

        {day.data.events.length > 0 && (
          <section className="card stack" style={{ gridColumn: '1 / -1', gap: 8 }}>
            <h3>Wydarzenia prywatne dziś</h3>
            {day.data.events.map((e) => (
              <button key={e.id} className="todo-row" onClick={() => go('events')}>
                <span className="grow">
                  <b>{fmtTime(e.starts_at)}</b> · {e.activity} · {e.client_name}
                  <span className="muted">
                    {' '}
                    · {e.guests} os.{e.trainer_name ? ` · ${e.trainer_name}` : ''}
                  </span>
                </span>
                {e.status === 'offer' && <span className="badge">oferta</span>}
                <Chevron />
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

/** Wejściówki (Codziennie): skaner kodów QR z aplikacji klientek. Kamera od razu włączona, wynik i lista obecnych obok. */
export function Passes() {
  return (
    <div className="stack-lg">
      <div>
        <h1 style={{ marginBottom: 0 }}>Wejściówki</h1>
        <p className="muted" style={{ margin: 0 }}>
          Klientka pokazuje kod z aplikacji (Start → ikona karty) – skaner sam zapisze ją na zajęcia.
        </p>
      </div>
      <div className="scanner-page">
        <CheckinPanel big scanner onDone={() => {}} />
      </div>
    </div>
  );
}
