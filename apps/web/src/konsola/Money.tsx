// Pieniądze w konsoli: opłacone płatności abonamentu (do zafakturowania / wszystkie), numer faktury, eksport CSV
// dla księgowej i MRR wg planów. Faktury wystawia się poza systemem – tu tylko zapisujemy ich numery.
import { useState } from 'react';
import { ApiError, api, session, useApi } from '../api.ts';
import { Empty, Field, ListRow, Pending, Select, Sheet, Stat, Tabs, useAction } from '../ui.tsx';
import { date } from './audit.ts';
import type { Go } from './KonsolaApp.tsx';

type Payment = {
  id: string;
  studio: string;
  studioId: string;
  companyName: string | null;
  nip: string | null;
  amount: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string;
  invoicedAt: string | null;
  invoiceNumber: string | null;
};
type Overview = { mrr: string; paying: number; byPlan: { plan: string; studios: number; mrr: string }[] };
type View = 'uninvoiced' | 'all';

const VIEWS: [View, string][] = [
  ['uninvoiced', 'Do zafakturowania'],
  ['all', 'Wszystkie'],
];
const period = (p: Payment) => `${date(p.periodStart)} – ${date(p.periodEnd)}`;

export function Money({ go }: { go: Go }) {
  const [view, setView] = useState<View>('uninvoiced');
  const [exporting, setExporting] = useState(false);
  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div>
          <h1 style={{ marginBottom: 0 }}>Pieniądze</h1>
          <p className="muted" style={{ margin: 0 }}>Płatności za abonament GLAM</p>
        </div>
        <button className="btn quiet sm" onClick={() => setExporting(true)}>
          Eksport CSV
        </button>
      </div>
      <Summary />
      <Tabs label="Widok płatności" value={view} onChange={setView} options={VIEWS} />
      <PaymentList key={view} view={view} go={go} />
      {exporting && <ExportSheet onClose={() => setExporting(false)} />}
    </div>
  );
}

/** MRR z planów studiów z aktywnym abonamentem (liczy serwer), z podziałem na plany. */
function Summary() {
  const { data } = useApi<Overview>('/platform/overview', [], { global: true });
  if (!data) return null;
  return (
    <section className="stack gap-2">
      <div className="kpis">
        <Stat label="MRR" value={data.mrr} hint="suma cen planów" />
        <Stat label="Płacące studia" value={data.paying} hint="z aktywnym abonamentem" />
      </div>
      <div>
        {data.byPlan.map((p) => (
          <div key={p.plan} className="konsola-line">
            <span className="muted small">Plan {p.plan}</span>
            <span>
              {p.studios} · {p.mrr}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PaymentList({ view, go }: { view: View; go: Go }) {
  const { data, error, reload } = useApi<Payment[]>(`/platform/payments?status=${view}`, [], { global: true });
  const [open, setOpen] = useState<Payment | null>(null);
  if (!data) return <Pending error={error} reload={reload} />;
  return (
    <>
      {data.length === 0 && <Empty>{view === 'uninvoiced' ? 'Wszystko zafakturowane.' : 'Brak płatności.'}</Empty>}
      <div className="list-rows">
        {data.map((p) => (
          <ListRow
            key={p.id}
            title={`${p.studio} · ${period(p)}`}
            hint={p.invoiceNumber ? `Faktura ${p.invoiceNumber}` : `opłacono ${date(p.paidAt)}`}
            badge={<span className="badge">{p.amount}</span>}
            onClick={() => setOpen(p)}
          />
        ))}
      </div>
      {open && <PaymentSheet payment={open} go={go} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

function PaymentSheet({ payment: p, go, onClose, onChanged }: { payment: Payment; go: Go; onClose: () => void; onChanged: () => unknown }) {
  const [number, setNumber] = useState('');
  const { run, busy } = useAction();
  const mark = async () => {
    const done = await run(() => api(`/platform/payments/${p.id}/invoice`, { method: 'POST', body: { number: number.trim() }, global: true }), 'Oznaczono jako zafakturowaną');
    // Także po odmowie (np. ktoś inny zdążył oznaczyć): lista ma pokazać aktualny stan.
    await onChanged();
    if (done !== undefined) onClose();
  };
  return (
    <Sheet onClose={onClose} label="Płatność">
      <div className="stack">
        <div>
          <h2 style={{ marginBottom: 0 }}>{p.studio}</h2>
          <button className="link small" onClick={() => go(`studios/${p.studioId}`)}>
            Karta studia →
          </button>
        </div>
        <div>
          <Line label="Kwota brutto">{p.amount}</Line>
          <Line label="Okres">{period(p)}</Line>
          <Line label="Opłacono">{date(p.paidAt)}</Line>
          <Line label="Firma">{p.companyName ?? 'brak danych'}</Line>
          <Line label="NIP">{p.nip ?? 'brak danych'}</Line>
          {p.invoicedAt && <Line label="Faktura">{`${p.invoiceNumber} · ${date(p.invoicedAt)}`}</Line>}
        </div>
        {!p.invoicedAt && (
          <>
            <Field label="Numer faktury">
              <input className="input" maxLength={40} value={number} placeholder="np. FV/2026/11/001" onChange={(e) => setNumber(e.target.value)} />
            </Field>
            <button className="btn" disabled={!number.trim() || busy} onClick={mark}>
              Oznacz jako zafakturowaną
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function Line({ label, children }: { label: string; children: string }) {
  return (
    <div className="konsola-line">
      <span className="muted small">{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** Ostatnie 12 miesięcy, od bieżącego: `value` to „RRRR-MM”. */
function lastMonths(): { value: string; label: string }[] {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' });
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: fmt.format(d) };
  });
}

/** Pobiera CSV z płatnościami miesiąca. Endpoint wymaga tokenu, więc zwykły link nie wystarczy: fetch → Blob → pobranie. */
async function downloadCsv(month: string): Promise<true> {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const res = await fetch(`/api/platform/payments.csv?from=${month}-01&to=${month}-${String(last).padStart(2, '0')}`, {
    headers: { authorization: `Bearer ${session.token}` },
  }).catch(() => {
    throw new ApiError(0, 'network', 'Brak internetu – sprawdź połączenie.');
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? 'error', body.message ?? 'Nie udało się pobrać pliku.');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `glam-platnosci-${month}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

function ExportSheet({ onClose }: { onClose: () => void }) {
  const months = lastMonths();
  // Księgowa zwykle potrzebuje poprzedniego miesiąca.
  const [month, setMonth] = useState(months[1].value);
  const { run, busy } = useAction();
  return (
    <Sheet onClose={onClose} label="Eksport CSV">
      <div className="stack">
        <h2>Eksport CSV</h2>
        <p className="small muted" style={{ margin: 0 }}>Wszystkie płatności z wybranego miesiąca, także zafakturowane. Plik otwiera się w Excelu.</p>
        <div className="field">
          <span className="field-label">Miesiąc</span>
          <Select ariaLabel="Miesiąc eksportu" value={month} options={months} onChange={setMonth} />
        </div>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            if ((await run(() => downloadCsv(month), 'Plik pobrany')) !== undefined) onClose();
          }}
        >
          Pobierz
        </button>
      </div>
    </Sheet>
  );
}
