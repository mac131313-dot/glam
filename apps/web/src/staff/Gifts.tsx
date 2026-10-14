// Kartki i nagrody (4.12.1, G1, G2): lista „Kartki do wysłania” (napisana / wysłana / odebrana) i kolejka nagród
// z „Mojej szafki” (po 10. zajęciach, za punkty): przygotowanie, wysyłka, odbiór w recepcji; vouchery kwotowe na zajęcia.
import { useState } from 'react';
import { can, type Role } from '@glam/core';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Select, Spinner, useAction } from '../ui.tsx';

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
      {manage && <Vouchers />}
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

type Voucher = { id: string; code: string; class_name: string | null; amount: string; recipient: string | null; valid_until: string; status: string; expired: boolean; created_by_name: string | null };
const VOUCHER: Record<string, string> = { active: 'aktywny', redeemed: 'wykorzystany', cancelled: 'anulowany' };
const VALIDITY = [
  { value: '30', label: '30 dni' },
  { value: '90', label: '3 miesiące' },
  { value: '180', label: '6 miesięcy' },
  { value: '365', label: '12 miesięcy' },
];

// Vouchery: kwota na wybrane zajęcia (albo dowolne), kod do okazania w recepcji.
function Vouchers() {
  const data = useApi<{ vouchers: Voucher[]; classTypes: { id: string; name: string; level: string | null }[] }>('/staff/vouchers');
  const [f, setF] = useState({ classTypeId: '', amount: '', recipient: '', validDays: '90' });
  const { run, busy } = useAction();
  const amount = Math.round(Number(f.amount.replace(',', '.')) * 100);
  const classes = [
    { value: '', label: 'Dowolne zajęcia' },
    ...(data.data?.classTypes ?? []).map((c) => ({ value: c.id, label: c.level && c.level !== 'wszystkie poziomy' ? `${c.name} · ${c.level}` : c.name })),
  ];
  const create = () =>
    run(
      () => api<{ code: string }>('/staff/vouchers', { method: 'POST', body: { ...f, classTypeId: f.classTypeId || null, amount, validDays: Number(f.validDays) } }).then((r) => (setF({ ...f, amount: '', recipient: '' }), data.reload(), r)),
      (r) => `Voucher ${r?.code ?? ''} wystawiony`,
    );
  const close = (v: Voucher, status: 'redeemed' | 'cancelled') => run(() => api(`/staff/vouchers/${v.id}`, { method: 'PATCH', body: { status } }).then(data.reload), status === 'redeemed' ? 'Oznaczony jako wykorzystany' : 'Voucher anulowany');
  return (
    <section className="stack">
      <div className="eyebrow">Vouchery</div>
      <section className="card stack">
        <div className="row wrap">
          <div className="field grow">
            <label htmlFor="vc-class">Na jakie zajęcia</label>
            <Select id="vc-class" value={f.classTypeId} onChange={(v) => setF({ ...f, classTypeId: v })} options={classes} />
          </div>
          <div className="field grow">
            <label htmlFor="vc-amount">Kwota (zł)</label>
            <input id="vc-amount" className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="Np. 150" />
          </div>
        </div>
        <div className="row wrap">
          <div className="field grow">
            <label htmlFor="vc-for">Dla kogo (opcjonalnie)</label>
            <input id="vc-for" className="input" value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} placeholder="Np. Ania – prezent od Kasi" />
          </div>
          <div className="field grow">
            <label htmlFor="vc-valid">Ważny</label>
            <Select id="vc-valid" value={f.validDays} onChange={(v) => setF({ ...f, validDays: v })} options={VALIDITY} />
          </div>
        </div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!(amount >= 100) || busy} onClick={create}>
          Wystaw voucher
        </button>
      </section>
      {!data.data ? (
        <Spinner />
      ) : data.data.vouchers.length === 0 ? (
        <Empty>Brak wystawionych voucherów.</Empty>
      ) : (
        data.data.vouchers.map((v) => (
          <div key={v.id} className="card flat row between" style={{ alignItems: 'flex-start', opacity: v.status === 'active' && !v.expired ? 1 : 0.6 }}>
            <span>
              <b>{v.code}</b> <span className={`badge ${v.expired ? 'warn' : ''}`}>{v.expired ? 'po terminie' : VOUCHER[v.status]}</span>
              <span className="small muted" style={{ display: 'block' }}>
                {v.amount} · {v.class_name ?? 'dowolne zajęcia'} {v.recipient && `· dla: ${v.recipient}`} · ważny do {fmtDay(v.valid_until)}
              </span>
              {v.created_by_name && <span className="tiny muted">wystawiła {v.created_by_name}</span>}
            </span>
            {v.status === 'active' && (
              <span className="row" style={{ gap: 6 }}>
                {!v.expired && (
                  <button className="btn sm" onClick={() => close(v, 'redeemed')}>
                    Wykorzystany
                  </button>
                )}
                <button className="btn ghost sm" onClick={() => window.confirm(`Anulować voucher ${v.code}?`) && close(v, 'cancelled')}>
                  Anuluj
                </button>
              </span>
            )}
          </div>
        ))
      )}
    </section>
  );
}
