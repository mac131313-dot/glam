// Klientki (3, 4.11): lista z segmentami (aktywne, uśpione 7/14/30, nowe, ambasadorki, ryzyko odejścia) i karta
// klientki: karnety, historia z ocenami, notatnik postępów (#32, prywatny), plan indywidualny (#38), ankieta zdrowia
// i udostępnione pomiary / zdjęcia (za zgodą), dziennik zmian, NPS i ankiety; przypisanie trenerki, sprzedaż karnetu.
import { useState } from 'react';
import { can, SEGMENT_LABEL, type Role } from '@glam/core';
import { api, fmtDay, fmtTime, useApi } from '../api.ts';
import { AuthImg, Avatar, Empty, Field, Page, PAYMENT_LABELS, Select, Spinner, Tabs, useAction } from '../ui.tsx';

type Row = { id: string; name: string | null; phone?: string; goal: string | null; lastVisit: string | null; visits: number; hasActivePass: boolean; segments: string[]; groups: string[] };

export default function Clients({ roles }: { roles: Role[] }) {
  const [q, setQ] = useState('');
  const [segment, setSegment] = useState('');
  const list = useApi<Row[]>(`/staff/clients?q=${encodeURIComponent(q)}&segment=${segment}`, [q, segment]);
  const risk = useApi<{ clients: { id: string; risk: number; revenue: string }[] }>(can(roles, 'finance.view') ? '/owner/clients' : null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const riskOf = (id: string) => risk.data?.clients.find((c) => c.id === id);
  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <h1 style={{ margin: 0 }}>Klientki</h1>
        <div className="row">
          {can(roles, 'finance.export') && (
            <a className="btn ghost sm" href="/api/owner/export/clients.csv" onClick={(e) => (e.preventDefault(), download('/owner/export/clients.csv', 'klientki.csv'))}>
              Eksport do Excela
            </a>
          )}
          {can(roles, 'clients.create') && (
            <button className="btn sm" onClick={() => setAdding(true)}>
              Dodaj klientkę
            </button>
          )}
        </div>
      </div>
      <input className="input" placeholder="Szukaj po imieniu lub telefonie" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className="chip" aria-pressed={!segment} onClick={() => setSegment('')}>
          Wszystkie
        </button>
        {Object.entries(SEGMENT_LABEL).map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={segment === k} onClick={() => setSegment(segment === k ? '' : k)}>
            {l}
          </button>
        ))}
      </div>
      {!list.data ? (
        <Spinner />
      ) : list.data.length === 0 ? (
        <Empty>Brak klientek w tym widoku.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Imię</th>
              <th>Ostatnia wizyta</th>
              <th>Wizyty</th>
              <th>Segment</th>
              {risk.data && <th>Ryzyko</th>}
            </tr>
          </thead>
          <tbody>
            {list.data.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(c.id)}>
                <td>
                  <b>{c.name ?? '—'}</b>
                  <div className="tiny muted">{c.phone ?? c.goal ?? ''}</div>
                </td>
                <td className="muted">{c.lastVisit ? fmtDay(c.lastVisit) : '—'}</td>
                <td>{c.visits}</td>
                <td>
                  <div className="pill-row" style={{ gap: 4 }}>
                    {c.segments.map((s) => (
                      <span key={s} className={`badge ${s === 'churn_risk' ? 'warn' : s === 'ambassador' ? 'accent' : ''}`}>
                        {SEGMENT_LABEL[s as keyof typeof SEGMENT_LABEL] ?? s}
                      </span>
                    ))}
                  </div>
                </td>
                {risk.data && <td>{riskOf(c.id)?.risk ?? '–'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <Page title="Karta klientki" onBack={() => setOpen(null)}>
          <ClientCard id={open} roles={roles} />
        </Page>
      )}
      {adding && (
        <Page title="Nowa klientka" onBack={() => setAdding(false)}>
          <NewClient roles={roles} onDone={(newId) => (setAdding(false), list.reload(), setOpen(newId))} />
        </Page>
      )}
    </div>
  );
}

