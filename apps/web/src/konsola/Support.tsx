// Wsparcie w konsoli: zgłoszenia właścicielek posortowane przez API (otwarte wg terminu SLA, zamknięte na końcu)
// z wątkiem, odpowiedzią i zamknięciem, oraz incydenty ze strony statusu usług (zgłoś, rozwiąż).
import { useState } from 'react';
import { api, fmtTime, useApi } from '../api.ts';
import { Empty, Field, ListRow, Pending, Select, Sheet, Tabs, useAction } from '../ui.tsx';
import { date, INCIDENT_STATUS } from './audit.ts';

type Ticket = { id: string; subject: string; studio: string; author: string; priority: string; status: string; sla_due_at: string; overdue: number };
type Message = { body: string; from_platform: number; created_at: string; name: string };
type Thread = { ticket: { status: string; data_access_granted: number }; messages: Message[] };
type Status = {
  components: { name: string; status: string }[];
  incidents: { id: string; component: string; status: string; note: string; started_at: string; resolved_at: string | null }[];
};
type View = 'tickets' | 'incidents';

const VIEWS: [View, string][] = [
  ['tickets', 'Zgłoszenia'],
  ['incidents', 'Incydenty'],
];
const PRIORITY: Record<string, string> = { low: 'niski priorytet', normal: 'normalny priorytet', high: 'wysoki priorytet', urgent: 'pilne' };
const TICKET_STATUS: Record<string, string> = { open: 'Otwarte', answered: 'Odpowiedziane', closed: 'Zamknięte' };
const when = (iso: string) => `${date(iso)} ${fmtTime(iso)}`;

export function Support() {
  const [view, setView] = useState<View>('tickets');
  return (
    <div className="stack-lg">
      <div>
        <h1>Wsparcie</h1>
        <p className="muted" style={{ margin: 0 }}>Zgłoszenia właścicielek i stan usług</p>
      </div>
      <Tabs label="Widok wsparcia" value={view} onChange={setView} options={VIEWS} />
      {view === 'tickets' ? <Tickets /> : <Incidents />}
    </div>
  );
}

