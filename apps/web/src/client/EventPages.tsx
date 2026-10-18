// Zorganizuj wydarzenie (4.13): kreator – typ, liczba osób, trenerka, sala i zajęcia, termin z wolnych slotów,
// dodatki, podsumowanie (cena z cennika albo „do ustalenia”), regulamin; moje wydarzenia z ofertą, zaliczką,
// notatką dla trenerki, zmianą godziny, odwołaniem i zaproszeniami dla gości (link, QR, RSVP).
import { useState } from 'react';
import { api, fmtDay, fmtLongDay, fmtTime, localDate, useApi } from '../api.ts';
import { Avatar, Empty, Field, PAYMENT_LABELS, QrCode, Pending, Toggle, useAction, useToast } from '../ui.tsx';
import { useClient } from './ClientApp.tsx';
import type { RouteProps } from './router.tsx';

type Options = {
  kinds: { id: string; label: string }[];
  activities: string[];
  addons: { id: string; label: string }[];
  regulations: string;
  minNoticeDays: number;
  packages: { id: string; name: string; kinds: string[]; min_guests: number; max_guests: number; duration_min: number; price: string; deposit: string | null }[];
  trainers: { id: string; name: string; bio: string | null; avatar_url: string | null }[];
  zones: { id: string; name: string }[];
};

export default function EventPages({ route, arg, close }: RouteProps) {
  if (route === 'event-new') return <Wizard onDone={close} />;
  if (route === 'event' && arg) return <EventDetail id={arg} />;
  return <MyEvents />;
}

function MyEvents() {
  const { open } = useClient();
  const list = useApi<{ id: string; kindLabel: string; starts_at: string; statusLabel: string; guests: number }[]>('/my/events');
  if (!list.data) return <Pending error={list.error} reload={list.reload} />;
  return (
    <div className="stack">
      <button className="btn" onClick={() => open('event-new')}>
        Zorganizuj wydarzenie
      </button>
      {list.data.length === 0 && <Empty>Urodziny, babski wieczór, trening w prezencie – zorganizujemy to razem.</Empty>}
      {list.data.map((e) => (
        <button key={e.id} className="card flat row between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => open(`event/${e.id}`)}>
          <span>
            <b>{e.kindLabel}</b>
            <span className="small muted" style={{ display: 'block' }}>
              {fmtLongDay(e.starts_at)}, {fmtTime(e.starts_at)} · {e.guests} os.
            </span>
          </span>
          <span className="badge">{e.statusLabel}</span>
        </button>
      ))}
    </div>
  );
}

