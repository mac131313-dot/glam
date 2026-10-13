// Kartki i nagrody (4.12.1, G1, G2): lista „Kartki do wysłania” (napisana / wysłana / odebrana) i kolejka nagród
// z „Mojej szafki” (po 10. zajęciach, za punkty): przygotowanie, wysyłka, odbiór w recepcji.
import { can, type Role } from '@glam/core';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Spinner, useAction } from '../ui.tsx';

type CardTask = { id: string; client_name: string; trainer_name: string | null; due_on: string; delivery: string; status: string; goal: string | null; address: { line: string; city: string; zip: string } | null };
type LockerItem = { id: string; client_name: string; title: string; size: string | null; delivery: string | null; status: string; created_at: string; address: { line: string; city: string; zip: string } | null };

const CARD: Record<string, string> = { todo: 'do napisania', written: 'napisana', sent: 'wysłana', collected: 'odebrana' };
const LOCKER: Record<string, string> = { queued: 'do przygotowania', ready: 'czeka w recepcji', shipped: 'wysłana' };

export default function Gifts({ roles }: { roles: Role[] }) {
  const cards = useApi<CardTask[]>('/staff/cards');
  const locker = useApi<LockerItem[]>(can(roles, 'cards.manage') || can(roles, 'shop.manage') ? '/staff/locker' : null);
  const { run } = useAction();
  const manage = can(roles, 'cards.manage');
  return (
    <div className="stack-lg">
      <div>
        <h1>Kartki i nagrody</h1>
        <p className="muted" style={{ margin: 0 }}>Odręczna kartka po pierwszym miesiącu – 3–4 zdania od trenerki, bez szablonu.</p>
      </div>
      <section className="stack">
        <div className="eyebrow">Kartki do wysłania</div>
        {!cards.data ? (
          <Spinner />
        ) : cards.data.length === 0 ? (
          <Empty>Brak kartek do napisania.</Empty>
        ) : (
          cards.data.map((c) => (
            <div key={c.id} className="card flat row between" style={{ alignItems: 'flex-start' }}>
              <span>
                <b>{c.client_name}</b> <span className="badge">{CARD[c.status]}</span>
                <span className="small muted" style={{ display: 'block' }}>
                  do {fmtDay(`${c.due_on}T12:00:00Z`)} · {c.delivery === 'post' ? 'pocztą' : 'odbiór w recepcji'} {c.trainer_name && `· pisze ${c.trainer_name}`} {c.goal && `· cel: ${c.goal}`}
                </span>
                {c.address && (
                  <span className="tiny" style={{ display: 'block' }}>
                    {c.address.line}, {c.address.zip} {c.address.city}
                  </span>
                )}
              </span>
              <span className="row" style={{ gap: 6 }}>
                {c.status === 'todo' && (
                  <button className="btn sm" onClick={() => run(() => api(`/staff/cards/${c.id}`, { method: 'PATCH', body: { status: 'written' } }).then(cards.reload), 'Dziękujemy 💛')}>
                    Napisana
                  </button>
                )}
                {manage && c.status === 'written' && c.delivery === 'post' && (
                  <button className="btn sm" onClick={() => run(() => api(`/staff/cards/${c.id}`, { method: 'PATCH', body: { status: 'sent' } }).then(cards.reload), 'Wysłana – klientka dostała powiadomienie')}>
                    Wysłana
                  </button>
                )}
                {manage && ['written', 'sent'].includes(c.status) && (
                  <button className="btn ghost sm" onClick={() => run(() => api(`/staff/cards/${c.id}`, { method: 'PATCH', body: { status: 'collected' } }).then(cards.reload))}>
                    Odebrana
                  </button>
                )}
              </span>
            </div>
          ))
        )}
        <p className="tiny muted">Adres widać tylko za zgodą klientki. Koszt kartki i wysyłki – budżet marketingowy studia.</p>
      </section>
      {locker.data && (
        <section className="stack">
          <div className="eyebrow">Kolejka nagród i prezentów</div>
          {locker.data.length === 0 && <Empty>Kolejka pusta.</Empty>}
          {locker.data.map((l) => (
            <div key={l.id} className="card flat row between" style={{ alignItems: 'flex-start' }}>
              <span>
                <b>{l.client_name}</b>: {l.title} {l.size && `(${l.size})`} <span className="badge">{LOCKER[l.status] ?? l.status}</span>
                <span className="small muted" style={{ display: 'block' }}>
                  {l.delivery === 'ship' ? 'wysyłka' : 'odbiór w recepcji'} · od {fmtDay(l.created_at)}
                </span>
                {l.address && (
                  <span className="tiny" style={{ display: 'block' }}>
                    {l.address.line}, {l.address.zip} {l.address.city}
                  </span>
                )}
              </span>
              <span className="row" style={{ gap: 6 }}>
                {l.status === 'queued' && l.delivery !== 'ship' && (
                  <button className="btn sm" onClick={() => run(() => api(`/staff/locker/${l.id}`, { method: 'PATCH', body: { status: 'ready' } }).then(locker.reload), 'Klientka dostała powiadomienie')}>
                    Gotowe do odbioru
                  </button>
                )}
                {l.status === 'queued' && l.delivery === 'ship' && (
                  <button className="btn sm" onClick={() => run(() => api(`/staff/locker/${l.id}`, { method: 'PATCH', body: { status: 'shipped' } }).then(locker.reload))}>
                    Wysłane
                  </button>
                )}
                {l.status === 'ready' && (
                  <button className="btn sm" onClick={() => run(() => api(`/staff/locker/${l.id}`, { method: 'PATCH', body: { status: 'collected' } }).then(locker.reload), 'Odebrane')}>
                    Odebrane
                  </button>
                )}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