function NewClient({ roles, onDone }: { roles: Role[]; onDone: (id: string) => void }) {
  const [f, setF] = useState({ name: '', phone: '', goal: '', note: '' });
  const { run, busy } = useAction();
  const trainer = !can(roles, 'clients.view');
  return (
    <div className="stack-lg">
      <p className="small muted" style={{ margin: 0 }}>
        {trainer
          ? 'Klientka zostanie przypisana do Ciebie. Do aplikacji zaloguje się tym numerem telefonu.'
          : 'Do aplikacji klientka zaloguje się tym numerem telefonu.'}
      </p>
      <Field label="Imię">
        <input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Np. Karolina" />
      </Field>
      <Field label="Telefon">
        <input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Np. 600 100 200" />
      </Field>
      <Field label="Cel (opcjonalnie)">
        <input className="input" value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="Np. Mocniejsze plecy i lepsza postawa" />
      </Field>
      {can(roles, 'notes.write') && (
        <Field label="Notatka (opcjonalnie)" hint="Trafi do Twojego notatnika postępów – klientka jej nie widzi.">
          <textarea className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Np. Po kontuzji kolana, zaczynamy spokojnie" />
        </Field>
      )}
      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        disabled={f.name.trim().length < 2 || !f.phone.trim() || busy}
        onClick={() => run(() => api<{ id: string }>('/staff/clients', { method: 'POST', body: f }).then((r) => (onDone(r.id), r)), 'Klientka dodana')}
      >
        Dodaj klientkę
      </button>
    </div>
  );
}

