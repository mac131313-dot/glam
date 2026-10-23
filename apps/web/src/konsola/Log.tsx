// Dziennik konsoli (admin + wsparcie): ostatnie działania zespołu i wejścia w dane studiów, od najnowszych.
// Wpis ze studiem prowadzi do jego karty; reszta (zespół, incydenty) jest tylko do przeczytania.
import { fmtTime, useApi } from '../api.ts';
import { Empty, ListRow, Pending } from '../ui.tsx';
import { date, describeAudit } from './audit.ts';
import type { Go } from './KonsolaApp.tsx';

type Entry = { id: string; created_at: string; action: string; actor: string; studio_id: string | null; studio: string | null; details: Record<string, any> | null };

export function Log({ go }: { go: Go }) {
  const { data, error, reload } = useApi<Entry[]>('/platform/audit', [], { global: true });
  if (!data) return <Pending error={error} reload={reload} />;
  return (
    <div className="stack-lg">
      <div>
        <h1>Dziennik</h1>
        <p className="muted" style={{ margin: 0 }}>Co zespół zrobił w konsoli</p>
      </div>
      {data.length === 0 && <Empty>Dziennik jest pusty.</Empty>}
      <div className="list-rows">
        {data.map((e) => {
          const d = describeAudit(e.action, e.details);
          const hint = [d.detail, e.actor, e.studio].filter(Boolean).join(' · ');
          const stamp = <span className="small muted">{`${date(e.created_at)} ${fmtTime(e.created_at)}`}</span>;
          if (e.studio_id) return <ListRow key={e.id} title={d.title} hint={hint} badge={stamp} onClick={() => go(`studios/${e.studio_id}`)} />;
          return (
            <div key={e.id} className="list-row" style={{ cursor: 'default' }}>
              <span className="grow" style={{ textAlign: 'left' }}>
                <span className="card-title" style={{ display: 'block', fontSize: '1rem' }}>{d.title}</span>
                <span className="small muted">{hint}</span>
              </span>
              {stamp}
            </div>
          );
        })}
      </div>
    </div>
  );
}
