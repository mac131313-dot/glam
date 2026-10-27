// Mailing – nowości e-mailem do klientek ze zgodą i automat „Nowe zajęcia w grafiku”. Jeden ekran dla panelu
// i aplikacji recepcji (zakładka Wiadomości → Mailing), ułożony jak w telefonie: kafelki z liczbami, karta automatu
// z podglądem, pływający przycisk „Napisz” i historia; pisanie i edycja szablonu na pełnym ekranie z podglądem na żywo.
import { useRef, useState } from 'react';
import { fillMail, MAIL_PREVIEW_VARS, SEGMENT_LABEL } from '@glam/core';
import { api, fmtDay, useApi } from '../api.ts';
import { Icon } from '../icons.tsx';
import { Empty, Page, Sheet, Spinner, Toggle, useAction } from '../ui.tsx';
import './mailing.css';

type MailVar = { key: string; label: string; example: string };
type Auto = { enabled: boolean; subject: string; body: string };
type HistoryItem = { id: string; name: string; subject: string; body: string; auto: boolean; sent_at: string; recipients: number; delivered: number };
type Overview = {
  available: boolean;
  studioName: string;
  footer: string;
  counts: { clients: number; withEmail: number; subscribed: number };
  auto: Auto;
  defaults: Auto;
  vars: MailVar[];
  history: HistoryItem[];
};

