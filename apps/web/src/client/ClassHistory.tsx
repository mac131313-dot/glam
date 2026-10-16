// Historia zajęć z oceną (na dole Grafiku): ostatnie zapisy klientki, status i „oceń” po obecności.
import { useEffect, useState } from 'react';
import { api, ApiError, fmtDay, fmtTime, useApi } from '../api.ts';
import { Empty, Sheet, useToast } from '../ui.tsx';

type Booking = { id: string; status: string; starts_at: string; class_name: string; trainer_name: string; rating: number | null; guest_name: string | null };

const BOOKING_STATUS: Record<string, string> = {
  booked: 'zapisana',
  waitlist: 'lista oczekujących',
  attended: 'obecna ✓',
  cancelled: 'odwołana',
  late_cancel: 'odwołana po terminie',
  no_show: 'nieobecna',
};

export function ClassHistory() {
  const bookings = useApi<Booking[]>('/my/bookings');
  const [rate, setRate] = useState<string | null>(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const toast = useToast();

  // Zapis albo odwołanie w Grafiku od razu odświeża historię pod spodem.
  const reload = bookings.reload;
  useEffect(() => {
    window.addEventListener('glam:passes-changed', reload);
    return () => window.removeEventListener('glam:passes-changed', reload);
  }, [reload]);

  return (
    <section className="stack">
      <h2>Historia zajęć</h2>
      {bookings.data?.length === 0 && <Empty>Tu pojawią się Twoje zajęcia.</Empty>}
      {!!bookings.data?.length && (
        <div className="card flat">
          {bookings.data.slice(0, 12).map((b) => (
            <div key={b.id} className="row between small" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>
                <b>{b.class_name}</b> · {fmtDay(b.starts_at)} {fmtTime(b.starts_at)}
              </span>
              <span className="muted row" style={{ gap: 6 }}>
                {BOOKING_STATUS[b.status] ?? b.status}
                {b.status === 'attended' &&
                  !b.guest_name &&
                  (b.rating ? (
                    <span>{'★'.repeat(b.rating)}</span>
                  ) : (
                    <button className="link tiny" onClick={() => setRate(b.id)}>
                      oceń
                    </button>
                  ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {rate && (
        <Sheet onClose={() => setRate(null)} label="Oceń zajęcia">
          <div className="stack">
            <h2>Jak było?</h2>
            <div className="pill-row">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className="chip" aria-pressed={stars === n} onClick={() => setStars(n)}>
                  {'★'.repeat(n)}
                </button>
              ))}
            </div>
            <textarea className="input" placeholder="Kilka słów dla trenerki (opcjonalnie)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button
              className="btn block"
              onClick={async () => {
                try {
                  await api(`/bookings/${rate}/rate`, { method: 'POST', body: { rating: stars, comment } });
                  toast('Dziękujemy za ocenę');
                  setRate(null);
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
    </section>
  );
}
