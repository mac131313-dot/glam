// Studia w konsoli: lista z filtrami (trial / aktywne / zaległe / zawieszone) i karta wybranego studia (#studios/<id>).
// Filtr żyje tu, nad listą i kartą, więc po powrocie z karty lista wraca w tym samym widoku.
import { useState } from 'react';
import { plural } from '@glam/core';
import { useApi } from '../api.ts';
import { Empty, ListRow, Pending, Tabs } from '../ui.tsx';
import type { Go, PlatformRole } from './KonsolaApp.tsx';
import { StudioCard, studioState } from './StudioCard.tsx';

type Filter = '' | 'trial' | 'active' | 'past_due' | 'suspended';
type Signal = 'trial_ending' | 'past_due' | 'over_limit';
type StudioRow = { id: string; name: string; city: string | null; status: string; plan: string; clients: number; billingState: string; signals: Signal[] };

const FILTERS: [Filter, string][] = [
  ['', 'Wszystkie'],
  ['trial', 'Trial'],
  ['active', 'Aktywne'],
  ['past_due', 'Zaległe'],
  ['suspended', 'Zawieszone'],
];
const SIGNAL_LABEL: Record<Signal, string> = { trial_ending: 'trial się kończy', past_due: 'zaległa płatność', over_limit: 'ponad limitem' };

export function Studios({ role, studioId, go }: { role: PlatformRole; studioId: string | null; go: Go }) {
  const [filter, setFilter] = useState<Filter>('');
  if (studioId) return <StudioCard key={studioId} studioId={studioId} role={role} go={go} />;
  return (
    <div className="stack-lg">
      <div>
        <h1>Studia</h1>
        <p className="muted" style={{ margin: 0 }}>Wszystkie studia na platformie</p>
      </div>
      <Tabs label="Filtr studiów" value={filter} onChange={setFilter} options={FILTERS} />
      <StudioList key={filter} filter={filter} go={go} />
    </div>
  );
}

function StudioList({ filter, go }: { filter: Filter; go: Go }) {
  const { data, error, reload } = useApi<StudioRow[]>(`/platform/studios${filter ? `?filter=${filter}` : ''}`, [], { global: true });
  if (!data) return <Pending error={error} reload={reload} />;
  if (data.length === 0) return <Empty>Brak studiów w tym widoku.</Empty>;
  const state = (s: StudioRow) => studioState(s.status, s.billingState);
  return (
    <div className="list-rows">
      {data.map((s) => (
        <ListRow
          key={s.id}
          title={s.name}
          hint={[s.city, s.plan, `${s.clients} ${plural(s.clients, 'klientka', 'klientki', 'klientek')}`, ...s.signals.map((g) => SIGNAL_LABEL[g])].filter(Boolean).join(' · ')}
          badge={<span className={`badge ${state(s).tone}`}>{state(s).label}</span>}
          onClick={() => go(`studios/${s.id}`)}
        />
      ))}
    </div>
  );
}
