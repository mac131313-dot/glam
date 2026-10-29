// Notatki zespołu: myśli dla kolejnej osoby w studiu („zrobić faktury za kwiecień”, „zrobić kartki”). Zostawiane na Starcie
// recepcji, wyskakują w prawym górnym rogu zaraz po wejściu do aplikacji recepcji albo do panelu, pełna lista – w
// Wiadomości → Dla mnie. X = załatwione: notatka znika z okienka i listy otwartych, zostaje w historii z podpisem.
import { useEffect, useId, useState } from 'react';
import { api, fmtTime, useApi } from '../api.ts';
import { Icon } from '../icons.tsx';
import { Spinner, useAction } from '../ui.tsx';

export type TeamNote = { id: string; body: string; author: string | null; created_at: string; done_at: string | null; done_by: string | null };
type Notes = { open: TeamNote[]; done: TeamNote[] };
const NOTE_LIMIT = 600;
/** Ile notatek naraz w okienku po wejściu – reszta czeka w „Dla mnie”. */
const POP_MAX = 3;
/** Notatki zmieniły się w innym miejscu ekranu – pozostałe widoki pobierają je od nowa. */
const CHANGED = 'glam:team-notes';
/** Autorka nie dostaje własnej notatki w okienku – zapamiętujemy, co już zna (ta karta przeglądarki). */
const SEEN_KEY = 'glam.teamNotes.seen';

const seenIds = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]');
  } catch {
    return [];
  }
};
const markSeen = (id: string) => {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seenIds(), id]));
  } catch {
    /* bez pamięci sesji okienko pokaże się raz więcej – nic się nie stanie */
  }
};

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const fmtWhen = (iso: string) => (isToday(iso) ? `dziś, ${fmtTime(iso)}` : `${new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}, ${fmtTime(iso)}`);
const byline = (n: TeamNote) => `${fmtWhen(n.created_at)}${n.author ? ` · ${n.author}` : ''}`;

/** Notatki z serwera, odświeżane, gdy ktoś coś zmieni w innym miejscu ekranu. */
function useTeamNotes() {
  const notes = useApi<Notes>('/staff/team-notes');
  const reload = notes.reload;
  useEffect(() => {
    window.addEventListener(CHANGED, reload);
    return () => window.removeEventListener(CHANGED, reload);
  }, [reload]);
  return notes;
}
const changed = () => window.dispatchEvent(new Event(CHANGED));

/** X przy notatce: załatwione (dla wszystkich). */
function useDone() {
  const { run } = useAction();
  return (n: TeamNote) => run(() => api(`/staff/team-notes/${n.id}/done`, { method: 'POST' }).then(changed), 'Załatwione');
}

/** Okienka w rogu ekranu po wejściu – każda otwarta notatka osobno, z własnym X. */
export function ShiftNotePopup() {
  const notes = useApi<Notes>('/staff/team-notes');
  const done = useDone();
  const [closed, setClosed] = useState<string[]>([]);
  const [seen] = useState(seenIds);
  const shown = (notes.data?.open ?? []).filter((n) => !seen.includes(n.id) && !closed.includes(n.id)).slice(0, POP_MAX);
  if (!shown.length) return null;
  return (
    <div className="note-pops" role="status" aria-label="Notatki od zespołu">
      {shown.map((n) => (
        <aside key={n.id} className="note-pop">
          <button
            className="note-pop-x"
            onClick={() => {
              setClosed((c) => [...c, n.id]);
              done(n);
            }}
            aria-label={`Załatwione: ${n.body}`}
          >
            <Icon name="close" size={16} />
          </button>
          <span className="note-pop-kicker">Notatka od zespołu</span>
          <p className="note-pop-body">{n.body}</p>
          <span className="note-pop-meta">{byline(n)}</span>
        </aside>
      ))}
    </div>
  );
}

/** Jedno cienkie pole na Starcie recepcji: wpisz i wyślij – można zostawić kilka notatek, lista jest w „Dla mnie”. */
export function ShiftNoteComposer({ onOpenList }: { onOpenList?: () => void }) {
  const notes = useTeamNotes();
  const { run, busy } = useAction();
  const [text, setText] = useState('');
  const fieldId = useId();
  const open = notes.data?.open.length ?? 0;
  const save = () =>
    run(async () => {
      const r = await api<{ id: string }>('/staff/team-notes', { method: 'POST', body: { body: text } });
      markSeen(r.id);
      setText('');
      changed();
    }, 'Notatka zostawiona');
  return (
    <div className="stack gap-2">
      <form
        className="note-line is-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) save();
        }}
      >
        <label htmlFor={fieldId} className="sr-only">
          Notatka dla zespołu
        </label>
        <Icon name="pen" size={16} />
        <input id={fieldId} className="grow" maxLength={NOTE_LIMIT} value={text} onChange={(e) => setText(e.target.value)} placeholder="Zostaw notatkę dla zespołu…" />
        {text.trim() && (
          <button className="note-line-send" type="submit" disabled={busy} aria-label="Zostaw notatkę">
            <Icon name="chevron" size={16} />
          </button>
        )}
      </form>
      {open > 0 && onOpenList && (
        <button className="note-count" onClick={onOpenList}>
          {open === 1 ? '1 otwarta notatka' : `${open} otwarte notatki`} · Wiadomości › Dla mnie
          <Icon name="chevron" size={14} />
        </button>
      )}
    </div>
  );
}

/** Wiadomości → Dla mnie: wszystkie otwarte notatki zespołu i załatwione z ostatnich 7 dni (kto i kiedy zamknął). */
export function TeamNotesList() {
  const notes = useTeamNotes();
  const done = useDone();
  const [showDone, setShowDone] = useState(false);
  if (!notes.data) return notes.error ? null : <Spinner />;
  const { open, done: closed } = notes.data;
  return (
    <section className="stack gap-4">
      {/* Nową notatkę zostawia się na Starcie recepcji – tu tylko lista. */}
      <div className="team-notes-head">
        <span className="eyebrow">Do zrobienia</span>
        {open.length > 0 && <span className="team-notes-count">{open.length}</span>}
      </div>
      {open.length === 0 ? (
        <div className="team-notes-empty">
          <span className="nudge-icon">
            <Icon name="check" size={18} />
          </span>
          <span className="grow">
            <span className="nudge-title">Wszystko załatwione</span>
            <span className="small muted">Nową notatkę zostawisz na Starcie.</span>
          </span>
        </div>
      ) : (
        <div className="team-notes">
          {open.map((n) => (
            <div key={n.id} className="team-note">
              <span className="team-note-dot" aria-hidden />
              <span className="grow">
                <span className="team-note-body">{n.body}</span>
                <span className="tiny muted">{byline(n)}</span>
              </span>
              <button className="team-note-done" onClick={() => done(n)} aria-label={`Załatwione: ${n.body}`}>
                <Icon name="check" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {closed.length > 0 && (
        <>
          <button className="team-notes-toggle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            <span className="eyebrow">Załatwione · 7 dni</span>
            <span className="team-notes-count is-soft">{closed.length}</span>
            <span className="grow" />
            <Icon name={showDone ? 'down' : 'chevron'} size={16} />
          </button>
          {showDone && (
            <div className="team-notes is-done">
              {closed.map((n) => (
                <div key={n.id} className="team-note">
                  <span className="grow">
                    <span className="team-note-body">{n.body}</span>
                    <span className="tiny muted">
                      Załatwione {fmtWhen(n.done_at!)}
                      {n.done_by ? ` · ${n.done_by}` : ''}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
