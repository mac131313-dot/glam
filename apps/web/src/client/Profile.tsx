// Profil (3: zakładka 5): karnety, menu podstron (wiadomości, płatności, lojalność, kursy, zdrowie, ustawienia), historia z oceną zajęć.
import { useEffect, useState } from 'react';
import { api, ApiError, DEMO_MODE, fmtDay, fmtPhone, fmtTime, useApi } from '../api.ts';
import { Avatar, Empty, ListRow, Sheet, useToast } from '../ui.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';

type Pass = { id: string; productName: string; status: string; summary: string; expiringSoon: boolean; autoRenew?: boolean };
type Booking = { id: string; status: string; starts_at: string; class_name: string; trainer_name: string; rating: number | null; guest_name: string | null };

const BOOKING_STATUS: Record<string, string> = {
  booked: 'zapisana',
  waitlist: 'lista oczekujących',
  attended: 'obecna ✓',
  cancelled: 'odwołana',
  late_cancel: 'odwołana po terminie',
  no_show: 'nieobecna',
};

export function Profile() {
  const { me, studio, openShop, onSwitchStudio, onLogout, open } = useClient();
  const [rate, setRate] = useState<string | null>(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const passes = useApi<Pass[]>('/my/passes');
  const bookings = useApi<Booking[]>('/my/bookings');
  // Liczba nieprzeczytanych z /home – samo otwarcie skrzynki oznacza wiadomości jako przeczytane.
  const home = useApi<{ unread: number }>('/home');
  const toast = useToast();

  const reloadPasses = passes.reload;
  useEffect(() => {
    window.addEventListener('glam:passes-changed', reloadPasses);
    return () => window.removeEventListener('glam:passes-changed', reloadPasses);
  }, [reloadPasses]);



  return (
    <div className="stack-lg">
      <section className="row">
        <Avatar name={me.user.name} />
        <div>
          <h1 className="serif" style={{ margin: 0, fontSize: '2.2rem' }}>{me.user.name ?? 'Twój profil'}</h1>
          <div className="muted small">{fmtPhone(me.user.phone)}</div>
        </div>
      </section>

      <section className="stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Karnety</h2>
          <button className="btn sm" onClick={() => openShop()}>
            Kup karnet
          </button>
        </div>
        {passes.data?.length === 0 && <Empty icon="🎟️">Nie masz jeszcze karnetu w tym studiu.</Empty>}
        {passes.data?.map((p) => (
          <div key={p.id} className={`card ${p.status === 'active' ? 'soft' : 'flat'}`}>
            <div className="row between">
              <span className="card-title">{p.productName}</span>
              <span className={`badge ${p.status === 'active' ? 'ok' : ''}`}>
                {{ active: 'aktywny', used: 'wykorzystany', expired: 'wygasł', frozen: 'zawieszony' }[p.status] ?? p.status}
              </span>
            </div>
            <div className="small" style={{ marginTop: 4 }}>
              {p.summary}
            </div>
            {p.autoRenew && p.status === 'active' && (
              <div className="row between" style={{ marginTop: 10 }}>
                <span className="tiny muted">Odnawia się samo</span>
                <button
                  className="link tiny"
                  onClick={async () => {
                    try {
                      const res = await api<{ message: string }>(`/my/passes/${p.id}/cancel-renewal`, { method: 'POST' });
                      toast(res.message);
                      passes.reload();
                    } catch (e) {
                      toast((e as ApiError).message, 'error');
                    }
                  }}
                >
                  Anuluj odnowienie
                </button>
              </div>
            )}
          </div>
        ))}
      </section>

      <section>
        <ListRow title="Wiadomości" hint="Od trenerki, powiadomienia" badge={home.data?.unread ? <span className="badge ok">{home.data.unread}</span> : null} onClick={() => open('inbox')} />
        <ListRow title="Płatności i faktury" hint="Historia, faktura na życzenie" onClick={() => open('payments')} />
        {studio.loyalty.enabled && <ListRow title="Lojalność i odznaki" hint="Punkty, poziom, nagrody, ramka profilu" onClick={() => open('loyalty')} />}
        <ListRow title="Moja szafka" hint="Nagrody i prezenty do odbioru" onClick={() => open('locker')} />
        {hasFeature(studio, 'courses') && <ListRow title="Moje kursy" hint="Kursy online od instruktorek" onClick={() => open('courses')} />}
        {hasFeature(studio, 'events') && <ListRow title="Wydarzenia" hint="Urodziny, babski wieczór w studiu" onClick={() => open('events')} />}
        {hasFeature(studio, 'shop') && <ListRow title="Sklep i zamówienia" hint="Bar, merch i stroje" onClick={() => open('shop')} />}
        {hasFeature(studio, 'health') && <ListRow title="Zdrowie i postępy" hint="Ankieta, pomiary, zdjęcia, plan od trenerki" onClick={() => open('health')} />}
        <ListRow title="Mój plan" hint="Od Twojej trenerki" onClick={() => open('plan')} />
        <ListRow title="Mój kod wejścia" hint="QR do recepcji i bramki" onClick={() => open('checkin')} />
        <ListRow title="Ustawienia" hint="Konto, powiadomienia, prywatność, dostępność" onClick={() => open('settings')} />
        <ListRow title="Pomoc" hint="FAQ, czat z recepcją, regulamin" onClick={() => open('faq')} />
      </section>

      <section className="stack">
        <h2>Historia zajęć</h2>
        {bookings.data?.length === 0 && <Empty>Tu pojawią się Twoje zajęcia.</Empty>}
        <div className="card flat">
          {bookings.data?.slice(0, 12).map((b) => (
            <div key={b.id} className="row between small" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>
                <b>{b.class_name}</b> · {fmtDay(b.starts_at)} {fmtTime(b.starts_at)}
              </span>
              <span className="muted row" style={{ gap: 6 }}>
                {BOOKING_STATUS[b.status] ?? b.status}
                {b.status === 'attended' && !b.guest_name && (b.rating ? <span>{'★'.repeat(b.rating)}</span> : <button className="link tiny" onClick={() => setRate(b.id)}>oceń</button>)}
              </span>
            </div>
          ))}
        </div>
      </section>

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

      <section className="stack">
        <button className="btn ghost" onClick={onSwitchStudio}>
          Moje studia
        </button>
        {DEMO_MODE ? (
          <a className="btn quiet" href="/">
            Tryb demo · zmień konto
          </a>
        ) : (
          <>
            <button
              className="btn ghost"
              onClick={async () => {
                await api('/auth/logout-all', { method: 'POST', global: true });
                onLogout();
              }}
            >
              Wyloguj ze wszystkich urządzeń
            </button>
            <button className="btn quiet" onClick={onLogout}>
              Wyloguj
            </button>
          </>
        )}
      </section>
    </div>
  );
}
