// Historia zajęć z oceną (na dole Grafiku): trzy ostatnie zajęcia, na których klientka była, i ocena gwiazdką.
import { useEffect, useState } from 'react';
import { api, ApiError, fmtDateParts, fmtTime, useApi } from '../api.ts';
import { Icon } from '../icons.tsx';
import { Empty, Fold, Sheet, useThanks, useToast } from '../ui.tsx';

type Booking = { id: string; status: string; starts_at: string; class_name: string; trainer_name: string; rating: number | null; guest_name: string | null };

const BOOKING_STATUS: Record<string, string> = {
  booked: 'zapisana',
  waitlist: 'lista oczekujących',
  attended: 'obecna',
  cancelled: 'odwołana',
  late_cancel: 'odwołana po terminie',
  no_show: 'nieobecna',
};

const STAR_PATH = 'm12 3.6 2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.62l-5.1 2.68.97-5.68-4.12-4.02 5.7-.83z';

/** Pojedyncza gwiazdka: pełna albo obrys – ten sam kształt, więc ocena nie „skacze” przy wypełnianiu. */
function Star({ filled, size = 14 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
      <path d={STAR_PATH} />
    </svg>
  );
}

export function ClassHistory() {
  const bookings = useApi<Booking[]>('/my/bookings');
  const [rate, setRate] = useState<string | null>(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const toast = useToast();
  const thanks = useThanks();

  // Zapis albo odwołanie w Grafiku od razu odświeża historię pod spodem.
  const reload = bookings.reload;
  useEffect(() => {
    window.addEventListener('glam:passes-changed', reload);
    return () => window.removeEventListener('glam:passes-changed', reload);
  }, [reload]);

  // Tylko trzy ostatnie zajęcia, na których klientka była (bez zapisów, odwołań i miejsc gościa).
  const last = (bookings.data ?? []).filter((b) => b.status === 'attended' && !b.guest_name).slice(0, 3);
  // Zwinięta domyślnie – w nagłówku tylko to, co ważne: ile z nich czeka na ocenę.
  const toRate = last.filter((b) => !b.rating).length;
  return (
    <>
      <Fold title="Historia zajęć" meta={toRate ? `${toRate} do oceny` : ''}>
      {bookings.data && last.length === 0 && <Empty>Tu pojawią się zajęcia, na których byłaś.</Empty>}
      {last.length > 0 && (
        <ul className="card flat history">
          {last.map((b) => {
            const d = fmtDateParts(b.starts_at);
            const attended = b.status === 'attended';
            const rateable = attended && !b.guest_name;
            return (
              <li key={b.id} className={`history-row is-${b.status}`}>
                <span className="history-date" aria-hidden>
                  <b>{d.day}</b>
                  {d.month}
                </span>
                <span className="history-main">
                  <b>{b.class_name}</b>
                  <span className="history-meta">
                    {d.weekday} · {fmtTime(b.starts_at)}
                    {b.trainer_name && <> · {b.trainer_name}</>}
                  </span>
                </span>
                <span className="history-end">
                  {!attended && <span className="history-status">{BOOKING_STATUS[b.status] ?? b.status}</span>}
                  {attended && !rateable && (
                    <span className="history-status is-done">
                      <Icon name="check" size={14} /> obecna
                    </span>
                  )}
                  {rateable &&
                    (b.rating ? (
                      <span className="history-stars" role="img" aria-label={`Twoja ocena: ${b.rating} z 5`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} filled={n <= b.rating!} size={13} />
                        ))}
                      </span>
                    ) : (
                      <button
                        className="history-rate"
                        aria-label={`Oceń ${b.class_name}`}
                        onClick={() => {
                          setStars(5);
                          setRate(b.id);
                        }}
                      >
                        <Star filled={false} size={16} />
                        <span>Oceń</span>
                      </button>
                    ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      </Fold>

      {rate && (
        <Sheet onClose={() => setRate(null)} label="Oceń zajęcia">
          <div className="stack">
            <h2>Jak było?</h2>
            <div className="rate-stars" role="radiogroup" aria-label="Ocena">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} role="radio" aria-checked={stars === n} aria-label={`${n} z 5`} className={n <= stars ? 'is-on' : ''} onClick={() => setStars(n)}>
                  <Star filled={n <= stars} size={34} />
                </button>
              ))}
            </div>
            <textarea className="input" placeholder="Kilka słów dla trenerki (opcjonalnie)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button
              className="btn block"
              onClick={async () => {
                try {
                  await api(`/bookings/${rate}/rate`, { method: 'POST', body: { rating: stars, comment } });
                  setRate(null);
                  thanks();
                  setComment('');
                  bookings.reload();
                } catch (e) {
                  toast((e as ApiError).message, 'error');
                }
              }}
            >
              Wyślij
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
