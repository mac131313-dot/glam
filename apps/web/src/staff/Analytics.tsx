// Analityka (#15, 4.11) i KPI (sekcja 12): retencja 30/60/90, aktywacja, frekwencja, średnia wejść, LTV, ARPU, NPS,
// wirusowość (zaproszenia), reaktywacja, dobrostan, motywy, kursy, powitania, życzenia, przychód w czasie.
import { useApi } from '../api.ts';
import { Spinner, Stat } from '../ui.tsx';

type A = {
  retention: { d30: number | null; d60: number | null; d90: number | null };
  activation: number | null;
  avgVisits30: number;
  attendanceRate: number;
  ltv: string;
  arpu: string;
  activeClients: number;
  nps: number | null;
  npsResponses: number;
  invitations: { perClient: number; sent: number; converted: number; conversion: number };
  guestPasses: { sold: number; activated: number; conversion: number };
  reactivation: { surveyed: number; returned: number; rate: number };
  mindfulPerActiveWeekly: number;
  themes: { pushSent: number; pushOpenRate: number; challengeJoined: number; challengeDone: number };
  courses: { sales: number; completions: number; rating: number | null };
  welcomes: { total: number; trainer: number; fallback: number; bookedAfterRate: number };
  greetings: { birthdayShare: number; sent: number; openRate: number; optOuts: Record<string, number> };
  revenueByMonth: { month: string; total: number; label: string }[];
};

const pct = (v: number | null, goal?: number) => (v === null ? '–' : <span style={goal !== undefined && v < goal ? { color: 'var(--danger)' } : undefined}>{v}%</span>);

export default function Analytics() {
  const { data } = useApi<A>('/owner/analytics');
  if (!data) return <Spinner />;
  const maxRev = Math.max(1, ...data.revenueByMonth.map((r) => r.total));
  return (
    <div className="stack-lg">
      <div>
        <h1>Analityka</h1>
        <p className="muted" style={{ margin: 0 }}>KPI z bazy wiedzy (sekcja 12). Na czerwono – poniżej celu.</p>
      </div>
      <div className="eyebrow">Retencja i aktywność</div>
      <div className="kpis">
        <Stat label="Retencja 30 dni" value={pct(data.retention.d30)} hint="aktywne po 30 dniach od dołączenia" />
        <Stat label="Retencja 60 dni" value={pct(data.retention.d60)} />
        <Stat label="Retencja 90 dni" value={pct(data.retention.d90)} />
        <Stat label="Aktywacja" value={pct(data.activation)} hint="pierwsze zajęcia w 7 dni" />
        <Stat label="Frekwencja" value={pct(data.attendanceRate, 85)} hint="cel > 85% rezerwacji" />
        <Stat label="Śr. wejść / 30 dni" value={data.avgVisits30} hint={`aktywne klientki: ${data.activeClients}`} />
      </div>
      <div className="eyebrow">Finanse</div>
      <div className="kpis">
        <Stat label="LTV" value={data.ltv} hint="średni przychód na klientkę" />
        <Stat label="ARPU (miesiąc)" value={data.arpu} hint="na aktywną klientkę" />
        <Stat label="NPS" value={data.nps ?? '–'} hint={`cel > 50 · odpowiedzi: ${data.npsResponses}`} />
      </div>
      <section className="card stack">
        <h3>Przychód – ostatnie 6 miesięcy</h3>
        <div className="bar-chart" style={{ height: 140, marginBottom: 20 }}>
          {data.revenueByMonth.map((r) => (
            <div key={r.month} style={{ height: `${(r.total / maxRev) * 100}%` }} title={r.label}>
              <span>{r.month.slice(5)}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="eyebrow">Wirusowość i reaktywacja</div>
      <div className="kpis">
        <Stat label="Zaproszenia / klientkę" value={data.invitations.perClient} hint={`wysłane ${data.invitations.sent}, konwersja ${data.invitations.conversion}%`} />
        <Stat label="Wejściówki" value={`${data.guestPasses.conversion}%`} hint={`aktywowane ${data.guestPasses.activated} z ${data.guestPasses.sold}`} />
        <Stat label="Reaktywacja" value={`${data.reactivation.rate}%`} hint={`wróciło ${data.reactivation.returned} z ${data.reactivation.surveyed} ankietowanych`} />
      </div>
      <div className="eyebrow">Dobrostan, motywy, kursy, relacje</div>
      <div className="kpis">
        <Stat label="Medytacje / tydzień" value={data.mindfulPerActiveWeekly} hint="na aktywną klientkę" />
        <Stat label="Motywy: otwarcia push" value={`${data.themes.pushOpenRate}%`} hint={`wyzwania: ${data.themes.challengeJoined} uczestniczek, ukończone ${data.themes.challengeDone}`} />
        <Stat label="Kursy" value={data.courses.sales} hint={`ukończenia ${data.courses.completions} · ocena ${data.courses.rating ?? '–'}`} />
        <Stat label="Powitania → zapis" value={`${data.welcomes.bookedAfterRate}%`} hint={`od trenerek ${data.welcomes.trainer}, od studia ${data.welcomes.fallback}`} />
        <Stat label="Data urodzin podana" value={pct(data.greetings.birthdayShare, 60)} hint={`cel > 60% · otwarcia życzeń ${data.greetings.openRate}%`} />
      </div>
      {Object.keys(data.greetings.optOuts).length > 0 && (
        <section className="card stack">
          <h3>Wyłączenia powiadomień (sygnał ostrzegawczy, gdy rośnie)</h3>
          {Object.entries(data.greetings.optOuts).map(([k, v]) => (
            <div key={k} className="row between small">
              <span>{k.replace('occasion:', 'okolicznościowe: ')}</span>
              <b>{v}</b>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
