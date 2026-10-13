// Pulpit właścicielki (3, #14): frekwencja dziś, przychód miesiąca, nowe klientki, aktywne / uśpione, obłożenie,
// popularne zajęcia, płatności, kafelek „Kursy” (K16) i lista „do zrobienia” prowadząca do właściwych sekcji.
import { fmtDay, useApi } from '../api.ts';
import { PAYMENT_LABELS, Spinner, Stat } from '../ui.tsx';

type Dash = {
  today: { sessions: number; booked: number; attended: number; capacity: number };
  revenueMonth: { total: string; count: number };
  newClients: number;
  clientsTotal: number;
  segments: Record<'active' | 'dormant7' | 'dormant14' | 'dormant30' | 'ambassador' | 'churn_risk' | 'new', number>;
  occupancy7d: number;
  popular: { name: string; bookings: number }[];
  payments: { amount: string; method: string; kind: string; created_at: string; name: string | null; description: string | null }[];
  guestPasses: { sent: number; activated: number };
  courses: { published: number; pending: number; enrolled: number; completed: number };
  todo: Record<'welcomes' | 'courses' | 'reports' | 'followups' | 'locker' | 'cards' | 'events' | 'orders' | 'tracks' | 'chats', number>;
};

const KIND: Record<string, string> = { pass: 'karnet', guest_pass: 'wejściówka', course: 'kurs', event: 'wydarzenie', shop: 'sklep', renewal: 'odnowienie' };

export function Dashboard({ go }: { go?: (section: string) => void }) {
  const { data } = useApi<Dash>('/owner/dashboard');
  if (!data) return <Spinner />;
  const maxPopular = Math.max(1, ...data.popular.map((p) => p.bookings));
  const seg = [
    { label: 'Aktywne (<7 dni)', value: data.segments.active, color: 'var(--ink)' },
    { label: 'Uśpione 7–14 dni', value: data.segments.dormant7, color: 'var(--brand-strong)' },
    { label: 'Uśpione 14–30 dni', value: data.segments.dormant14, color: 'var(--brand)' },
    { label: 'Uśpione 30+ dni', value: data.segments.dormant30, color: 'var(--line)' },
  ];
  const todo: [keyof Dash['todo'], string, string][] = [
    ['chats', 'Nieprzeczytane wiadomości od klientek', 'messages'],
    ['followups', 'Klientki proszą o propozycję terminu', 'messages'],
    ['welcomes', 'Powitania czekają na akceptację', 'welcomes'],
    ['courses', 'Kursy czekają na akceptację', 'courses'],
    ['reports', 'Zgłoszenia w społeczności', 'community'],
    ['events', 'Zapytania o wydarzenia', 'events'],
    ['orders', 'Zamówienia i rezerwacje w sklepie', 'shop'],
    ['locker', 'Nagrody do przygotowania', 'gifts'],
    ['cards', 'Kartki od trenerek do wysłania', 'gifts'],
    ['tracks', 'Utwory do zatwierdzenia', 'music'],
  ];
  const open = todo.filter(([k]) => data.todo[k] > 0);

  return (
    <div className="stack-lg">
      <div>
        <h1>Pulpit</h1>
        <p className="muted" style={{ margin: 0 }}>Jak dziś oddycha Twoje studio</p>
      </div>

      <div className="kpis">
        <Stat label="Dziś na zajęciach" value={<>{data.today.booked}<span className="muted" style={{ fontSize: '1rem' }}> / {data.today.capacity}</span></>} hint={`${data.today.sessions} sesji · obecne: ${data.today.attended}`} />
        <Stat label="Przychód w tym miesiącu" value={data.revenueMonth.total} hint={`${data.revenueMonth.count} płatności`} />
        <Stat label="Nowe klientki" value={data.newClients} hint={`w tym miesiącu · łącznie ${data.clientsTotal}`} />
        <Stat label="Obłożenie 7 dni" value={`${data.occupancy7d}%`} hint="zarezerwowane miejsca" />
      </div>

      <div className="grid-2">
        <section className="card stack" style={{ gap: 8 }}>
          <h3>Do zrobienia</h3>
          {open.length === 0 && <p className="small muted" style={{ margin: 0 }}>Wszystko ogarnięte.</p>}
          <div>
            {open.map(([k, label, section]) => (
              <button key={k} className="todo-row" onClick={() => go?.(section)}>
                <span className="grow">{label}</span>
                <span className="badge">{data.todo[k]}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden>
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            ))}
          </div>
        </section>

        <section className="card stack">
          <h3>Klientki: aktywne i uśpione</h3>
          {seg.map((s) => (
            <div key={s.label} className="stack" style={{ gap: 4 }}>
              <div className="row between small">
                <span>{s.label}</span>
                <b>{s.value}</b>
              </div>
              <div className="progress">
                <span style={{ width: `${(s.value / Math.max(1, data.clientsTotal)) * 100}%`, background: s.color }} />
              </div>
            </div>
          ))}
          <div className="row between small">
            <span>Ambasadorki · ryzyko odejścia</span>
            <b>
              {data.segments.ambassador} · {data.segments.churn_risk}
            </b>
          </div>
          <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => go?.('clients')}>
            Zobacz segmenty
          </button>
        </section>

        <section className="card stack">
          <h3>Najpopularniejsze zajęcia (7 dni)</h3>
          {data.popular.map((p) => (
            <div key={p.name} className="stack" style={{ gap: 4 }}>
              <div className="row between small">
                <span>{p.name}</span>
                <b>{p.bookings}</b>
              </div>
              <div className="progress">
                <span style={{ width: `${(p.bookings / maxPopular) * 100}%` }} />
              </div>
            </div>
          ))}
        </section>

        <section className="card stack">
          <h3>Kursy</h3>
          <div className="row between small">
            <span>Opublikowane · czekają</span>
            <b>
              {data.courses.published} · {data.courses.pending}
            </b>
          </div>
          <div className="row between small">
            <span>Uczestniczki · ukończenia</span>
            <b>
              {data.courses.enrolled} · {data.courses.completed}
            </b>
          </div>
          <div className="row between small">
            <span>Wejściówki wysłane / odebrane</span>
            <b>
              {data.guestPasses.sent} / {data.guestPasses.activated}
            </b>
          </div>
        </section>

        <section className="card stack" style={{ gridColumn: '1 / -1' }}>
          <h3>Ostatnie płatności</h3>
          <table className="table">
            <tbody>
              {data.payments.map((p, i) => (
                <tr key={i}>
                  <td>{p.name ?? 'Kasa'}</td>
                  <td className="muted">{p.description ?? KIND[p.kind] ?? p.kind}</td>
                  <td className="muted">{PAYMENT_LABELS[p.method] ?? p.method}</td>
                  <td className="muted">{fmtDay(p.created_at)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{p.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