export default function Mailing() {
  const data = useApi<Overview>('/staff/mailing');
  const [compose, setCompose] = useState(false);
  const [editAuto, setEditAuto] = useState(false);
  const [open, setOpen] = useState<HistoryItem | null>(null);
  const { run, busy } = useAction();
  if (data.error) return <Empty>Mailing nie jest dostępny w Twojej roli.</Empty>;
  if (!data.data) return <Spinner />;
  const d = data.data;
  const toggleAuto = (enabled: boolean) => run(() => api('/staff/mailing/auto', { method: 'PUT', body: { enabled } }).then(data.reload), enabled ? 'Automat włączony' : 'Automat wyłączony');

  return (
    <div className="mailing stack-lg">
      {!d.available && <p className="mail-note small">Wysyłka e-maili jest w planie „Studio” i wyższych. Szablon możesz przygotować już teraz.</p>}

      <div className="mail-stats" role="list">
        <MailStat label="Klientki" value={d.counts.clients} />
        <MailStat label="Z e-mailem" value={d.counts.withEmail} />
        <MailStat label="Chcą nowości" value={d.counts.subscribed} strong />
      </div>

      <section className="mail-auto">
        <div className="mail-auto-head">
          <span className="mail-auto-icon" aria-hidden>
            <Icon name="sparkle" size={20} />
          </span>
          <span className="grow">
            <span className="mail-auto-title">Nowe zajęcia w grafiku</span>
            <span className="small muted">Wysyła się sam, gdy dodasz zajęcia</span>
          </span>
          <input type="checkbox" role="switch" className="switch" aria-label="Automatyczny e-mail o nowych zajęciach" checked={d.auto.enabled} disabled={busy} onChange={(e) => toggleAuto(e.target.checked)} />
        </div>
        <MailPreview studio={d.studioName} subject={d.auto.subject} body={d.auto.body} compact />
        <button className="btn ghost block" onClick={() => setEditAuto(true)}>
          <Icon name="pen" size={18} /> Edytuj szablon
        </button>
      </section>

      <section className="stack">
        <div className="eyebrow">Wysłane</div>
        {d.history.length === 0 ? (
          <Empty>Tu pojawią się wysłane nowości i automatyczne e-maile.</Empty>
        ) : (
          <ul className="mail-history">
            {d.history.map((h) => (
              <li key={h.id}>
                <button className="mail-row" onClick={() => setOpen(h)}>
                  <span className={h.auto ? 'mail-row-icon is-auto' : 'mail-row-icon'} aria-hidden>
                    <Icon name={h.auto ? 'sparkle' : 'mail'} size={18} />
                  </span>
                  <span className="grow mail-row-text">
                    <span className="mail-row-subject">{h.auto ? h.name.replace(/^Automat: /, 'Nowe: ') : h.subject}</span>
                    <span className="tiny muted">
                      {fmtDay(h.sent_at)} · {h.recipients ? `do ${h.recipients} ${h.recipients === 1 ? 'klientki' : 'klientek'}` : 'nikt nie miał zgody'}
                    </span>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="mail-fab" onClick={() => setCompose(true)}>
        <Icon name="pen" size={20} /> Napisz nowość
      </button>

      {compose && <Compose data={d} onClose={() => setCompose(false)} onSent={() => (setCompose(false), data.reload())} />}
      {editAuto && <AutoEditor data={d} onClose={() => setEditAuto(false)} onSaved={() => (setEditAuto(false), data.reload())} />}
      {open && (
        <Sheet label="Wysłany e-mail" onClose={() => setOpen(null)}>
          <div className="stack">
            <div className="eyebrow">{open.auto ? 'Automat · nowe zajęcia' : 'Nowość'}</div>
            <MailPreview studio={d.studioName} subject={open.subject} body={open.body} vars={open.auto ? { zajęcia: open.name.replace(/^Automat: /, '') } : undefined} footer={d.footer} />
            <p className="small muted" style={{ margin: 0 }}>
              {fmtDay(open.sent_at)} · adresatki: {open.recipients}, doręczone: {open.delivered}. Wysyłamy tylko do osób ze zgodą; nocą e-mail czeka do rana.
            </p>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function MailStat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={strong ? 'mail-stat is-strong' : 'mail-stat'} role="listitem">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** Podgląd jak w skrzynce na telefonie – zmienne wypełnione przykładem. */
function MailPreview({ studio, subject, body, compact, footer, vars }: { studio: string; subject: string; body: string; compact?: boolean; footer?: string; vars?: Record<string, string> }) {
  const all = { ...MAIL_PREVIEW_VARS, studio, ...vars };
  return (
    <article className={compact ? 'mail-preview is-compact' : 'mail-preview'} aria-label="Podgląd e-maila">
      <header className="mail-preview-head">
        <span className="mail-avatar" aria-hidden>
          {studio.slice(0, 1)}
        </span>
        <span className="grow">
          <span className="mail-from">{studio}</span>
          <span className="tiny muted">do: Magda</span>
        </span>
        <span className="tiny muted">teraz</span>
      </header>
      <h3 className="mail-subject">{fillMail(subject, all) || 'Temat e-maila'}</h3>
      <div className="mail-body">{fillMail(body, all) || 'Treść pojawi się tutaj.'}</div>
      {footer && !compact && <p className="mail-footer">{footer}</p>}
    </article>
  );
}

/** Pole z pigułkami zmiennych – dotknięcie wstawia {zmienną} w miejscu kursora. */
function useVarInsert(value: string, onChange: (v: string) => void) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (key: string) => {
    const el = ref.current;
    const token = `{${key}}`;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    onChange(value.slice(0, at) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  return { ref, insert };
}

function VarChips({ vars, onPick }: { vars: MailVar[]; onPick: (key: string) => void }) {
  return (
    <div className="mail-vars" aria-label="Wstaw zmienną">
      {vars.map((v) => (
        <button key={v.key} type="button" className="mail-var" onClick={() => onPick(v.key)} title={v.label}>
          {`{${v.key}}`}
        </button>
      ))}
    </div>
  );
}

function Compose({ data, onClose, onSent }: { data: Overview; onClose: () => void; onSent: () => void }) {
  const [segment, setSegment] = useState('all');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('Cześć {imię}!\n\n');
  const [confirm, setConfirm] = useState(false);
  const reach = useApi<{ count: number }>(`/staff/mailing/audience?segment=${segment}`, [segment]);
  const { run, busy } = useAction();
  const { ref, insert } = useVarInsert(body, setBody);
  // W nowościach nie ma konkretnych zajęć – podpowiadamy tylko zmienne, które mają sens.
  const vars = data.vars.filter((v) => v.key === 'imię' || v.key === 'studio');
  const ready = subject.trim().length > 0 && body.replace(/\{imię\}|Cześć|[!\s]/g, '').length >= 10;
  const n = reach.data?.count ?? 0;
  const send = (test: boolean) =>
    run(async () => {
      const r = await api<{ message: string; recipients?: number }>('/staff/mailing/send', { method: 'POST', body: { subject, body, segment, test } });
      if (!test) onSent();
      return r;
    });

  return (
    <Page title="Nowość e-mailem" onBack={onClose} bodyClass="mailing">
      <div className="stack-lg">
        <div className="stack">
          <div className="eyebrow">Do kogo</div>
          <div className="chips scroll-row">
            {[['all', 'Wszystkie'], ...Object.entries(SEGMENT_LABEL)].map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={segment === k} onClick={() => setSegment(k)}>
                {l}
              </button>
            ))}
          </div>
          <span className="small muted">{reach.data ? `${n} ${n === 1 ? 'klientka' : 'klientek'} z e-mailem i zgodą na nowości` : 'Liczę…'}</span>
        </div>
        <label className="field">
          <span className="field-label">Temat</span>
          <input className="input" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} placeholder="Np. Listopad w studiu: nowe godziny i warsztaty" />
        </label>
        <label className="field">
          <span className="field-label">Treść</span>
          <textarea ref={ref} className="input mail-textarea" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
        </label>
        <VarChips vars={vars} onPick={insert} />
        <div className="stack">
          <div className="eyebrow">Tak zobaczy to klientka</div>
          <MailPreview studio={data.studioName} subject={subject} body={body} footer={data.footer} />
        </div>
        <div className="mail-actions">
          <button className="btn ghost" disabled={!ready || busy} onClick={() => send(true)}>
            Test do mnie
          </button>
          <button className="btn" disabled={!ready || busy || !data.available || n === 0} onClick={() => setConfirm(true)}>
            Wyślij
          </button>
        </div>
      </div>
      {confirm && (
        <Sheet label="Potwierdź wysyłkę" onClose={() => setConfirm(false)}>
          <div className="stack">
            <h2 style={{ margin: 0 }}>
              Wysłać do <span className="serif">{n}</span> {n === 1 ? 'klientki' : 'klientek'}?
            </h2>
            <p className="small muted" style={{ margin: 0 }}>
              „{subject.trim()}” · {segment === 'all' ? 'wszystkie ze zgodą' : SEGMENT_LABEL[segment as keyof typeof SEGMENT_LABEL]}. Wysłanego e-maila nie da się cofnąć.
            </p>
            <button className="btn block" disabled={busy} onClick={() => (setConfirm(false), send(false))}>
              Tak, wyślij
            </button>
            <button className="btn ghost block" onClick={() => setConfirm(false)}>
              Jeszcze nie
            </button>
          </div>
        </Sheet>
      )}
    </Page>
  );
}

function AutoEditor({ data, onClose, onSaved }: { data: Overview; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState(data.auto.subject);
  const [body, setBody] = useState(data.auto.body);
  const [enabled, setEnabled] = useState(data.auto.enabled);
  const { run, busy } = useAction();
  const { ref, insert } = useVarInsert(body, setBody);
  const missing = !body.includes('{zajęcia}');
  return (
    <Page title="Szablon: nowe zajęcia" onBack={onClose} bodyClass="mailing">
      <div className="stack-lg">
        <p className="small muted" style={{ margin: 0 }}>
          Gdy dodasz zajęcia do grafiku (stałe albo jednorazowe, publiczne), klientki ze zgodą na nowości dostaną ten e-mail. Zmienne w klamrach wypełnimy same.
        </p>
        <Toggle label="Wysyłaj automatycznie" checked={enabled} onChange={setEnabled} />
        <label className="field">
          <span className="field-label">Temat</span>
          <input className="input" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Treść</span>
          <textarea ref={ref} className="input mail-textarea" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
          {missing && <span className="tiny muted">Dodaj {'{zajęcia}'} – inaczej klientka nie dowie się, co nowego.</span>}
        </label>
        <VarChips vars={data.vars} onPick={insert} />
        <dl className="mail-var-legend">
          {data.vars.map((v) => (
            <div key={v.key}>
              <dt>{`{${v.key}}`}</dt>
              <dd>
                {v.label}, np. {v.example}
              </dd>
            </div>
          ))}
        </dl>
        <div className="stack">
          <div className="eyebrow">Podgląd</div>
          <MailPreview studio={data.studioName} subject={subject} body={body} footer={data.footer} />
        </div>
        <div className="mail-actions">
          <button className="btn ghost" onClick={() => (setSubject(data.defaults.subject), setBody(data.defaults.body))}>
            Przywróć domyślny
          </button>
          <button className="btn" disabled={busy || missing || !subject.trim()} onClick={() => run(() => api('/staff/mailing/auto', { method: 'PUT', body: { enabled, subject, body } }).then(onSaved), 'Szablon zapisany')}>
            Zapisz
          </button>
        </div>
      </div>
    </Page>
  );
}
