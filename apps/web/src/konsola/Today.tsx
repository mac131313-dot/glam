// „Dziś” w konsoli: MRR i liczba płacących studiów oraz wszystko, co wymaga uwagi (triale, zaległości, limity,
// zgłoszenia po terminie, incydenty). Każda pozycja prowadzi do karty studia albo do Wsparcia.
import { useApi } from '../api.ts';
import { ListRow, Pending, Stat } from '../ui.tsx';
import type { Go, PlatformRole } from './KonsolaApp.tsx';

type Item = { id: string; name: string; hint: string };
type Overview = {
  mrr: string;
  paying: number;
  byPlan: { plan: string; studios: number; mrr: string }[];
  trialsEnding: Item[];
  pastDue: Item[];
  overLimit: Item[];
  overdueTickets: number;
  openIncidents: number;
};

export function Today({ role, go }: { role: PlatformRole; go: Go }) {
  const { data, error, reload } = useApi<Overview>('/platform/overview', [], { global: true });
  if (!data) return <Pending error={error} reload={reload} />;

  const lists: [string, Item[]][] = [
    ['Triale kończące się w 7 dni', data.trialsEnding],
    ['Zaległe płatności', data.pastDue],
    ['Studia ponad limitem planu', data.overLimit],
  ];
  // Wsparcie jest dla admina i wsparcia – finanse nie mają dokąd przejść, więc nie widzą tych liczników.
  const desk: [string, number][] = role === 'finance' ? [] : [['Zgłoszenia po terminie SLA', data.overdueTickets], ['Otwarte incydenty', data.openIncidents]];
  const openDesk = desk.filter(([, n]) => n > 0);
  const quiet = lists.every(([, items]) => items.length === 0) && openDesk.length === 0;

  return (
    <div className="stack-lg">
      <div>
        <h1>Dziś</h1>
        <p className="muted" style={{ margin: 0 }}>Jak się ma platforma</p>
      </div>

      <div className="kpis">
        <Stat label="MRR" value={data.mrr} hint={data.byPlan.map((p) => `${p.plan} ${p.studios}`).join(' · ')} />
        <Stat label="Płacące studia" value={data.paying} hint="z aktywnym abonamentem" />
      </div>

      {quiet && <p className="muted" style={{ margin: 0 }}>Nic nie wymaga uwagi.</p>}

      {lists
        .filter(([, items]) => items.length > 0)
        .map(([title, items]) => (
          <section key={title} className="stack gap-2">
            <h3>{title}</h3>
            <div className="list-rows">
              {items.map((s) => (
                <ListRow key={s.id} title={s.name} hint={s.hint} onClick={() => go(`studios/${s.id}`)} />
              ))}
            </div>
          </section>
        ))}

      {openDesk.length > 0 && (
        <section className="stack gap-2">
          <h3>Wsparcie</h3>
          <div className="list-rows">
            {openDesk.map(([title, n]) => (
              <ListRow key={title} title={title} badge={<span className="badge">{n}</span>} onClick={() => go('support')} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
