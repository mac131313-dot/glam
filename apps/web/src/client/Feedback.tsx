// Feedback: NPS po pierwszym miesiącu i co 10. trening (4.9, #33) oraz ankieta „Co się stało?” dla uśpionych (4.10).
// Empatyczny ton, bez presji – zawsze można pominąć.
import { useState } from 'react';
import { api, useApi } from '../api.ts';
import { Pending, Toggle, useAction, useThanks } from '../ui.tsx';
import type { RouteProps } from './router.tsx';

export default function FeedbackPages({ route, arg, close }: RouteProps) {
  return route === 'survey' ? <Dormant id={arg} onDone={close} /> : <Nps id={arg} onDone={close} />;
}

function Nps({ id, onDone }: { id: string | null; onDone: () => void }) {
  const home = useApi<{ nps: { id: string; trigger: string } | null }>(id ? null : '/home');
  const npsId = id ?? home.data?.nps?.id;
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const { run, busy } = useAction();
  const thanks = useThanks();
  if (!id && !home.data) return <Pending error={home.error} reload={home.reload} />;
  if (!npsId) return <p className="muted">Dziękujemy – nie mamy teraz pytań.</p>;
  return (
    <div className="stack-lg">
      <h2>Jak bardzo poleciłabyś nas przyjaciółce?</h2>
      <div className="mood" style={{ gridTemplateColumns: 'repeat(11, 1fr)' }}>
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} aria-pressed={score === n} onClick={() => setScore(n)}>
            {n}
          </button>
        ))}
      </div>
      <div className="row between tiny muted">
        <span>raczej nie</span>
        <span>na pewno</span>
      </div>
      <textarea className="input" placeholder="Co możemy zrobić lepiej? (opcjonalnie)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="row">
        <button className="btn ghost" onClick={() => run(() => api(`/nps/${npsId}/skip`, { method: 'POST' }).then(onDone))}>
          Pomiń
        </button>
        <button className="btn" disabled={score === null || busy} onClick={() => run(() => api(`/nps/${npsId}`, { method: 'POST', body: { score, comment } }).then((r) => (onDone(), thanks(), r)))}>
          Wyślij
        </button>
      </div>
    </div>
  );
}

const REASONS: [string, string][] = [
  ['time', 'Brak czasu'],
  ['health', 'Zdrowie'],
  ['price', 'Cena'],
  ['trainer', 'Trenerka / zajęcia'],
  ['other', 'Coś innego'],
];

function Dormant({ id, onDone }: { id: string | null; onDone: () => void }) {
  const home = useApi<{ survey: { id: string } | null }>(id ? null : '/home');
  const sid = id && id !== 'dormant' ? id : home.data?.survey?.id;
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [proposal, setProposal] = useState(false);
  const { run, busy } = useAction();
  if (!sid && !home.data) return <Pending error={home.error} reload={home.reload} />;
  if (!sid) return <p className="muted">Dobrze Cię widzieć 🌿</p>;
  return (
    <div className="stack-lg">
      <div>
        <h2>Dawno Cię nie widziałyśmy</h2>
        <p className="muted">Nie musisz się tłumaczyć – chcemy tylko wiedzieć, czy możemy jakoś pomóc. Wybierz do trzech odpowiedzi.</p>
      </div>
      <div className="pill-row">
        {REASONS.map(([v, l]) => (
          <button key={v} className="chip" aria-pressed={reasons.includes(v)} onClick={() => setReasons(reasons.includes(v) ? reasons.filter((x) => x !== v) : reasons.length < 3 ? [...reasons, v] : reasons)}>
            {l}
          </button>
        ))}
      </div>
      <textarea className="input" placeholder="Chcesz coś dodać? (opcjonalnie)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <Toggle label="Zaproponuj mi termin" hint="Recepcja odezwie się w ciągu 24 godzin" checked={proposal} onChange={setProposal} />
      <button className="btn" disabled={busy} onClick={() => run(() => api(`/surveys/dormant/${sid}`, { method: 'POST', body: { reasons, comment, wantsProposal: proposal } }).then((r) => (onDone(), r)))}>
        Wyślij
      </button>
    </div>
  );
}
