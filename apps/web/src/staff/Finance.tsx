// Finanse (4.2, T10, 4.8.1): przychód w okresie wg rodzaju i formy płatności, rabaty, ewidencja sprzedaży
// na miejscu, lista płatności z fakturami, faktury zbiorcze, eksport CSV. GLAM nie pośredniczy w płatnościach.
import { useState } from 'react';
import { can, type Role } from '@glam/core';
import { api, fmtDay, localDate, session, useApi } from '../api.ts';
import { Empty, PAYMENT_LABELS, Spinner, Stat, useAction } from '../ui.tsx';
import { download } from './Clients.tsx';
import { RefundSheet } from './RefundSheet.tsx';

type Fin = {
  from: string;
  to: string;
  total: string;
  discounts: string;
  commission: string | null;
  byKind: { kind: string; amount: string; n: number }[];
  byMethod: { method: string; amount: string; n: number }[];
  shopOnSite: { amount: string; n: number };
  refunds: { amount: string; n: number };
  payments: { id: string; kind: string; amount: string; refunded: string | null; status: string; method: string; created_at: string; description: string | null; invoice_id: string | null; invoice_number: string | null; name: string | null }[];
  invoices: { id: string; number: string; issued_at: string; gross_grosze: number }[];
};

const KIND: Record<string, string> = { pass: 'Karnety', guest_pass: 'Wejściówki', course: 'Kursy', event: 'Wydarzenia', shop: 'Sklep', renewal: 'Odnowienia' };

export default function Finance({ roles }: { roles: Role[] }) {
  const [from, setFrom] = useState(`${localDate().slice(0, 7)}-01`);
  const [to, setTo] = useState(localDate());
  // Recepcja ma sam eksport (finance.export) bez wglądu w przychody (finance.view) – widzi tylko narzędzia eksportu.
  const view = can(roles, 'finance.view');
  const fin = useApi<Fin>(view ? `/owner/finance?from=${from}&to=${to}` : null);
  const { run, busy } = useAction();
  const [refund, setRefund] = useState<string | null>(null);
  const canRefund = can(roles, 'finance.refund');
  const exp = can(roles, 'finance.export');
  const exports = exp && (
    <section className="card soft row wrap">
      {['payments', 'clients', 'bookings', 'shop'].map((w) => (
        <button key={w} className="btn ghost sm" onClick={() => download(`/owner/export/${w}.csv?from=${from}&to=${to}`, `${w}-${from}-${to}.csv`)}>
          CSV: {w === 'payments' ? 'płatności' : w === 'clients' ? 'klientki' : w === 'bookings' ? 'rezerwacje' : 'sklep'}
        </button>
      ))}
      <button
        className="btn sm"
        disabled={busy}
        onClick={() => run(() => api<{ issued: number }>('/owner/invoices/batch', { method: 'POST', body: { from, to } }).then((r) => (fin.reload(), r)), (r) => `Wystawiono ${r?.issued ?? 0} faktur`)}
      >
        Faktury zbiorcze za okres
      </button>
    </section>
  );
  const openInvoice = async (id: string) => {
    const res = await fetch(`/api/invoices/${id}`, { headers: { authorization: `Bearer ${session.token}`, 'x-studio-id': session.studioId ?? '' } });
    const w = window.open('', '_blank');
    if (w) w.document.write(await res.text());
  };
  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <h1 style={{ margin: 0 }}>Finanse</h1>
        <div className="row">
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Od" />
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Do" />
        </div>
      </div>
      {!view ? (
        <>
          {exports}
          <p className="small muted" style={{ margin: 0 }}>Przychody i listę płatności widzi właścicielka. Tutaj pobierzesz zestawienia i wystawisz faktury za wybrany okres.</p>
        </>
      ) : fin.error ? (
        <Empty>{fin.error.message}</Empty>
      ) : !fin.data ? (
        <Spinner />
      ) : (
        <>
          <div className="kpis">
            <Stat label="Przychód" value={fin.data.total} hint={fin.data.refunds.n ? `po zwrotach ${fin.data.refunds.amount} · rabaty ${fin.data.discounts}` : `rabaty ${fin.data.discounts}`} />
            <Stat label="Sprzedaż na miejscu (sklep)" value={fin.data.shopOnSite.amount} hint={`${fin.data.shopOnSite.n} transakcji – ewidencja`} />
            {fin.data.commission && <Stat label="Prowizja platformy" value={fin.data.commission} />}
          </div>
          <div className="grid-2">
            <section className="card stack gap-1">
              <div className="eyebrow">Wg rodzaju</div>
              {fin.data.byKind.map((k) => (
                <div key={k.kind} className="row between small">
                  <span>{KIND[k.kind] ?? k.kind}</span>
                  <span>
                    {k.amount} <span className="muted">({k.n})</span>
                  </span>
                </div>
              ))}
            </section>
            <section className="card stack gap-1">
              <div className="eyebrow">Wg formy płatności</div>
              {fin.data.byMethod.map((k) => (
                <div key={k.method} className="row between small">
                  <span>{PAYMENT_LABELS[k.method] ?? k.method}</span>
                  <span>
                    {k.amount} <span className="muted">({k.n})</span>
                  </span>
                </div>
              ))}
            </section>
          </div>
          {exports}
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Klientka</th>
                <th>Opis</th>
                <th>Kwota</th>
                <th>Forma</th>
                <th>Faktura</th>
              </tr>
            </thead>
            <tbody>
              {fin.data.payments.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{fmtDay(p.created_at)}</td>
                  <td>{p.name ?? '—'}</td>
                  <td>{p.description ?? KIND[p.kind] ?? p.kind}</td>
                  <td>
                    {p.amount}
                    {p.refunded && <div className="tiny muted">zwrot {p.refunded}</div>}
                    {canRefund && p.status === 'paid' && p.refunded !== p.amount && (
                      <button className="link tiny" onClick={() => setRefund(p.id)}>
                        Zwróć
                      </button>
                    )}
                  </td>
                  <td>{PAYMENT_LABELS[p.method] ?? p.method}</td>
                  <td>
                    {p.invoice_id ? (
                      <button className="link tiny" onClick={() => openInvoice(p.invoice_id!)}>
                        {p.invoice_number}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {refund && <RefundSheet paymentId={refund} onClose={() => setRefund(null)} onDone={fin.reload} />}
          <p className="tiny muted">GLAM nie pośredniczy w płatnościach – pieniądze trafiają bezpośrednio na konto studia przez jego bramkę. Faktury generujemy na żądanie klientki albo zbiorczo.</p>
        </>
      )}
    </div>
  );
}
