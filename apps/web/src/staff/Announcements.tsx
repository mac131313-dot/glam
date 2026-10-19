// Treści → Wydarzenia (panel właścicielki): ogłoszenia wydarzeń w studiu, np. „Spotkanie z trenerką Anią”
// 18:00–19:30. Nowe wydarzenie wysyła powiadomienie do wszystkich klientek; przy edycji i odwołaniu
// powiadomienie jest opcjonalne. Bez zapisów, sali i limitu miejsc – to robią Wydarzenia w Relacjach.
import { useState } from 'react';
import { addDaysStr, api, fmtDay, fmtTime, localDate, useApi } from '../api.ts';
import { Empty, Field, Sheet, Spinner, Toggle, useAction } from '../ui.tsx';

type Item = { id: string; title: string; description: string | null; place: string | null; date: string; from: string; to: string; when: string; status: 'active' | 'cancelled'; past: boolean; notifiedCount: number; notifiedAt: string | null };
type Draft = { title: string; description: string; place: string; date: string; from: string; to: string; notify: boolean };

const blank = (): Draft => ({ title: '', description: '', place: '', date: addDaysStr(localDate(), 7), from: '18:00', to: '19:30', notify: true });

export default function Announcements() {
  const list = useApi<{ audience: number; items: Item[] }>('/owner/announcements');
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [cancel, setCancel] = useState<Item | null>(null);
  const [cancelNotify, setCancelNotify] = useState(true);
  const { run, busy } = useAction();

  if (!list.data) return <Spinner />;
  const upcoming = list.data.items.filter((i) => i.status === 'active' && !i.past);
  const rest = list.data.items.filter((i) => !upcoming.includes(i));

  const row = (i: Item) => (
    <section key={i.id} className={`card ${upcoming.includes(i) ? '' : 'flat'} stack gap-2`} style={{ opacity: i.status === 'cancelled' ? 0.6 : 1 }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <b style={{ fontSize: '1.05rem', textDecoration: i.status === 'cancelled' ? 'line-through' : undefined }}>{i.title}</b>
          <div className="small muted">{i.when}</div>
        </div>
        {i.status === 'cancelled' ? <span className="badge">odwołane</span> : i.past ? <span className="badge">minęło</span> : null}
      </div>
      {i.description && <p className="small" style={{ margin: 0 }}>{i.description}</p>}
      <div className="tiny muted">{i.notifiedAt ? `Powiadomienie: ${i.notifiedCount} klientek · ${fmtDay(i.notifiedAt)} ${fmtTime(i.notifiedAt)}` : 'Bez powiadomienia'}</div>
      {upcoming.includes(i) && (
        <div className="row gap-2">
          <button className="btn ghost sm" onClick={() => setEdit(i)}>
            Edytuj
          </button>
          <button className="btn quiet sm" onClick={() => (setCancelNotify(true), setCancel(i))}>
            Odwołaj
          </button>
        </div>
      )}
    </section>
  );

  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <div className="row between wrap">
        <div>
          <h1 style={{ margin: 0 }}>Wydarzenia</h1>
          <p className="muted" style={{ margin: 0 }}>Ogłoś wydarzenie w studiu – każda klientka dostanie powiadomienie w aplikacji.</p>
        </div>
        <button className="btn" onClick={() => setEdit('new')}>
          + Nowe wydarzenie
        </button>
      </div>

      <section className="stack gap-3">
        <div className="eyebrow" style={{ margin: 0 }}>Nadchodzące</div>
        {upcoming.length ? upcoming.map(row) : <Empty>Nie ma zaplanowanych wydarzeń. Dodaj pierwsze – np. spotkanie z trenerką.</Empty>}
      </section>
      {rest.length > 0 && (
        <section className="stack gap-3">
          <div className="eyebrow" style={{ margin: 0 }}>Minione i odwołane</div>
          {rest.map(row)}
        </section>
      )}

      {edit && <AnnouncementForm item={edit === 'new' ? null : edit} audience={list.data.audience} onClose={() => setEdit(null)} onDone={list.reload} />}
      {cancel && (
        <Sheet onClose={() => setCancel(null)} label="Odwołanie wydarzenia">
          <div className="stack">
            <h2>Odwołać „{cancel.title}”?</h2>
            <p className="small muted" style={{ margin: 0 }}>{cancel.when}</p>
            <Toggle label="Powiadom klientki" hint={`Wiadomość „Odwołane: ${cancel.title}” do ${list.data.audience} klientek`} checked={cancelNotify} onChange={setCancelNotify} />
            <button
              className="btn block"
              disabled={busy}
              onClick={() => run(() => api(`/owner/announcements/${cancel.id}/cancel`, { method: 'POST', body: { notify: cancelNotify } }).then((r) => (setCancel(null), list.reload(), r)))}
            >
              Tak, odwołaj
            </button>
            <button className="btn ghost block" onClick={() => setCancel(null)}>
              Zostaw
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function AnnouncementForm({ item, audience, onClose, onDone }: { item: Item | null; audience: number; onClose: () => void; onDone: () => void }) {
  // Nowe wydarzenie: powiadomienie domyślnie włączone. Edycja: domyślnie bez – poprawka literówki nie budzi wszystkich telefonów.
  const [f, setF] = useState<Draft>(() => (item ? { title: item.title, description: item.description ?? '', place: item.place ?? '', date: item.date, from: item.from, to: item.to, notify: false } : blank()));
  const { run, busy } = useAction();
  const ready = f.title.trim().length >= 3 && f.date && f.from && f.to && f.to > f.from;
  const save = () =>
    run(() =>
      api<{ message: string }>(item ? `/owner/announcements/${item.id}` : '/owner/announcements', { method: 'POST', body: f }).then((r) => {
        onDone();
        onClose();
        return r;
      }),
    );

  return (
    <Sheet onClose={onClose} label={item ? 'Edycja wydarzenia' : 'Nowe wydarzenie'}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{item ? 'Edytuj wydarzenie' : 'Nowe wydarzenie'}</h2>
        <Field label="Nazwa">
          <input className="input" placeholder="Spotkanie z trenerką Anią" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Dzień">
          <input className="input" type="date" min={localDate()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <div className="row">
          <Field label="Od">
            <input className="input" type="time" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </Field>
          <Field label="Do">
            <input className="input" type="time" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </Field>
        </div>
        {f.from && f.to && f.to <= f.from && <span className="small" style={{ color: 'var(--danger)' }}>Koniec musi być po początku.</span>}
        <Field label="Miejsce" hint="Opcjonalnie, np. Sala 2">
          <input className="input" maxLength={80} value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} />
        </Field>
        <Field label="Opis" hint="Opcjonalnie – co się wydarzy, co zabrać">
          <textarea className="input" maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Toggle
          label={item ? 'Wyślij powiadomienie o zmianie' : 'Wyślij powiadomienie'}
          hint={`Do ${audience} klientek studia, w aplikacji`}
          checked={f.notify}
          onChange={(v) => setF({ ...f, notify: v })}
        />
        <button className="btn block" disabled={!ready || busy} onClick={save}>
          {item ? 'Zapisz zmiany' : f.notify ? 'Zapisz i wyślij' : 'Zapisz'}
        </button>
      </div>
    </Sheet>
  );
}
