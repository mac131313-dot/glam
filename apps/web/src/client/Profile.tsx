// Profil (3: zakładka 5): karnety i menu podstron (wiadomości, płatności, kursy, zdrowie, ustawienia). Historia zajęć – w Grafiku.
import { useEffect } from 'react';
import { api, ApiError, DEMO_MODE, fmtPhone, useApi } from '../api.ts';
import { Avatar, Empty, ListRow, useToast } from '../ui.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';

type Pass = { id: string; productName: string; status: string; summary: string; expiringSoon: boolean; autoRenew?: boolean };


export function Profile() {
  const { me, studio, openShop, onSwitchStudio, onLogout, open } = useClient();
  const passes = useApi<Pass[]>('/my/passes');
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
          <button className="link small" onClick={() => openShop()}>
            Kup karnet
          </button>
        </div>
        {passes.data?.length === 0 && <Empty icon="🎟️">Nie masz jeszcze karnetu w tym studiu.</Empty>}
        {passes.data?.map((p) => (
          <div key={p.id} className={`card ${p.status === 'active' ? 'soft' : 'flat'}`}>
            {/* Podsumowanie zaczyna się od nazwy karnetu – jedna linia; plakietka tylko, gdy karnet nie jest aktywny. */}
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <span className="card-title">{p.summary}</span>
              {p.status !== 'active' && (
                <span className="badge">{{ used: 'wykorzystany', expired: 'wygasł', frozen: 'zawieszony' }[p.status] ?? p.status}</span>
              )}
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
        {/* Od najczęściej potrzebnego do rzadziej używanego; ustawienia i pomoc na końcu. */}
        <ListRow title="Mój kod wejścia" hint="Pokaż na recepcji" onClick={() => open('checkin')} />
        <ListRow title="Wiadomości" hint="Wszystkie powiadomienia od studia" onClick={() => open('inbox')} />
        <ListRow title="Mój plan" hint="Od Twojej trenerki" onClick={() => open('plan')} />
        <ListRow title="Lojalność i szafka" hint="Punkty, odznaki, nagrody i rzeczy do odbioru" onClick={() => open('loyalty')} />
        <ListRow title="Historia płatności" hint="Płatności i faktura na życzenie" onClick={() => open('payments')} />
        {hasFeature(studio, 'shop') && <ListRow title="Sklep i zamówienia" hint="Bar, merch i stroje" onClick={() => open('shop')} />}
        {hasFeature(studio, 'events') && <ListRow title="Wydarzenia w klubie" hint="Urodziny, babski wieczór w studiu" onClick={() => open('events')} />}
        {hasFeature(studio, 'courses') && <ListRow title="Moje kursy" hint="Kursy online od instruktorek" onClick={() => open('courses')} />}
        <ListRow title="Ustawienia" hint="Konto, powiadomienia, prywatność, dostępność" onClick={() => open('settings')} />
        <ListRow title="Pomoc" hint="FAQ, czat z recepcją, regulamin" onClick={() => open('faq')} />
      </section>

      <section className="list-rows">
        <ListRow title="Moje studia" hint="Przełącz albo dodaj studio" onClick={onSwitchStudio} />
        {DEMO_MODE ? (
          <ListRow title="Tryb demo" hint="Zmień konto" onClick={() => (location.href = '/')} />
        ) : (
          <>
            <ListRow title="Wyloguj" onClick={onLogout} />
            <ListRow
              title="Wyloguj ze wszystkich urządzeń"
              onClick={async () => {
                await api('/auth/logout-all', { method: 'POST', global: true });
                onLogout();
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}
