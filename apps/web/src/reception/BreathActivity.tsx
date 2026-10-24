// Klientki (Profil recepcji): najnowsze sesje oddechu i medytacji z aplikacji z ostatnich 30 dni,
// pogrupowane po dniach – recepcja widzi, kto ostatnio ćwiczył oddech, i może o tym zagadać przy ladzie.
import { patternById, sessionById } from '@glam/core';
import { fmtLongDay, fmtMinutes, fmtTime, localDate, useApi } from '../api.ts';
import { Avatar, Empty, Page, Pending } from '../ui.tsx';

type Session = { id: string; userId: string; name: string | null; kind: 'breath' | 'meditation'; ref: string | null; minutes: number; completedAt: string };

const title = (s: Session) => (s.kind === 'meditation' ? (sessionById(s.ref ?? '')?.title ?? 'Medytacja') : patternById(s.ref ?? '').label);

export function BreathActivityPage({ onBack }: { onBack: () => void }) {
  const list = useApi<{ sessions: Session[]; more: boolean }>('/staff/breath-activity?days=30');
  const days: { date: string; items: Session[] }[] = [];
  for (const s of list.data?.sessions ?? []) {
    const d = localDate(new Date(s.completedAt));
    const last = days[days.length - 1];
    if (last?.date === d) last.items.push(s);
    else days.push({ date: d, items: [s] });
  }

  return (
    <Page title="Klientki" onBack={onBack}>
      {!list.data ? (
        <Pending error={list.error} reload={list.reload} />
      ) : days.length === 0 ? (
        <Empty>W ostatnich 30 dniach żadna klientka nie ćwiczyła oddechu w aplikacji.</Empty>
      ) : (
        <div className="stack-lg">
          <p className="small muted" style={{ margin: 0 }}>Najnowsze treningi oddechowe i medytacje klientek w aplikacji.</p>
          {list.data.more && <p className="small muted" style={{ margin: 0 }}>Pokazujemy 200 najnowszych sesji.</p>}
          {days.map((g) => (
            <section key={g.date} className="stack gap-2">
              <div className="eyebrow" style={{ margin: 0 }}>{g.date === localDate() ? 'Dziś' : fmtLongDay(g.items[0].completedAt)}</div>
              {g.items.map((s) => (
                <div key={s.id} className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <Avatar name={s.name} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{s.name ?? 'Klientka'}</div>
                    <div className="tiny muted">
                      {title(s)} · {fmtMinutes(Math.max(1, Math.round(s.minutes)))}
                    </div>
                  </div>
                  <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{fmtTime(s.completedAt)}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
