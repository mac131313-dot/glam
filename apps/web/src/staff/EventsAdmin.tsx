// Wydarzenia w panelu (4.13.4, W1–W6): lista i kalendarz, oferta i cena, zaliczka / płatność na miejscu /
// ustalenia prywatne, statusy, notatka wewnętrzna (niewidoczna dla klientki), historia ustaleń; cennik pakietów.
import { useState } from 'react';
import { can, EVENT_ADDONS, EVENT_KINDS, type Role } from '@glam/core';
import { api, fmtDay, fmtLongDay, fmtTime, useApi } from '../api.ts';
import { Empty, Field, Page, Spinner, Tabs, useAction } from '../ui.tsx';

type Ev = {
  id: string;
  kindLabel: string;
  client: string | null;
  trainer: string | null;
  zone: string | null;
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
  internal_note?: string | null;
  addons: string[];
  history: { by: string; text: string; at: string }[];
  guestsList: { name: string; rsvp: string }[];
};

export default function EventsAdmin({ roles }: { roles: Role[] }) {
  const manage = can(roles, 'events.manage');
  const [tab, setTab] = useState<'list' | 'packages'>('list');
  const list = useApi<Ev[]>('/staff/events');
  const [open, setOpen] = useState<Ev | null>(null);
  return (
    <div className="stack-lg">
      <h1>Wydarzenia</h1>
      {manage && <Tabs label="Wydarzenia" value={tab} onChange={setTab} options={[['list', 'Wydarzenia'], ['packages', 'Cennik pakietów']]} />}
      {tab === 'list' &&
        (!list.data ? (
          <Spinner />
        ) : list.data.length === 0 ? (
          <Empty>Brak wydarzeń.</Empty>
        ) : (
          list.data.map((e) => (
            <button key={e.id} className="card flat row between" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(e)}>
              <span>
                <b>
                  {e.kindLabel} · {e.client}
                </b>
                <span className="small muted" style={{ display: 'block' }}>
                  {fmtLongDay(e.starts_at)} {fmtTime(e.starts_at)} · {e.guests} os. · {e.activity} · {e.trainer}
                </span>
              </span>
              <span className={`badge ${e.status === 'inquiry' ? 'warn' : ''}`}>{e.statusLabel}</span>
            </button>
          ))
        ))}
      {tab === 'packages' && <Packages />}
      {open && (
        <Page title={`${open.kindLabel} · ${open.client}`} onBack={() => setOpen(null)}>
          <EventEditor ev={open} manage={manage} onDone={() => (list.reload(), setOpen(null))} />
        </Page>
      )}
    </div>
  );
}

function EventEditor({ ev, manage, onDone }: { ev: Ev; manage: boolean; onDone: () => void }) {
  const [offer, setOffer] = useState(ev.offer_text ?? '');
  const [price, setPrice] = useState(ev.price ? ev.price.replace(/[^\d,]/g, '').replace(',', '.') : '');
  const [deposit, setDeposit] = useState(ev.deposit ? ev.deposit.replace(/[^\d,]/g, '').replace(',', '.') : '');
  const [mode, setMode] = useState(ev.payment_mode);
  const [note, setNote] = useState(ev.internal_note ?? '');
  const { run, busy } = useAction();
  const save = (extra: Record<string, unknown> = {}) =>
    run(
      () =>
        api(`/staff/events/${ev.id}`, {
          method: 'POST',
          body: { offer: offer !== (ev.offer_text ?? '') ? offer : undefined, price: price ? Math.round(Number(price) * 100) : undefined, deposit: deposit ? Math.round(Number(deposit) * 100) : null, paymentMode: mode, internalNote: note !== (ev.internal_note ?? '') ? note : undefined, ...extra },
        }).then(onDone),
      'Zapisane',
    );
  return (
    <div className="stack-lg">
      <section className="stack" style={{ gap: 4 }}>
        <div>
          {fmtLongDay(ev.starts_at)}, {fmtTime(ev.starts_at)}–{fmtTime(ev.ends_at)} · {ev.zone} · {ev.activity}
        </div>
        <div className="small">
          {ev.guests} osób · prowadzi {ev.trainer} · dodatki: {ev.addons.map((a) => EVENT_ADDONS.find((x) => x.id === a)?.label ?? a).join(', ') || 'brak'}
        </div>
        {ev.client_note && <div className="small">Notatka klientki: {ev.client_note}</div>}
        <div className="small">
          Goście: {ev.guestsList.filter((g) => g.rsvp === 'yes').length} potwierdzonych z {ev.guests}
        </div>
      </section>
      {manage && (
        <>
          <Field label="Oferta dla klientki">
            <textarea className="input" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Np. 90 min Reformer + herbata, dekoracje w cenie" />
          </Field>
          <div className="row">
            <Field label="Cena (zł)">
              <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Zaliczka (zł)">
              <input className="input" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </Field>
          </div>
          <div className="chips">
            {[
              ['deposit', 'Zaliczka online'],
              ['on_site', 'Płatność na miejscu'],
              ['private', 'Ustalenia prywatne poza aplikacją'],
            ].map(([v, l]) => (
              <button key={v} className="chip" aria-pressed={mode === v} onClick={() => setMode(v)}>
                {l}
              </button>
            ))}
          </div>
          <Field label="Notatka wewnętrzna (niewidoczna dla klientki)">
            <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="row wrap">
            <button className="btn" disabled={busy} onClick={() => save()}>
              Zapisz {offer && ev.status === 'inquiry' ? 'i wyślij ofertę' : ''}
            </button>
            {ev.status === 'offer' && (
              <button className="btn ghost" onClick={() => save({ status: 'confirmed' })}>
                Potwierdź (blokuje salę)
              </button>
            )}
            {['confirmed', 'offer'].includes(ev.status) && (
              <button className="btn ghost" onClick={() => save({ status: 'paid' })}>
                Opłacone na miejscu
              </button>
            )}
            {!['done', 'cancelled'].includes(ev.status) && (
              <button className="btn danger" onClick={() => window.confirm('Odwołać wydarzenie?') && save({ status: 'cancelled' })}>
                Odwołaj
              </button>
            )}
          </div>
        </>
      )}
      <section className="stack" style={{ gap: 4 }}>
        <div className="eyebrow">Historia ustaleń</div>
        {ev.history.map((h, i) => (
          <div key={i} className="small">
            <span className="muted">{fmtDay(h.at)}</span> · {h.by}: {h.text}
          </div>
        ))}
      </section>
    </div>
  );
}

