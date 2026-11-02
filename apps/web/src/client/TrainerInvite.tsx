// Zaproszenie trenerki na jej zajęcia – karta na ekranie Start i w profilu trenerki (osobny plik, żeby Start
// nie ciągnął całej podstrony profilu, ładowanej leniwie przez router).
import { api, fmtDay, fmtTime } from '../api.ts';
import { useAction } from '../ui.tsx';

export type TrainerInvite = {
  id: string;
  body: string;
  trainerId: string;
  trainerName: string;
  sessionId: string;
  startsAt: string;
  className: string;
  zone: string;
  photoUrl: string | null;
  spotsLeft: number;
  myStatus: 'booked' | 'waitlist' | null;
};

/** Karta zaproszenia: termin, notka trenerki i zapis (albo stan zapisu). Używana też na ekranie Start. */
export function InviteCard({ invite: i, onChange, showTrainer = true, onTrainer }: { invite: TrainerInvite; onChange: () => void; showTrainer?: boolean; onTrainer?: () => void }) {
  const { run, busy } = useAction();
  const book = () => run(() => api('/bookings', { method: 'POST', body: { sessionId: i.sessionId } }).then((r) => (onChange(), window.dispatchEvent(new Event('glam:passes-changed')), r)));
  return (
    <div className="card flat stack gap-2">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <b>
          {i.className} <span className="serif">{fmtTime(i.startsAt)}</span>
        </b>
        <span className="small muted">{fmtDay(i.startsAt)}</span>
      </div>
      <p className="serif" style={{ margin: 0, fontSize: '1.1rem', lineHeight: 1.4 }}>
        „{i.body}”
      </p>
      <div className="row between gap-2" style={{ alignItems: 'center' }}>
        {showTrainer ? (
          <button className="text-btn small" onClick={onTrainer}>
            — {i.trainerName}
          </button>
        ) : (
          <span className="small muted">{i.zone}</span>
        )}
        {i.myStatus === 'booked' ? (
          <span className="badge">Jesteś zapisana ✓</span>
        ) : i.myStatus === 'waitlist' ? (
          <span className="badge">Na liście rezerwowej</span>
        ) : (
          <button className="btn sm" disabled={busy} onClick={book}>
            {i.spotsLeft > 0 ? 'Zapisz się' : 'Lista rezerwowa'}
          </button>
        )}
      </div>
    </div>
  );
}