function Wizard({ onDone }: { onDone: () => void }) {
  const opts = useApi<Options>('/events/options');
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState('');
  const [pkg, setPkg] = useState<string | null>(null);
  const [guests, setGuests] = useState(6);
  const [trainer, setTrainer] = useState('');
  const [zone, setZone] = useState('');
  const [activity, setActivity] = useState('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [addons, setAddons] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [terms, setTerms] = useState(false);
  const { run, busy } = useAction();
  const p = opts.data?.packages.find((x) => x.id === pkg);
  const slots = useApi<{ startsAt: string; time: string }[]>(date && zone && trainer ? `/events/slots?date=${date}&zoneId=${zone}&trainerId=${trainer}&durationMin=${p?.duration_min ?? 90}` : null, [date, zone, trainer, pkg]);
  if (opts.error?.code === 'feature_off') return <Empty>Studio nie organizuje teraz wydarzeń.</Empty>;
  if (!opts.data) return <Pending error={opts.error} reload={opts.reload} />;
  const o = opts.data;
  // Kreator sam pilnuje poprawnych wartości – klientka nie dowiaduje się o błędzie dopiero w ostatnim kroku.
  const range = (id: string | null) => {
    const x = o.packages.find((q) => q.id === id);
    return { min: x?.min_guests ?? 2, max: x?.max_guests ?? 20 };
  };
  const clampGuests = (n: number, id = pkg) => Math.min(range(id).max, Math.max(range(id).min, Math.round(n) || range(id).min));
  const pickKind = (id: string) => {
    setKind(id);
    // Pakiet z innego rodzaju wydarzenia przestaje pasować – odznaczamy go.
    if (p && !p.kinds.includes(id)) setPkg(null);
  };
  const pickPackage = (id: string) => {
    const next = pkg === id ? null : id;
    setPkg(next);
    setGuests((g) => clampGuests(g, next));
    setSlot(''); // pakiet zmienia czas trwania, więc wolne godziny trzeba wybrać od nowa
  };
  const minDate = (() => {
    const d = new Date(Date.now() + o.minNoticeDays * 86_400_000);
    return localDate(d);
  })();
  const steps = [
    <div key="kind" className="stack">
      <h2>Co świętujemy?</h2>
      <div className="pill-row">
        {o.kinds.map((k) => (
          <button key={k.id} className="chip" aria-pressed={kind === k.id} onClick={() => pickKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      {o.packages.filter((x) => !kind || x.kinds.includes(kind)).length > 0 && (
        <>
          <div className="eyebrow">Pakiety studia</div>
          {o.packages
            .filter((x) => !kind || x.kinds.includes(kind))
            .map((x) => (
              <button key={x.id} className={`card ${pkg === x.id ? 'soft' : 'flat'}`} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => pickPackage(x.id)}>
                <div className="row between">
                  <b>{x.name}</b>
                  <b>{x.price}</b>
                </div>
                <div className="small muted">
                  {x.min_guests}–{x.max_guests} osób · {x.duration_min} min {x.deposit && `· zaliczka ${x.deposit}`}
                </div>
              </button>
            ))}
          <p className="tiny muted">Bez pakietu wyślesz zapytanie – studio przygotuje ofertę.</p>
        </>
      )}
    </div>,
    <div key="who" className="stack">
      <h2>Ile osób i z kim?</h2>
      <Field label={`Liczba osób${p ? ` (${p.min_guests}–${p.max_guests})` : ''}`}>
        <input className="input" type="number" min={p?.min_guests ?? 2} max={p?.max_guests ?? 20} value={guests} onChange={(e) => setGuests(Number(e.target.value))} onBlur={() => setGuests(clampGuests(guests))} />
      </Field>
      <div className="eyebrow">Trenerka</div>
      {o.trainers.map((t) => (
        <button key={t.id} className={`card ${trainer === t.id ? 'soft' : 'flat'} row`} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setTrainer(t.id)}>
          {t.avatar_url ? <img src={t.avatar_url} alt="" className="avatar sm" /> : <Avatar name={t.name} size="sm" />}
          <span>
            <b>{t.name}</b>
            {t.bio && <span className="small muted" style={{ display: 'block' }}>{t.bio}</span>}
          </span>
        </button>
      ))}
    </div>,
    <div key="where" className="stack">
      <h2>Sala i zajęcia</h2>
      <div className="pill-row">
        {o.zones.map((z) => (
          <button key={z.id} className="chip" aria-pressed={zone === z.id} onClick={() => (setZone(z.id), setSlot(''))}>
            {z.name}
          </button>
        ))}
      </div>
      <div className="pill-row">
        {o.activities.map((a) => (
          <button key={a} className="chip" aria-pressed={activity === a} onClick={() => setActivity(a)}>
            {a}
          </button>
        ))}
      </div>
      <Field label={`Dzień (min. ${o.minNoticeDays} dni wcześniej)`}>
        <input className="input" type="date" min={minDate} value={date} onChange={(e) => (setDate(e.target.value), setSlot(''))} />
      </Field>
      {date && zone && trainer && (
        <div className="pill-row">
          {!slots.data ? <Pending error={slots.error} reload={slots.reload} /> : slots.data.length === 0 ? <span className="small muted">Ten dzień jest zajęty – wybierz inny.</span> : null}
          {slots.data?.map((s) => (
            <button key={s.startsAt} className="chip" aria-pressed={slot === s.startsAt} onClick={() => setSlot(s.startsAt)}>
              {s.time}
            </button>
          ))}
        </div>
      )}
    </div>,
    <div key="extras" className="stack">
      <h2>Dodatki</h2>
      {o.addons.map((a) => (
        <Toggle key={a.id} label={a.label} checked={addons.includes(a.id)} onChange={(v) => setAddons(v ? [...addons, a.id] : addons.filter((x) => x !== a.id))} />
      ))}
      <Field label="Notatka dla trenerki" hint="Np. ulubiona muzyka, imię solenizantki.">
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </div>,
    <div key="sum" className="stack">
      <h2>Podsumowanie</h2>
      <div className="card soft stack" style={{ gap: 4 }}>
        <div>{o.kinds.find((k) => k.id === kind)?.label} · {guests} osób</div>
        <div className="small">
          {slot && `${fmtLongDay(slot)}, ${fmtTime(slot)}`} · {o.zones.find((z) => z.id === zone)?.name} · {activity}
        </div>
        <div className="small">prowadzi {o.trainers.find((t) => t.id === trainer)?.name}</div>
        <b>{p ? p.price : 'Cena do ustalenia – studio przyśle ofertę'}</b>
      </div>
      <details>
        <summary className="small">Regulamin wydarzenia</summary>
        <p className="small">{o.regulations}</p>
      </details>
      <Toggle label="Akceptuję regulamin wydarzenia" checked={terms} onChange={setTerms} />
    </div>,
  ];
  const can = [!!kind, !!trainer && guests === clampGuests(guests), !!zone && !!activity && !!slot, true, terms][step];
  return (
    <div className="stack-lg">
      {steps[step]}
      <div className="row between">
        <span className="tiny muted">
          krok {step + 1} z {steps.length}
        </span>
        <div className="row">
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              Wstecz
            </button>
          )}
          {step < steps.length - 1 ? (
            <button className="btn" disabled={!can} onClick={() => setStep(step + 1)}>
              Dalej
            </button>
          ) : (
            <button
              className="btn"
              disabled={!can || busy}
              onClick={() =>
                run(() =>
                  api<{ message: string }>('/events', { method: 'POST', body: { kind, packageId: pkg, trainerId: trainer, zoneId: zone, activity, startsAt: slot, guests, addons, note, termsAccepted: terms } }).then((r) => {
                    onDone();
                    return r;
                  }),
                )
              }
            >
              {p ? 'Rezerwuję' : 'Wyślij zapytanie'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type EventView = {
  id: string;
  kindLabel: string;
  activity: string;
  starts_at: string;
  ends_at: string;
  guests: number;
  status: string;
  statusLabel: string;
  price: string | null;
  deposit: string | null;
  payment_mode: string;
  offer_text: string | null;
  client_note: string | null;
  trainer: string | null;
  zone: string | null;
  history: { by: string; text: string; at: string }[];
  guestsList: { id: string; name: string; rsvp: string }[];
  inviteLink: string;
  canCancel: boolean;
};

function EventDetail({ id }: { id: string }) {
  const { data, error, reload } = useApi<EventView>(`/events/${id}`);
  const [method, setMethod] = useState('blik');
  const [note, setNote] = useState<string | null>(null);
  const { run, busy } = useAction();
  const toast = useToast();
  if (!data) return <Pending error={error} reload={reload} />;
  const act = (body: object, msg?: string) => run(() => api(`/events/${id}/client`, { method: 'POST', body }).then((r) => (reload(), r)), msg);
  const yes = data.guestsList.filter((g) => g.rsvp === 'yes').length;
  return (
    <div className="stack-lg">
      <div>
        <div className="eyebrow">{data.statusLabel}</div>
        <h1 style={{ fontSize: '1.8rem' }}>{data.kindLabel}</h1>
        <p className="muted">
          {fmtLongDay(data.starts_at)}, {fmtTime(data.starts_at)}–{fmtTime(data.ends_at)} · {data.zone} · {data.activity} · prowadzi {data.trainer}
        </p>
      </div>
      {data.offer_text && (
        <section className="card soft stack" style={{ gap: 6 }}>
          <div className="eyebrow">Oferta studia</div>
          <p style={{ margin: 0 }}>{data.offer_text}</p>
          {data.price && <b>{data.price}{data.deposit && data.payment_mode === 'deposit' ? ` · zaliczka ${data.deposit}` : ''}</b>}
        </section>
      )}
      {data.status === 'offer' && (
        <button className="btn" disabled={busy} onClick={() => act({ action: 'accept' })}>
          Akceptuję ofertę
        </button>
      )}
      {['offer', 'confirmed'].includes(data.status) && data.price && data.payment_mode !== 'private' && (
        <section className="stack">
          <div className="eyebrow">{data.payment_mode === 'deposit' ? 'Zaliczka online' : 'Płatność online (albo na miejscu)'}</div>
          <div className="pill-row">
            {['blik', 'apple_pay', 'p24', 'card'].map((m) => (
              <button key={m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
          <button className="btn ghost" disabled={busy} onClick={() => act({ action: 'pay', method })}>
            Zapłać {data.payment_mode === 'deposit' && data.deposit ? data.deposit : data.price}
          </button>
        </section>
      )}
      {['offer', 'confirmed', 'paid'].includes(data.status) && (
        <section className="stack center">
          <div className="eyebrow">Zaproszenie dla gości</div>
          <QrCode text={data.inviteLink} size={170} label="QR zaproszenia" />
          <button className="btn ghost" onClick={() => (navigator.share ? navigator.share({ url: data.inviteLink, text: 'Zapraszam Cię do studia 🎉' }).catch(() => {}) : navigator.clipboard.writeText(data.inviteLink).then(() => toast('Skopiowano link')))}>
            Udostępnij link
          </button>
          <div className="small">
            Potwierdzenia: {yes} / {data.guests}
          </div>
          {data.guestsList.map((g) => (
            <div key={g.id} className="row between small" style={{ width: '100%' }}>
              <span>{g.name}</span>
              <span className={`badge ${g.rsvp === 'yes' ? 'ok' : ''}`}>{g.rsvp === 'yes' ? 'będzie' : g.rsvp === 'no' ? 'nie będzie' : '?'}</span>
            </div>
          ))}
          <p className="tiny muted">Dane gości usuwamy po wydarzeniu. Zdjęcia publikujemy tylko za zgodą wszystkich osób na nich.</p>
        </section>
      )}
      <section className="stack">
        <Field label="Notatka dla trenerki">
          <textarea className="input" value={note ?? data.client_note ?? ''} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={note === null} onClick={() => act({ action: 'note', note }, 'Zapisane')}>
          Zapisz notatkę
        </button>
      </section>
      <section className="stack">
        <div className="eyebrow">Historia ustaleń</div>
        {data.history.map((h, i) => (
          <div key={i} className="small">
            <span className="muted">{fmtDay(h.at)}</span> · {h.by}: {h.text}
          </div>
        ))}
      </section>
      {data.canCancel && (
        <button className="btn danger" onClick={() => window.confirm('Odwołać wydarzenie?') && act({ action: 'cancel' })}>
          Odwołaj wydarzenie
        </button>
      )}
    </div>
  );
}