function Tickets() {
  const { data, error, reload } = useApi<Ticket[]>('/platform/tickets', [], { global: true });
  const [open, setOpen] = useState<Ticket | null>(null);
  if (!data) return <Pending error={error} reload={reload} />;
  if (data.length === 0) return <Empty>Brak zgłoszeń.</Empty>;
  return (
    <>
      <div className="list-rows">
        {data.map((t) => (
          <ListRow
            key={t.id}
            title={t.subject}
            hint={[t.studio, PRIORITY[t.priority] ?? t.priority, t.status === 'closed' ? null : `odpowiedź do ${when(t.sla_due_at)}`].filter(Boolean).join(' · ')}
            badge={<span className={t.overdue ? 'badge warn' : 'badge'}>{t.overdue ? 'po terminie' : (TICKET_STATUS[t.status] ?? t.status)}</span>}
            onClick={() => setOpen(t)}
          />
        ))}
      </div>
      {open && <TicketSheet ticket={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

/** Wątek zgłoszenia: odpowiedź albo zamknięcie (z odpowiedzią, jeśli coś wpisano). Odpowiedź zmienia status na „odpowiedziane”. */
function TicketSheet({ ticket, onClose, onChanged }: { ticket: Ticket; onClose: () => void; onChanged: () => unknown }) {
  const id = ticket.id;
  const { data, error, reload } = useApi<Thread>(`/platform/tickets/${id}`, [], { global: true });
  const [reply, setReply] = useState('');
  const { run, busy } = useAction();
  const text = reply.trim();

  const send = async (close: boolean) => {
    const done = await run(() => api(`/platform/tickets/${id}`, { method: 'POST', body: { body: text || undefined, close }, global: true }), close ? 'Zgłoszenie zamknięte' : 'Odpowiedź wysłana');
    if (done === undefined) return;
    setReply('');
    await onChanged();
    if (close) onClose();
    else await reload();
  };

  return (
    <Sheet onClose={onClose} label="Zgłoszenie">
      {!data ? (
        <Pending error={error} reload={reload} />
      ) : (
        <div className="stack">
          <div>
            <h2 style={{ marginBottom: 0 }}>{ticket.subject}</h2>
            <p className="small muted" style={{ margin: 0 }}>
              {ticket.studio} · {ticket.author}
              {data.ticket.data_access_granted ? ' · zgoda na wgląd w dane studia na czas zgłoszenia' : ''}
            </p>
          </div>
          <div className="stack gap-2">
            {data.messages.map((m, i) => (
              <div key={i} className={`chat-bubble ${m.from_platform ? 'me' : ''}`}>
                <span className="tiny">{m.from_platform ? `GLAM · ${m.name}` : m.name}</span>
                <div className="small">{m.body}</div>
                <span className="tiny">{when(m.created_at)}</span>
              </div>
            ))}
          </div>
          {data.ticket.status === 'closed' ? (
            <p className="small muted" style={{ margin: 0 }}>Zgłoszenie jest zamknięte.</p>
          ) : (
            <>
              <Field label="Odpowiedź">
                <textarea className="input" rows={3} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)} />
              </Field>
              <div className="row wrap">
                <button className="btn" disabled={!text || busy} onClick={() => send(false)}>
                  Wyślij
                </button>
                <button className="btn quiet" disabled={busy} onClick={() => send(true)}>
                  {text ? 'Wyślij i zamknij' : 'Zamknij zgłoszenie'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Incidents() {
  const { data, error, reload } = useApi<Status>('/status', [], { global: true });
  const [reporting, setReporting] = useState(false);
  const { run, busy } = useAction();
  if (!data) return <Pending error={error} reload={reload} />;
  const open = data.incidents.filter((i) => !i.resolved_at);
  const past = data.incidents.filter((i) => i.resolved_at);

  return (
    <>
      <section className="stack gap-2">
        <div className="row between">
          <h3>Stan usług</h3>
          <button className="btn quiet sm" onClick={() => setReporting(true)}>
            Zgłoś incydent
          </button>
        </div>
        <div>
          {data.components.map((c) => (
            <div key={c.name} className="konsola-line">
              <span>{c.name}</span>
              <span className={c.status === 'operational' ? 'badge ok' : 'badge warn'}>{INCIDENT_STATUS[c.status] ?? c.status}</span>
            </div>
          ))}
        </div>
      </section>

      {open.length > 0 && (
        <section className="stack gap-2">
          <h3>Otwarte incydenty</h3>
          <div>
            {open.map((i) => (
              <div key={i.id} className="konsola-line">
                <span>
                  {i.component} · {INCIDENT_STATUS[i.status] ?? i.status}
                  <span className="small muted" style={{ display: 'block' }}>
                    {i.note} · od {when(i.started_at)}
                  </span>
                </span>
                <button
                  className="btn quiet sm"
                  disabled={busy}
                  onClick={async () => {
                    if ((await run(() => api(`/platform/incidents/${i.id}/resolve`, { method: 'POST', global: true }), 'Incydent rozwiązany')) !== undefined) await reload();
                  }}
                >
                  Rozwiąż
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {open.length === 0 && <p className="muted" style={{ margin: 0 }}>Brak otwartych incydentów.</p>}

      {past.length > 0 && (
        <section className="stack gap-2">
          <h3>Ostatnie 30 dni</h3>
          <div>
            {past.map((i) => (
              <div key={i.id} className="konsola-line">
                <span>
                  {i.component} · {INCIDENT_STATUS[i.status] ?? i.status}
                  <span className="small muted" style={{ display: 'block' }}>{i.note}</span>
                </span>
                <span className="small muted">{date(i.started_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {reporting && <ReportSheet components={data.components.map((c) => c.name)} onClose={() => setReporting(false)} onDone={reload} />}
    </>
  );
}

const REPORTABLE = ['degraded', 'outage', 'maintenance'] as const;

function ReportSheet({ components, onClose, onDone }: { components: string[]; onClose: () => void; onDone: () => unknown }) {
  const [component, setComponent] = useState(components[0]);
  const [status, setStatus] = useState<(typeof REPORTABLE)[number]>('degraded');
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  return (
    <Sheet onClose={onClose} label="Zgłoszenie incydentu">
      <div className="stack">
        <h2>Zgłoś incydent</h2>
        <p className="small muted" style={{ margin: 0 }}>Pojawi się na publicznej stronie statusu, dopóki go nie rozwiążesz.</p>
        <div className="field">
          <span className="field-label">Komponent</span>
          <Select ariaLabel="Komponent" value={component} options={components.map((c) => ({ value: c, label: c }))} onChange={setComponent} />
        </div>
        <Tabs label="Status" value={status} onChange={setStatus} options={REPORTABLE.map((s) => [s, INCIDENT_STATUS[s]] as [(typeof REPORTABLE)[number], string])} />
        <Field label="Opis dla klientów">
          <textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button
          className="btn"
          disabled={!note.trim() || busy}
          onClick={async () => {
            const done = await run(() => api('/platform/incidents', { method: 'POST', body: { component, status, note: note.trim() }, global: true }), 'Incydent zgłoszony');
            if (done === undefined) return;
            await onDone();
            onClose();
          }}
        >
          Zgłoś
        </button>
      </div>
    </Sheet>
  );
}
