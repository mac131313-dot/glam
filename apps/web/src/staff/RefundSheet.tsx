// Zwrot i podmiana karnetu z karty klientki – tylko właścicielka (finance.refund), np. przy przypadkowym zakupie.
// Kwota w formularzu sama trzyma się granic: nie da się wpisać więcej, niż klientka zapłaciła.
import { useState } from 'react';
import { api, useApi } from '../api.ts';
import { Field, Select, Sheet, Spinner, useAction } from '../ui.tsx';

type Quote = { paid: string; refunded: string; maxGrosze: number; suggestedGrosze: number; passName: string | null; channel: 'gateway' | 'manual'; description: string | null };

const toZl = (grosze: number) => (grosze / 100).toFixed(2).replace('.', ',').replace(',00', '');
const toGrosze = (zl: string) => Math.round(Number(zl.replace(/\s/g, '').replace(',', '.')) * 100);

export function RefundSheet({ paymentId, onClose, onDone }: { paymentId: string; onClose: () => void; onDone: () => void }) {
  const { data: q } = useApi<Quote>(`/owner/payments/${paymentId}/refund`);
  const [amount, setAmount] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  if (!q) return <Sheet onClose={onClose} label="Zwrot"><Spinner /></Sheet>;

  const value = amount ?? toZl(q.suggestedGrosze);
  const grosze = Math.min(q.maxGrosze, Math.max(0, toGrosze(value) || 0));
  // Wpisywanie ponad wpłatę od razu przycina się do maksimum – bez komunikatu o błędzie na końcu.
  const onAmount = (v: string) => setAmount(toGrosze(v) > q.maxGrosze ? toZl(q.maxGrosze) : v.replace(/[^\d,.\s]/g, ''));

  return (
    <Sheet onClose={onClose} label="Zwrot">
      <div className="stack">
        <h2 style={{ margin: 0 }}>Zwrot</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {[q.description ?? q.passName, `zapłacone ${q.paid}`].filter(Boolean).join(' · ')}
          {q.refunded !== '0 zł' && ` · zwrócone ${q.refunded}`}
        </p>
        {q.maxGrosze === 0 ? (
          <p className="small">Ta płatność została już w całości zwrócona.</p>
        ) : (
          <>
            <Field label="Kwota zwrotu (zł)" hint={`Najwyżej ${toZl(q.maxGrosze)} zł`}>
              <input className="input" inputMode="decimal" value={value} onChange={(e) => onAmount(e.target.value)} aria-label="Kwota zwrotu" />
            </Field>
            <Field label="Powód (opcjonalnie)">
              <input className="input" placeholder="np. kupiony przez pomyłkę" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <p className="tiny muted" style={{ margin: 0 }}>
              {q.passName && `Karnet „${q.passName}” zostanie anulowany, a przyszłe rezerwacje zwolnione. `}
              {q.channel === 'manual' ? 'Płatność była w recepcji – zwrot zapiszemy, pieniądze wydajesz w kasie.' : 'Pieniądze wrócą tą samą metodą, którą klientka płaciła.'}
            </p>
            <button className="btn" disabled={busy || grosze === 0} onClick={() => run(() => api(`/owner/payments/${paymentId}/refund`, { method: 'POST', body: { amountGrosze: grosze, reason } })).then((r) => r && (onDone(), onClose()))}>
              Zwróć {toZl(grosze)} zł
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

export function SwapSheet({ userId, pass, onClose, onDone }: { userId: string; pass: { id: string; productName: string }; onClose: () => void; onDone: () => void }) {
  const products = useApi<{ id: string; name: string; price: string }[]>('/products');
  const [productId, setProductId] = useState('');
  const [refundDifference, setRefundDifference] = useState(true);
  const { run, busy } = useAction();
  return (
    <Sheet onClose={onClose} label="Podmień karnet">
      <div className="stack">
        <h2 style={{ margin: 0 }}>Podmień karnet</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Zamiast „{pass.productName}” – na wyjątkowe sytuacje, np. karnet kupiony na złe zajęcia. Nowy karnet liczy się od dziś.
        </p>
        <Select
          ariaLabel="Nowy karnet"
          value={productId}
          onChange={setProductId}
          options={[{ value: '', label: 'Wybierz karnet' }, ...(products.data ?? []).filter((p) => p.name !== pass.productName).map((p) => ({ value: p.id, label: `${p.name} · ${p.price}` }))]}
        />
        <label className="row small gap-2">
          <input type="checkbox" checked={refundDifference} onChange={(e) => setRefundDifference(e.target.checked)} />
          Jeśli nowy jest tańszy – zwróć różnicę
        </label>
        <p className="tiny muted" style={{ margin: 0 }}>Gdy nowy jest droższy, pokażemy kwotę do dopłaty w recepcji.</p>
        <button
          className="btn"
          disabled={busy || !productId}
          onClick={() => run(() => api(`/owner/passes/${pass.id}/swap`, { method: 'POST', body: { userId, productId, refundDifference } })).then((r) => r && (onDone(), onClose()))}
        >
          Podmień
        </button>
      </div>
    </Sheet>
  );
}