function Packages() {
  const list = useApi<{ id: string; name: string; kinds: string[]; min_guests: number; max_guests: number; duration_min: number; price_grosze: number | null; deposit_grosze: number | null; active: number }[]>('/staff/event-packages');
  const [f, setF] = useState({ name: '', kinds: ['birthday'], minGuests: 4, maxGuests: 10, durationMin: 90, price: '', deposit: '' });
  const { run, busy } = useAction();
  return (
    <div className="stack-lg">
      {list.data?.map((p) => (
        <div key={p.id} className="card flat row between" style={{ opacity: p.active ? 1 : 0.5 }}>
          <span>
            <b>{p.name}</b>
            <span className="small muted" style={{ display: 'block' }}>
              {p.kinds.map((k) => EVENT_KINDS.find((x) => x.id === k)?.label).join(', ')} · {p.min_guests}–{p.max_guests} os. · {p.duration_min} min · {p.price_grosze ? `${p.price_grosze / 100} zł` : 'cena do ustalenia'}
              {p.deposit_grosze ? ` · zaliczka ${p.deposit_grosze / 100} zł` : ''}
            </span>
          </span>
          <button className="btn ghost sm" onClick={() => run(() => api(`/staff/event-packages/${p.id}`, { method: 'PATCH', body: { active: !p.active } }).then(list.reload))}>
            {p.active ? 'Ukryj' : 'Pokaż'}
          </button>
        </div>
      ))}
      <section className="card stack">
        <div className="eyebrow">Nowy pakiet</div>
        <input className="input" placeholder="Np. Urodziny do 10 osób" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="pill-row">
          {EVENT_KINDS.map((k) => (
            <button key={k.id} className="chip" aria-pressed={f.kinds.includes(k.id)} onClick={() => setF({ ...f, kinds: f.kinds.includes(k.id) ? f.kinds.filter((x) => x !== k.id) : [...f.kinds, k.id] })}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="row">
          <input className="input" type="number" value={f.minGuests} onChange={(e) => setF({ ...f, minGuests: Number(e.target.value) })} aria-label="Min osób" />
          <input className="input" type="number" value={f.maxGuests} onChange={(e) => setF({ ...f, maxGuests: Number(e.target.value) })} aria-label="Max osób" />
          <input className="input" type="number" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} aria-label="Minuty" />
        </div>
        <div className="row">
          <input className="input" placeholder="Cena zł (puste = do ustalenia)" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <input className="input" placeholder="Zaliczka zł" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} />
        </div>
        <button
          className="btn"
          disabled={!f.name || busy}
          onClick={() => run(() => api('/staff/event-packages', { method: 'POST', body: { ...f, priceGrosze: f.price ? Math.round(Number(f.price) * 100) : null, depositGrosze: f.deposit ? Math.round(Number(f.deposit) * 100) : null } }).then(list.reload), 'Pakiet dodany')}
        >
          Dodaj pakiet
        </button>
      </section>
    </div>
  );
}