export async function download(path: string, name: string) {
  const { session } = await import('../api.ts');
  const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${session.token}`, 'x-studio-id': session.studioId ?? '' } });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

type Card = {
  id: string;
  name: string | null;
  phone?: string;
  email?: string;
  joinedAt: string;
  goal: string | null;
  trainerId: string | null;
  segments: string[];
  passes?: { id: string; productName: string; status: string; summary: string }[];
  bookings: { id: string; status: string; rating: number | null; rating_comment: string | null; starts_at: string; class_name: string; trainer_name: string }[];
  notes: { id: string; body: string; created_at: string; trainer_name: string; trainer_id: string }[];
  health: { goals?: string; limitations?: string; injuries?: string; pregnancy?: boolean; postpartum?: boolean } | null;
  measurements: { date: string; weight?: number; waist?: number; wellbeing?: number; note?: string }[];
  photos: { id: string; taken_on: string; url: string }[];
  plan: { title: string; items_json: string; updated_at: string } | null;
  log: { action: string; details_json: string | null; created_at: string; actor: string | null }[];
  nps: { score: number; comment: string | null; trigger: string }[];
  surveys: { reasons_json: string | null; comment: string | null; status: string }[];
};

const ACTION: Record<string, string> = {
  'pass.sold_at_desk': 'Karnet sprzedany w recepcji',
  'booking.added_by_staff': 'Dodana do zajęć przez recepcję',
  'booking.removed_by_staff': 'Wypisana z zajęć przez recepcję',
  'client.trainer_assigned': 'Przypisana trenerka',
  'client.registered_at_desk': 'Rejestracja w recepcji',
  'client.added_by_trainer': 'Dodana przez trenerkę',
  'payment_link.sent': 'Wysłany link do płatności',
  'locker.ready': 'Nagroda gotowa do odbioru',
  'locker.collected': 'Nagroda odebrana',
  'event.updated': 'Zmiana w wydarzeniu',
};

function ClientCard({ id, roles }: { id: string; roles: Role[] }) {
  const { data, reload } = useApi<Card>(`/staff/clients/${id}`);
  const cfg = useApi<{ trainers: { id: string; name: string }[] }>('/owner/config');
  const products = useApi<{ id: string; name: string; price: string }[]>(can(roles, 'desk.sell') ? '/products' : null);
  const [tab, setTab] = useState<'overview' | 'notes' | 'health' | 'log'>('overview');
  const [note, setNote] = useState('');
  const [plan, setPlan] = useState<{ title: string; items: { day: string; text: string }[] } | null>(null);
  const [sell, setSell] = useState({ productId: '', method: 'terminal' });
  const { run, busy } = useAction();
  if (!data) return <Spinner />;
  const currentPlan = plan ?? (data.plan ? { title: data.plan.title, items: JSON.parse(data.plan.items_json) as { day: string; text: string }[] } : { title: '', items: [{ day: '', text: '' }] });
  return (
    <div className="stack-lg">
      <div className="row">
        <Avatar name={data.name} />
        <div>
          <h2 style={{ margin: 0 }}>{data.name}</h2>
          <div className="small muted">
            {data.phone} {data.email && `· ${data.email}`} · z nami od {fmtDay(data.joinedAt)}
          </div>
          {data.goal && <div className="small">Cel: {data.goal}</div>}
        </div>
      </div>
      <Tabs
        label="Karta klientki"
        value={tab}
        onChange={setTab}
        options={[
          ['overview', 'Przegląd'],
          ...(can(roles, 'notes.write') || can(roles, 'notes.read') ? ([['notes', 'Notatki i plan']] as ['notes', string][]) : []),
          ...(data.health || data.measurements.length || data.photos.length ? ([['health', 'Zdrowie']] as ['health', string][]) : []),
          ...(can(roles, 'clients.view') ? ([['log', 'Dziennik zmian']] as ['log', string][]) : []),
        ]}
      />
      {tab === 'overview' && (
        <>
          {data.passes && (
            <section className="stack" style={{ gap: 6 }}>
              <div className="eyebrow">Karnety</div>
              {data.passes.length === 0 && <span className="small muted">Brak karnetów.</span>}
              {data.passes.map((p) => (
                <div key={p.id} className="small">
                  <b>{p.productName}</b> · {p.summary} <span className="badge">{p.status}</span>
                </div>
              ))}
            </section>
          )}
          {can(roles, 'desk.sell') && products.data && (
            <section className="card flat stack">
              <div className="eyebrow">Sprzedaj karnet</div>
              <Select
                ariaLabel="Produkt"
                value={sell.productId}
                onChange={(v) => setSell({ ...sell, productId: v })}
                options={[{ value: '', label: 'Wybierz produkt' }, ...products.data.map((p) => ({ value: p.id, label: `${p.name} · ${p.price}` }))]}
              />
              <div className="chips">
                {['terminal', 'cash', 'link'].map((m) => (
                  <button key={m} className="chip" aria-pressed={sell.method === m} onClick={() => setSell({ ...sell, method: m })}>
                    {m === 'link' ? 'Link do płatności (SMS)' : PAYMENT_LABELS[m]}
                  </button>
                ))}
              </div>
              <button className="btn sm" disabled={!sell.productId || busy} onClick={() => run(() => api(`/staff/clients/${id}/passes`, { method: 'POST', body: sell }).then((r) => (reload(), r)))}>
                Sprzedaj
              </button>
              <p className="tiny muted" style={{ margin: 0 }}>Aplikacja zapisuje sprzedaż do raportu – paragon wystawia studio.</p>
            </section>
          )}
          {can(roles, 'participants.manage') && cfg.data && (
            <Field label="Trenerka prowadząca (powitanie, kartka)">
              <Select
                value={data.trainerId ?? ''}
                onChange={(v) => run(() => api(`/staff/clients/${id}/trainer`, { method: 'PUT', body: { trainerId: v } }).then(reload), 'Zapisane')}
                options={[{ value: '', label: '—' }, ...cfg.data.trainers.map((t) => ({ value: t.id, label: t.name }))]}
              />
            </Field>
          )}
          <section className="stack" style={{ gap: 4 }}>
            <div className="eyebrow">Ostatnie zajęcia</div>
            {data.bookings.map((b) => (
              <div key={b.id} className="row between small">
                <span>
                  {fmtDay(b.starts_at)} {fmtTime(b.starts_at)} · {b.class_name} · {b.trainer_name}
                </span>
                <span className="muted">
                  {b.status}
                  {b.rating && ` · ${'★'.repeat(b.rating)}`}
                </span>
              </div>
            ))}
          </section>
          {(data.nps.length > 0 || data.surveys.length > 0) && (
            <section className="stack" style={{ gap: 4 }}>
              <div className="eyebrow">Opinie</div>
              {data.nps.map((n, i) => (
                <div key={i} className="small">
                  NPS {n.score}/10 {n.comment && `– „${n.comment}”`}
                </div>
              ))}
              {data.surveys.map((s, i) => (
                <div key={i} className="small">
                  Ankieta „Co się stało?”: {s.reasons_json ? (JSON.parse(s.reasons_json) as string[]).join(', ') : 'bez odpowiedzi'} {s.comment && `– „${s.comment}”`} ({s.status})
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {tab === 'notes' && (
        <>
          <section className="stack">
            <div className="eyebrow">Notatnik postępów (prywatny)</div>
            {data.notes.map((n) => (
              <div key={n.id} className="card flat small">
                <div className="tiny muted">
                  {n.trainer_name} · {fmtDay(n.created_at)}
                </div>
                {n.body}
              </div>
            ))}
            {can(roles, 'notes.write') && (
              <>
                <textarea className="input" placeholder="Co dziś zauważyłaś? Postępy, ustawienia sprężyn, uwagi…" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!note.trim()} onClick={() => run(() => api(`/staff/clients/${id}/notes`, { method: 'POST', body: { body: note } }).then(() => (setNote(''), reload())), 'Zapisane')}>
                  Zapisz notatkę
                </button>
              </>
            )}
          </section>
          {can(roles, 'notes.write') && (
            <section className="stack">
              <div className="eyebrow">Plan indywidualny</div>
              <input className="input" placeholder="Tytuł planu" value={currentPlan.title} onChange={(e) => setPlan({ ...currentPlan, title: e.target.value })} />
              {currentPlan.items.map((it, i) => (
                <div key={i} className="row">
                  <input className="input" style={{ maxWidth: 160 }} placeholder="Kiedy" value={it.day} onChange={(e) => setPlan({ ...currentPlan, items: currentPlan.items.map((x, k) => (k === i ? { ...x, day: e.target.value } : x)) })} />
                  <input className="input" placeholder="Co" value={it.text} onChange={(e) => setPlan({ ...currentPlan, items: currentPlan.items.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })} />
                </div>
              ))}
              <div className="row">
                <button className="btn ghost sm" onClick={() => setPlan({ ...currentPlan, items: [...currentPlan.items, { day: '', text: '' }] })}>
                  + Punkt
                </button>
                <button className="btn sm" onClick={() => run(() => api(`/staff/clients/${id}/plan`, { method: 'PUT', body: currentPlan }).then(reload), 'Plan wysłany klientce')}>
                  Zapisz i wyślij
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {tab === 'health' && (
        <>
          {data.health ? (
            <section className="card soft stack" style={{ gap: 4 }}>
              <div className="eyebrow">Ankieta startowa (za zgodą klientki)</div>
              {data.health.goals && <div className="small">Cele: {data.health.goals}</div>}
              {data.health.limitations && <div className="small">Ograniczenia: {data.health.limitations}</div>}
              {data.health.injuries && <div className="small">Kontuzje: {data.health.injuries}</div>}
              {data.health.pregnancy && <div className="small">W ciąży</div>}
              {data.health.postpartum && <div className="small">Po porodzie</div>}
            </section>
          ) : (
            <p className="small muted">Klientka nie udostępniła ankiety zdrowia.</p>
          )}
          {data.measurements.length > 0 && (
            <section className="stack" style={{ gap: 4 }}>
              <div className="eyebrow">Pomiary udostępnione przez klientkę</div>
              {data.measurements.map((m, i) => (
                <div key={i} className="small">
                  {m.date}: {[m.weight && `${m.weight} kg`, m.waist && `talia ${m.waist}`, m.wellbeing && `samopoczucie ${m.wellbeing}/5`, m.note].filter(Boolean).join(' · ')}
                </div>
              ))}
            </section>
          )}
          {data.photos.length > 0 && (
            <div className="grid-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {data.photos.map((p) => (
                <AuthImg key={p.id} src={p.url} alt={p.taken_on} style={{ width: '100%', borderRadius: 12 }} />
              ))}
            </div>
          )}
          <p className="tiny muted">Bez oceniania wyglądu. Dane szczególne – nie przekazuj ich dalej.</p>
        </>
      )}
      {tab === 'log' && (
        <section className="stack" style={{ gap: 4 }}>
          {data.log.length === 0 && <span className="small muted">Brak zmian.</span>}
          {data.log.map((l, i) => (
            <div key={i} className="small row between">
              <span>
                {ACTION[l.action] ?? l.action}
                {l.details_json && <span className="muted"> · {Object.values(JSON.parse(l.details_json)).filter((v) => typeof v === 'string').join(', ')}</span>}
              </span>
              <span className="muted">
                {l.actor ?? 'system'} · {fmtDay(l.created_at)}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
