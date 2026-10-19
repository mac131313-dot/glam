// Historia płatności studia (Profil recepcji): ostatnie 30 dni, najnowsze na górze, pogrupowane po dniach.
// Same wpłaty, bez sum przychodu – podsumowania finansów są w panelu właścicielki.
import { fmtLongDay, fmtTime, localDate, useApi } from '../api.ts';
import { Empty, Page, PAYMENT_LABELS, Pending } from '../ui.tsx';

type Payment = { id: string; kind: string; amount: string; method: string; status: string; created_at: string; description: string | null; name: string | null; refunded: string | null };

const KIND: Record<string, string> = { pass: 'Karnet', renewal: 'Odnowienie', guest_pass: 'Wejściówka', course: 'Kurs', event: 'Wydarzenie', shop: 'Sklep' };
const STATUS: Record<string, string> = { voided: 'cofnięta', failed: 'nieudana', pending: 'w toku', refunded: 'zwrócona' };

export function PaymentsPage({ onBack }: { onBack: () => void }) {
  const list = useApi<{ payments: Payment[]; more: boolean }>('/staff/payments?days=30');
  const days: { date: string; items: Payment[] }[] = [];
  for (const p of list.data?.payments ?? []) {
    const d = localDate(new Date(p.created_at));
    const last = days[days.length - 1];
    if (last?.date === d) last.items.push(p);
    else days.push({ date: d, items: [p] });
  }

  return (
    <Page title="Historia płatności" onBack={onBack}>
      {!list.data ? (
        <Pending error={list.error} reload={list.reload} />
      ) : days.length === 0 ? (
        <Empty>W ostatnich 30 dniach nie było płatności.</Empty>
      ) : (
        <div className="stack-lg">
          {list.data.more && <p className="small muted" style={{ margin: 0 }}>Pokazujemy 200 najnowszych wpłat. Starsze znajdziesz w panelu studia (Finanse → eksport CSV).</p>}
          {days.map((g) => (
            <section key={g.date} className="stack gap-2">
              <div className="eyebrow" style={{ margin: 0 }}>{g.date === localDate() ? 'Dziś' : fmtLongDay(g.items[0].created_at)}</div>
              {g.items.map((p) => {
                const off = p.status !== 'paid';
                return (
                  <div key={p.id} className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, alignItems: 'flex-start', opacity: off ? 0.55 : 1 }}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{p.name ?? 'Sprzedaż przy ladzie'}</div>
                      <div className="tiny muted">
                        {p.description ?? KIND[p.kind] ?? p.kind} · {PAYMENT_LABELS[p.method] ?? p.method} · {fmtTime(p.created_at)}
                      </div>
                      {p.refunded && <div className="tiny" style={{ color: 'var(--danger)' }}>zwrot {p.refunded}</div>}
                    </div>
                    <div className="stack gap-1" style={{ alignItems: 'flex-end', flex: 'none' }}>
                      <b style={{ fontVariantNumeric: 'tabular-nums', textDecoration: off ? 'line-through' : undefined }}>{p.amount}</b>
                      {off && <span className="badge">{STATUS[p.status] ?? p.status}</span>}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
