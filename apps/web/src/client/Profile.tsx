// Profil (3: zakładka 5): karnety i menu podstron (wiadomości, płatności, kursy, zdrowie, ustawienia). Historia zajęć – w Grafiku.
import { useEffect } from 'react';
import { api, ApiError, DEMO_MODE, fmtPhone, useApi } from '../api.ts';
import { preparePhoto } from '../staff/logoUpload.ts';
import { Avatar, Empty, ListRow, MoreLink, Pending, rememberOrigin, useAction, useToast } from '../ui.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';
import { PassMeter, type Meter } from './PassMeter.tsx';

type Pass = { id: string; productName: string; status: string; summary: string; meter: Meter | null; expiringSoon: boolean; autoRenew?: boolean };


export function Profile() {
  const { me, studio, openShop, onSwitchStudio, onLogout, open, reloadMe } = useClient();
  const { run, busy } = useAction();
  const passes = useApi<Pass[]>('/my/passes');
  const toast = useToast();
  // Zdjęcie profilowe: to samo kółko widać w lewym górnym rogu aplikacji.
  const pickPhoto = async (file: File) => {
    let dataUrl: string;
    try {
      dataUrl = await preparePhoto(file, 600);
    } catch (e) {
      return toast((e as Error).message);
    }
    run(() => api('/me/avatar', { method: 'PUT', body: { dataUrl } }).then(reloadMe), 'Zdjęcie zapisane');
  };

  const reloadPasses = passes.reload;
  useEffect(() => {
    window.addEventListener('glam:passes-changed', reloadPasses);
    return () => window.removeEventListener('glam:passes-changed', reloadPasses);
  }, [reloadPasses]);



  return (
    <div className="stack-lg">
      <section className="row">
        <label style={{ cursor: 'pointer' }} aria-label={me.user.avatarUrl ? 'Zmień zdjęcie profilowe' : 'Dodaj zdjęcie profilowe'} aria-disabled={busy}>
          <Avatar name={me.user.name} url={me.user.avatarUrl} />
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => (e.target.files?.[0] && pickPhoto(e.target.files[0]), (e.target.value = ''))} />
        </label>
        <div className="stack gap-1">
          <h1 className="profile-name">{me.user.name ?? 'Twój profil'}</h1>
          <div className="muted small">{fmtPhone(me.user.phone)}</div>
          {!me.user.avatarUrl && <span className="tiny muted">Dotknij kółka, żeby dodać zdjęcie</span>}
        </div>
      </section>

      <section className="stack gap-3">
        <div className="sec-head">
          <div className="eyebrow">Karnety</div>
          <MoreLink label="Kup karnet" onClick={() => openShop()} />
        </div>
        {!passes.data && <Pending error={passes.error} reload={passes.reload} />}
        {passes.data?.length === 0 && <Empty icon="🎟️">Nie masz jeszcze karnetu w tym studiu.</Empty>}
        {passes.data?.map((p) => (
          // Ta sama karta co „Mój karnet” na Starcie; nieaktywny karnet przygaszony, z plakietką.
          <div key={p.id} className={`home-pass${p.status === 'active' ? '' : ' is-inactive'}`}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <PassMeter name={p.productName} summary={p.summary} meter={p.meter} />
              {p.status !== 'active' && (
                <span className="badge">{{ used: 'wykorzystany', expired: 'wygasł', frozen: 'zawieszony' }[p.status] ?? p.status}</span>
              )}
            </div>
            {p.autoRenew && p.status === 'active' && (
              <div className="row between">
                <span className="small muted">Odnawia się samo</span>
                <MoreLink
                  label="Anuluj odnowienie"
                  onClick={async () => {
                    try {
                      const res = await api<{ message: string }>(`/my/passes/${p.id}/cancel-renewal`, { method: 'POST' });
                      toast(res.message);
                      passes.reload();
                    } catch (e) {
                      toast((e as ApiError).message, 'error');
                    }
                  }}
                />
              </div>
            )}
          </div>
        ))}
        {/* Szczegóły karnetu: zawieszenie (urlop, zdrowie), odnawianie i stałe rezerwacje – wcześniej tylko z powiadomienia. */}
        {!!passes.data?.length && (
          <div className="list-rows">
            <ListRow title="Szczegóły karnetów" hint="Zawieszenie, odnawianie i stałe rezerwacje" onClick={() => open('passes')} />
          </div>
        )}
      </section>

      {/* Trzy krótkie grupy zamiast jednej długiej listy. Wiadomości i powiadomienia są w zakładce Czat, ich ustawienia – w Ustawieniach. */}
      <section>
        <div className="eyebrow">Na co dzień</div>
        <ListRow
          title="Mój kod wejścia"
          hint="Pokaż na recepcji"
          onClick={(e) => {
            // Strona kodu rośnie z klikniętego wiersza – tak samo jak z przycisku na Starcie.
            rememberOrigin(e.currentTarget);
            open('checkin');
          }}
        />
        <ListRow title="Mój plan" hint="Od Twojej trenerki" onClick={() => open('plan')} />
      </section>

      <section>
        <div className="eyebrow">Zakupy i nagrody</div>
        <ListRow title="Historia płatności" hint="Płatności i faktura na życzenie" onClick={() => open('payments')} />
        <ListRow title="Lojalność i szafka" hint="Punkty, odznaki, nagrody i rzeczy do odbioru" onClick={() => open('loyalty')} />
        {hasFeature(studio, 'shop') && <ListRow title="Sklep i zamówienia" hint="Bar, merch i stroje" onClick={() => open('shop')} />}
        {hasFeature(studio, 'courses') && <ListRow title="Moje kursy" hint="Kursy online od instruktorek" onClick={() => open('courses')} />}
        {hasFeature(studio, 'events') && <ListRow title="Wydarzenia w klubie" hint="Urodziny, babski wieczór w studiu" onClick={() => open('events')} />}
      </section>

      <section>
        <div className="eyebrow">Konto</div>
        <ListRow title="Ustawienia" hint="Powiadomienia, prywatność, dostępność" onClick={() => open('settings')} />
        <ListRow title="Pomoc" hint="Czat z recepcją, telefon, regulamin" onClick={() => open('faq')} />
        <ListRow title="Moje studia" hint="Przełącz albo dodaj studio" onClick={onSwitchStudio} />
        {DEMO_MODE ? (
          <ListRow title="Tryb demo" hint="Zmień konto" onClick={() => (location.href = '/')} />
        ) : (
          <>
            <ListRow title="Wyloguj" onClick={onLogout} />
            <ListRow
              title="Wyloguj ze wszystkich urządzeń"
              onClick={async () => {
                try {
                  await api('/auth/logout-all', { method: 'POST', global: true });
                  onLogout();
                } catch (e) {
                  toast((e as ApiError).message, 'error');
                }
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}
