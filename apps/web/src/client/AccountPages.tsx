// Konto i ustawienia (3, 2.2, 8, 8.1, 10, 11): powiadomienia per typ, ciche godziny, okolicznościowe,
// prywatność i zgody, biometria, zmiana numeru, kalendarz, integracje, dostępność, eksport i usunięcie danych,
// skrzynka Wiadomości (rozmowy + powiadomienia), czat z recepcją, pomoc (FAQ, regulamin, telefon), kod QR do wejścia.
import { useEffect, useRef, useState } from 'react';
import { receptionSlots, WEEKDAY_LONG } from '@glam/core';
import { api, fmtDay, fmtTime, session, useApi } from '../api.ts';
import { getAppearance, setAppearance, type Appearance } from '../look.ts';
import { enablePush, passkeySupported, pushEnabled, pushSupported, registerPasskey } from '../push.ts';
import { AuthVideo, Empty, Field, ListRow, QrCode, Spinner, Toggle, useAction, useToast } from '../ui.tsx';
import { AttachmentView, ChatComposer, type ChatMessage } from '../chat.tsx';
import { ThreadRow, type ThreadItem } from '../groupChat.tsx';
import { useClient } from './ClientApp.tsx';
import type { RouteProps } from './router.tsx';

const CATEGORIES: [string, string, string][] = [
  ['transactional', 'Zajęcia i karnet', 'Przypomnienia, zwolnione miejsca, odwołania – zawsze włączone'],
  ['wellbeing', 'Dla mnie', 'Rytuał dnia, medytacja na weekend, mikroprzerwy'],
  ['motivation', 'Cel tygodnia i serie', 'Delikatnie, bez presji'],
  ['community', 'Społeczność', 'Zaproszenia, wyzwania, komentarze'],
  ['courses', 'Kursy i trenerka', 'Nowe lekcje, wiadomości od trenerki'],
  ['theme', 'Edycje sezonowe', 'Start motywu, odznaki sezonowe'],
  ['loyalty', 'Lojalność i nagrody', 'Nowy poziom, nagroda po 10 treningach'],
  ['reactivation', 'Gdy dawno Cię nie było', 'Ankieta „Co się stało?”, oferta powrotu'],
  ['marketing', 'Promocje', 'Tylko za Twoją zgodą'],
  ['shop', 'Sklep', 'Rezerwacje gotowe do odbioru'],
  ['events', 'Wydarzenia', 'Twoje wydarzenia w studiu'],
  ['occasional', 'Życzenia i okazje', 'Urodziny, święta, gratulacje'],
];
const OCCASIONS: [string, string][] = [
  ['birthday', 'Urodziny i imieniny'],
  ['anniversary', 'Rocznice'],
  ['holiday', 'Święta'],
  ['milestone', 'Gratulacje'],
  ['support', 'Wsparcie'],
];
const WEEKDAYS = ['pn', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];

export default function AccountPages({ route, close }: RouteProps) {
  if (route === 'notifications') return <Notifications />;
  if (route === 'privacy') return <Privacy close={close} />;
  if (route === 'security') return <Security />;
  if (route === 'a11y') return <Accessibility />;
  if (route === 'inbox' || route === 'messages') return <Inbox />;
  if (route === 'chat') return <Chat />;
  if (route === 'faq') return <Faq />;
  if (route === 'checkin') return <Checkin />;
  return <Settings />;
}

function useSave() {
  const { reloadMe, reloadStudio } = useClient();
  const { run, busy } = useAction();
  const save = (patch: Record<string, unknown>, msg = 'Zapisane') =>
    run(async () => {
      await api('/me', { method: 'PATCH', body: patch, global: true });
      await reloadMe();
      await reloadStudio();
    }, msg);
  return { save, busy };
}

function Settings() {
  const { me, open } = useClient();
  const { save } = useSave();
  const [name, setName] = useState(me.user.name ?? '');
  const [email, setEmail] = useState(me.user.email ?? '');
  const [birthday, setBirthday] = useState(me.user.birthday ?? '');
  const [nameday, setNameday] = useState(me.user.nameday ?? '');
  const [appearance, setAppearanceState] = useState<Appearance>(getAppearance);
  const [addr, setAddr] = useState(me.user.address ?? { line: '', city: '', zip: '' });
  return (
    <div className="stack-lg">
      <section className="stack">
        <Field label="Imię">
          <div className="row">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn sm" disabled={!name.trim() || name === me.user.name} onClick={() => save({ name })}>
              Zapisz
            </button>
          </div>
        </Field>
        <Field label="E-mail (faktury, potwierdzenia, odzyskanie konta)" hint="Opcjonalnie.">
          <div className="row">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn sm" onClick={() => save({ email: email || null })}>
              Zapisz
            </button>
          </div>
        </Field>
        <Field label="Urodziny (MM-DD, bez roku)" hint="Tylko po to, żeby złożyć Ci życzenia. Możesz usunąć w każdej chwili.">
          <div className="row">
            <input className="input" placeholder="03-14" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
            <button className="btn sm" onClick={() => save({ birthday: birthday || null }, birthday ? 'Zapamiętane – złożymy Ci życzenia' : 'Usunięte')}>
              Zapisz
            </button>
          </div>
        </Field>
        <Field label="Imieniny (opcjonalnie, MM-DD)">
          <div className="row">
            <input className="input" placeholder="05-26" value={nameday} onChange={(e) => setNameday(e.target.value)} />
            <button className="btn sm" onClick={() => save({ nameday: nameday || null })}>
              Zapisz
            </button>
          </div>
        </Field>
      </section>

      <section className="stack">
        <div className="eyebrow">Adres do wysyłki</div>
        <p className="tiny muted" style={{ margin: 0 }}>Tylko za Twoją zgodą – do nagród, kartki od trenerki i zamówień ze sklepu. Przechowujemy go zaszyfrowany i usuwasz go jednym kliknięciem.</p>
        <input className="input" placeholder="Ulica i numer" value={addr.line} onChange={(e) => setAddr({ ...addr, line: e.target.value })} />
        <div className="row">
          <input className="input" placeholder="Kod" style={{ maxWidth: 120 }} value={addr.zip} onChange={(e) => setAddr({ ...addr, zip: e.target.value })} />
          <input className="input" placeholder="Miasto" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
        </div>
        <div className="row">
          <button
            className="btn sm"
            disabled={!addr.line || !addr.city}
            onClick={async () => {
              await api('/me/consents', { method: 'PUT', global: true, body: { kind: 'address', granted: true } });
              save({ address: addr }, 'Adres zapisany');
            }}
          >
            Zapisz adres
          </button>
          {me.user.hasAddress && (
            <button className="btn ghost sm" onClick={() => save({ address: null }, 'Adres usunięty')}>
              Usuń adres
            </button>
          )}
        </div>
      </section>

      <section className="stack">
        <div className="eyebrow">Wygląd</div>
        <div className="segmented" role="group" aria-label="Wygląd aplikacji">
          {(
            [
              ['light', 'Jasny'],
              ['dark', 'Ciemny'],
              ['auto', 'Jak w systemie'],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              aria-pressed={appearance === v}
              onClick={() => {
                setAppearance(v);
                setAppearanceState(v);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <Toggle label="Zawsze standardowy wygląd" hint="Wyłącza motywy sezonowe" checked={me.user.themeOptOut} onChange={(v) => save({ themeOptOut: v })} />
        <Toggle label="Dźwięki motywu" hint="Krótki dźwięk przy rezerwacji i odznace (wyciszalny)" checked={me.user.prefs.sounds ?? false} onChange={(v) => save({ prefs: { sounds: v } })} />
        <Field label="Język">
          <select className="input" value="pl" disabled>
            <option value="pl">Polski</option>
          </select>
        </Field>
      </section>

      <section>
        <ListRow title="Powiadomienia" hint="Rodzaje, ciche godziny, życzenia" onClick={() => open('notifications')} />
        <ListRow title="Prywatność i zgody" hint="Widoczność profilu, zgody, Twoje dane" onClick={() => open('privacy')} />
        <ListRow title="Logowanie i urządzenia" hint="Face ID, numer telefonu, kalendarz telefonu" onClick={() => open('security')} />
        <ListRow title="Dostępność" hint="Większy tekst, kontrast, mniej ruchu" onClick={() => open('a11y')} />
      </section>
    </div>
  );
}

function Notifications() {
  const { me } = useClient();
  const { save } = useSave();
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [from, setFrom] = useState(me.user.quietFrom);
  const [to, setTo] = useState(me.user.quietTo);
  const [reminder, setReminder] = useState(me.user.prefs.reminderTime ?? '');
  const toast = useToast();
  useEffect(() => {
    pushEnabled().then(setPushOn);
  }, []);
  const disabled = new Set(me.user.pushDisabled);
  const occOff = new Set(me.user.prefs.occasionsOff ?? []);
  const evening = new Set(me.user.prefs.eveningDays ?? []);
  const micro = me.user.prefs.microBreaks ?? [];
  return (
    <div className="stack-lg">
      {pushSupported() && (
        <section className="card soft stack">
          <div className="card-title">Powiadomienia na tym telefonie</div>
          {pushOn ? (
            <p className="small" style={{ margin: 0 }}>Włączone ✓</p>
          ) : (
            <button
              className="btn sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={async () => {
                const ok = await enablePush().catch(() => false);
                setPushOn(ok);
                toast(ok ? 'Powiadomienia włączone' : 'Nie udało się – sprawdź zgodę w ustawieniach przeglądarki', ok ? 'ok' : 'error');
              }}
            >
              Włącz powiadomienia
            </button>
          )}
        </section>
      )}
      <section>
        <div className="eyebrow">Rodzaje (każdy osobno)</div>
        {CATEGORIES.map(([id, label, hint]) => (
          <Toggle
            key={id}
            label={label}
            hint={hint}
            checked={id === 'transactional' || !disabled.has(id)}
            onChange={(v) => id !== 'transactional' && save({ pushDisabled: v ? [...disabled].filter((x) => x !== id) : [...disabled, id] })}
          />
        ))}
      </section>
      <section className="stack">
        <div className="eyebrow">Ciche godziny</div>
        <p className="tiny muted" style={{ margin: 0 }}>W tych godzinach nie wysyłamy niczego poza ważnymi zmianami w Twoich zajęciach.</p>
        <div className="row">
          <input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Od" />
          <input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Do" />
          <button className="btn sm" onClick={() => save({ quietFrom: from, quietTo: to })}>
            Zapisz
          </button>
        </div>
      </section>
      <section className="stack">
        <div className="eyebrow">Życzenia i okazje</div>
        <Toggle label="Potrzebuję ciszy" hint="Wstrzymujemy wszystkie życzenia i wiadomości okolicznościowe" checked={me.user.needQuiet} onChange={(v) => save({ needQuiet: v })} />
        {OCCASIONS.map(([id, label]) => (
          <Toggle key={id} label={label} checked={!occOff.has(id)} onChange={(v) => save({ prefs: { occasionsOff: v ? [...occOff].filter((x) => x !== id) : [...occOff, id] } })} />
        ))}
      </section>
      <section className="stack">
        <div className="eyebrow">Rytuały (opcjonalnie)</div>
        <Field label="Poranny rytuał w dni robocze" hint="Np. 07:30 – „Dzisiejszy cel: 5 minut oddechu”. Puste = wyłączone.">
          <div className="row">
            <input className="input" type="time" value={reminder} onChange={(e) => setReminder(e.target.value)} />
            <button className="btn sm" onClick={() => save({ prefs: { reminderTime: reminder || null } })}>
              Zapisz
            </button>
          </div>
        </Field>
        <div className="field">
          <span className="field-label">„Zrób coś dla siebie” o 20:30 w dni:</span>
          <div className="pill-row">
            {WEEKDAYS.map((d, i) => (
              <button key={d} className="chip" aria-pressed={evening.has(i + 1)} onClick={() => save({ prefs: { eveningDays: evening.has(i + 1) ? [...evening].filter((x) => x !== i + 1) : [...evening, i + 1] } })}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Mikroprzerwy w pracy (3 oddechy, kark)</span>
          <div className="pill-row">
            {['10:30', '13:00', '15:30'].map((t) => (
              <button key={t} className="chip" aria-pressed={micro.includes(t)} onClick={() => save({ prefs: { microBreaks: micro.includes(t) ? micro.filter((x) => x !== t) : [...micro, t] } })}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Privacy({ close }: { close: () => void }) {
  const { me, studio, onLogout } = useClient();
  const { save } = useSave();
  const consents = useApi<{ studio_id: string; kind: string; granted: number }[]>('/me/consents');
  const { run } = useAction();
  const [confirm, setConfirm] = useState('');
  const has = (kind: string, studioId = '') => !!consents.data?.find((c) => c.kind === kind && c.studio_id === studioId)?.granted;
  const set = (kind: string, granted: boolean, studioId?: string) =>
    run(async () => {
      if (!granted && (kind === 'health' || kind === 'cycle') && !confirm2(kind)) return;
      await api('/me/consents', { method: 'PUT', global: true, body: { kind, granted, studioId } });
      consents.reload();
    }, granted ? 'Zgoda zapisana' : 'Zgoda wycofana');
  const confirm2 = (kind: string) => window.confirm(kind === 'health' ? 'Wycofanie zgody usunie Twój dziennik, ankietę zdrowia i pomiary. Kontynuować?' : 'Wycofanie zgody usunie dane cyklu. Kontynuować?');
  const vis = me.user.prefs.visibility ?? 'studio';
  return (
    <div className="stack-lg">
      <section className="stack">
        <div className="eyebrow">Widoczność w społeczności</div>
        <div className="segmented" role="group" aria-label="Widoczność profilu">
          {(
            [
              ['studio', 'Studio'],
              ['public', 'Publiczny'],
              ['private', 'Prywatny'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} aria-pressed={vis === v} onClick={() => save({ prefs: { visibility: v } })}>
              {l}
            </button>
          ))}
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>Prywatny: przy Twoich wpisach widać tylko inicjał. Społeczność jest zamknięta w obrębie studia.</p>
      </section>
      {!consents.data ? (
        <Spinner />
      ) : (
        <section>
          <div className="eyebrow">Zgody</div>
          <Toggle label="Regulamin" checked={has('terms')} onChange={(v) => set('terms', v)} />
          <Toggle label={`Wiadomości marketingowe – ${studio.name}`} hint="Promocje i wydarzenia w aplikacji" checked={has('marketing', studio.id)} onChange={(v) => set('marketing', v, studio.id)} />
          <Toggle label="SMS marketingowe" checked={has('marketing_sms', studio.id)} onChange={(v) => set('marketing_sms', v, studio.id)} />
          <Toggle label="E-mail marketingowy" checked={has('marketing_email', studio.id)} onChange={(v) => set('marketing_email', v, studio.id)} />
          <Toggle label="Dane o zdrowiu i samopoczuciu" hint="Dziennik, ankieta zdrowia, pomiary (RODO art. 9). Zaszyfrowane." checked={has('health')} onChange={(v) => set('health', v)} />
          <Toggle label="Zdjęcia postępów" hint="Tylko dla Ciebie – trenerce pokazujesz je sama" checked={has('photos')} onChange={(v) => set('photos', v)} />
          <Toggle label="Moduł cyklu" hint="Osobna zgoda. Sugestie ogólne, nie porada medyczna." checked={has('cycle')} onChange={(v) => set('cycle', v)} />
        </section>
      )}
      <section className="stack">
        <div className="eyebrow">Twoje dane (RODO)</div>
        <a className="btn ghost" href="/api/me/export" onClick={async (e) => {
          e.preventDefault();
          const res = await fetch('/api/me/export', { headers: { authorization: `Bearer ${session.token}` } });
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'glam-moje-dane.json';
          a.click();
        }}>
          Pobierz kopię moich danych
        </a>
        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>Usuń konto</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>Usuniemy Twoje dane osobowe, dziennik, zdjęcia i zgody. Rozliczenia studia zostaną zanonimizowane. Tego nie da się cofnąć.</p>
            <input className="input" placeholder="Wpisz USUŃ" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button
              className="btn danger"
              disabled={confirm !== 'USUŃ'}
              onClick={() =>
                run(async () => {
                  await api('/me', { method: 'DELETE', global: true, body: { confirm } });
                  close();
                  onLogout();
                  session.setToken(null);
                  location.href = '/';
                }, 'Konto usunięte')
              }
            >
              Usuń konto na zawsze
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}

function Security() {
  const { me } = useClient();
  const passkeys = useApi<{ id: string; label: string; created_at: string; last_used_at: string | null }[]>('/me/passkeys');
  const sessions = useApi<{ device: string; created_at: string; current: boolean }[]>('/me/sessions');
  const calendar = useApi<{ hasToken: boolean }>('/calendar-sync');
  const integrations = useApi<{ music: { provider: string; label: string }[] }>('/me/integrations');
  const { run, busy } = useAction();
  const [phone, setPhone] = useState('');
  const [codes, setCodes] = useState<{ old: string; new: string } | null>(null);
  const [calUrl, setCalUrl] = useState<string | null>(null);
  return (
    <div className="stack-lg">
      <section className="stack">
        <div className="eyebrow">Face ID / odcisk palca</div>
        <p className="small muted" style={{ margin: 0 }}>Na tym urządzeniu zalogujesz się bez kodu SMS. Klucz zostaje w telefonie – my go nie znamy.</p>
        {passkeys.data?.map((p) => (
          <div key={p.id} className="row between card flat">
            <span className="small">
              <b>{p.label}</b> · dodany {fmtDay(p.created_at)}
            </span>
            <button className="btn ghost sm" onClick={() => run(() => api(`/me/passkeys/${p.id}`, { method: 'DELETE', global: true }).then(passkeys.reload), 'Usunięte')}>
              Usuń
            </button>
          </div>
        ))}
        <button className="btn" disabled={!passkeySupported() || busy} onClick={() => run(() => registerPasskey(navigator.userAgent.includes('iPhone') ? 'iPhone' : 'To urządzenie').then(passkeys.reload), 'Gotowe – następnym razem bez SMS')}>
          {passkeySupported() ? 'Włącz logowanie biometrią' : 'Ta przeglądarka nie obsługuje biometrii'}
        </button>
      </section>

      <section className="stack">
        <div className="eyebrow">Zmiana numeru telefonu</div>
        <p className="tiny muted" style={{ margin: 0 }}>Wyślemy kod na obecny ({me.user.phone}) i na nowy numer.</p>
        {!codes ? (
          <div className="row">
            <input className="input" inputMode="tel" placeholder="Nowy numer" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button
              className="btn sm"
              disabled={!phone}
              onClick={() =>
                run(async () => {
                  const r = await api<{ devOldCode?: string; devNewCode?: string }>('/me/phone/start', { method: 'POST', global: true, body: { newPhone: phone } });
                  setCodes({ old: r.devOldCode ?? '', new: r.devNewCode ?? '' });
                }, 'Wysłałyśmy kody SMS')
              }
            >
              Dalej
            </button>
          </div>
        ) : (
          <PhoneConfirm codes={codes} onDone={() => setCodes(null)} />
        )}
      </section>

      <section className="stack">
        <div className="eyebrow">Kalendarz w telefonie</div>
        <p className="tiny muted" style={{ margin: 0 }}>Twoje zajęcia same pojawią się w kalendarzu (Apple, Google, Outlook) i będą się aktualizować.</p>
        {calUrl ? (
          <>
            <input className="input" readOnly value={location.origin + calUrl} onFocus={(e) => e.target.select()} />
            <a className="btn ghost" href={`webcal://${location.host}${calUrl}`}>
              Dodaj do kalendarza
            </a>
          </>
        ) : (
          <button className="btn ghost" onClick={() => run(async () => setCalUrl((await api<{ url: string }>('/me/calendar', { method: 'POST', global: true })).url))}>
            {calendar.data?.hasToken ? 'Pokaż adres kalendarza' : 'Włącz synchronizację'}
          </button>
        )}
      </section>

      <section className="stack">
        <div className="eyebrow">Integracje</div>
        {(['spotify', 'apple'] as const).map((p) => {
          const on = integrations.data?.music.some((m) => m.provider === p);
          return (
            <div key={p} className="row between">
              <span>{p === 'spotify' ? 'Spotify' : 'Apple Music'}</span>
              <button
                className="btn ghost sm"
                onClick={() =>
                  run(async () => {
                    if (on) await api(`/me/music/${p}`, { method: 'DELETE', global: true });
                    else {
                      const r = await api<{ authorizeUrl?: string }>(`/me/music/${p}`, { method: 'POST', global: true });
                      if (r.authorizeUrl) location.href = r.authorizeUrl;
                    }
                    integrations.reload();
                  })
                }
              >
                {on ? 'Odłącz' : 'Połącz'}
              </button>
            </div>
          );
        })}
        <p className="tiny muted" style={{ margin: 0 }}>Logujesz się u dostawcy – nie przechowujemy haseł ani historii słuchania.</p>
      </section>

      <section className="stack">
        <div className="eyebrow">Zalogowane urządzenia</div>
        {sessions.data?.map((s, i) => (
          <div key={i} className="row between small">
            <span>
              {s.device} {s.current && <span className="badge ok">to urządzenie</span>}
            </span>
            <span className="muted">{fmtDay(s.created_at)}</span>
          </div>
        ))}
        <button className="btn ghost" onClick={() => run(() => api('/auth/logout-all', { method: 'POST', global: true }), 'Wylogowano ze wszystkich urządzeń')}>
          Wyloguj ze wszystkich urządzeń
        </button>
      </section>
    </div>
  );
}

function PhoneConfirm({ codes, onDone }: { codes: { old: string; new: string }; onDone: () => void }) {
  const { reloadMe } = useClient();
  const [a, setA] = useState(codes.old);
  const [b, setB] = useState(codes.new);
  const { run } = useAction();
  return (
    <div className="stack">
      <input className="input otp" inputMode="numeric" placeholder="Kod ze starego numeru" value={a} onChange={(e) => setA(e.target.value)} />
      <input className="input otp" inputMode="numeric" placeholder="Kod z nowego numeru" value={b} onChange={(e) => setB(e.target.value)} />
      <button
        className="btn"
        onClick={() =>
          run(async () => {
            await api('/me/phone/confirm', { method: 'POST', global: true, body: { oldCode: a, newCode: b } });
            await reloadMe();
            onDone();
          }, 'Numer zmieniony')
        }
      >
        Potwierdź
      </button>
    </div>
  );
}

function Accessibility() {
  const { me } = useClient();
  const { save } = useSave();
  const a = me.user.prefs.a11y ?? {};
  return (
    <div className="stack-lg">
      <section className="stack">
        <div className="eyebrow">Rozmiar tekstu</div>
        <div className="segmented" role="group" aria-label="Rozmiar tekstu">
          {[1, 1.15, 1.3, 1.5].map((s) => (
            <button key={s} aria-pressed={(a.fontScale ?? 1) === s} onClick={() => save({ prefs: { a11y: { ...a, fontScale: s } } })}>
              {Math.round(s * 100)}%
            </button>
          ))}
        </div>
      </section>
      <section>
        <Toggle label="Wyższy kontrast" hint="Mocniejsze linie i tekst pomocniczy" checked={!!a.contrast} onChange={(v) => save({ prefs: { a11y: { ...a, contrast: v } } })} />
        <Toggle label="Ogranicz ruch" hint="Bez animacji i padającego śniegu; oddech podaje tekst i licznik" checked={!!a.reduceMotion} onChange={(v) => save({ prefs: { a11y: { ...a, reduceMotion: v } } })} />
      </section>
      <p className="tiny muted">Aplikacja działa z VoiceOver i TalkBack, a ustawienia systemowe (ciemny tryb, ograniczenie ruchu) też są brane pod uwagę.</p>
    </div>
  );
}

/** Gdzie otwiera się rozmowa z listy – te same trasy, które przychodzą w powiadomieniach. */
const threadRoute = (t: ThreadItem) => (t.kind === 'reception' ? 'chat' : t.kind === 'dm' ? `dm/${t.id}` : `groups/${t.id}`);

/**
 * Skrzynka „Wiadomości” (wejście z Start): wszystkie rozmowy na jednej liście – recepcja, trenerki, grupy –
 * a pod nimi powitania i powiadomienia studia. Grupy, do których jeszcze nie należy, są w Razem → Grupy.
 */
function Inbox() {
  const { follow, open } = useClient();
  const threads = useApi<{ threads: ThreadItem[]; unread: number }>('/threads');
  const inbox = useApi<{ id: string; title: string | null; body: string; action: string | null; deliver_at: string }[]>('/inbox');
  const welcomes = useApi<{ id: string; body: string; kind: string; trainer_name: string | null; created_at: string; video_id: string | null }[]>('/welcome');
  // Po powrocie z rozmowy liczniki same się odświeżą.
  const reload = threads.reload;
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), 15_000);
    return () => clearInterval(t);
  }, [reload]);
  if (!inbox.data || !threads.data) return <Spinner />;
  return (
    <div className="stack-lg">
      <section>
        <ul className="thread-list">
          {threads.data.threads.map((t) => (
            <ThreadRow
              key={`${t.kind}:${t.id}`}
              g={t.kind === 'reception' ? { ...t, kind: undefined, hint: 'Pytania, zmiany – odpowiadamy w godzinach recepcji' } : t}
              onOpen={() => open(threadRoute(t))}
            />
          ))}
        </ul>
      </section>
      {welcomes.data && welcomes.data.length > 0 && (
        <section className="stack">
          <div className="eyebrow">Od Twojej trenerki</div>
          {welcomes.data.map((w) => (
            <div key={w.id} className="card soft stack" style={{ gap: 8 }}>
              <div className="small muted">{w.kind === 'studio' ? 'Od studia' : w.trainer_name} · {fmtDay(w.created_at)}</div>
              {w.video_id && <AuthVideo className="video-916" src={`/api/media/${w.video_id}`} controls playsInline />}
              <p style={{ margin: 0 }}>{w.body}</p>
            </div>
          ))}
        </section>
      )}
      <section className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Powiadomienia</div>
        {inbox.data.length === 0 && <Empty>Cisza i spokój.</Empty>}
        {inbox.data.map((n) => (
          <button
            key={n.id}
            className="card flat small row between"
            style={{ textAlign: 'left', cursor: n.action ? 'pointer' : 'default' }}
            onClick={() => {
              api(`/inbox/${n.id}/open`, { method: 'POST' }).catch(() => {});
              follow(n.action);
            }}
          >
            <span>
              {n.title && <b style={{ display: 'block' }}>{n.title}</b>}
              {n.body}
            </span>
            <span className="tiny muted" style={{ flex: 'none' }}>
              {fmtDay(n.deliver_at)}
            </span>
          </button>
        ))}
      </section>
    </div>
  );
}

function Chat() {
  const chat = useApi<{ open: boolean; next: string | null; messages: ChatMessage[] }>('/chat');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [chat.data]);
  if (!chat.data) return <Spinner />;
  return (
    <div className="stack">
      <p className="tiny muted center">{chat.data.open ? 'Recepcja jest teraz w studiu' : chat.data.next ? `Recepcja odpisze ${chat.data.next}` : 'Recepcja odpisze w godzinach pracy studia'}</p>
      <div className="stack" style={{ gap: 8 }}>
        {chat.data.messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.from_staff ? '' : 'me'} ${m.auto ? 'auto' : ''}`}>
            {m.attachment && <AttachmentView a={m.attachment} />}
            {m.body}
            <div className="tiny" style={{ opacity: 0.7, marginTop: 4 }}>
              {m.from_staff ? (m.auto ? 'Automatyczna odpowiedź' : m.author ?? 'Recepcja') : 'Ty'} · {fmtTime(m.created_at)}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', paddingTop: 8 }}>
        <ChatComposer placeholder="Napisz do recepcji…" onSend={(msg) => api('/chat', { method: 'POST', body: msg }).then(chat.reload)} />
      </div>
    </div>
  );
}

function Faq() {
  const { studio, open } = useClient();
  return (
    <div className="stack-lg">
      {/* Kontakt na górze – czat z recepcją to główna droga do pomocy (Start ma jedną pozycję „Pomoc”). */}
      <section>
        <ListRow title="Czat z recepcją" hint="Pytania, zmiany – odpowiadamy w godzinach recepcji" onClick={() => open('chat')} />
        {studio.phone && <ListRow title="Zadzwoń do studia" hint={studio.phone} onClick={() => (location.href = `tel:${studio.phone.replace(/\s/g, '')}`)} />}
      </section>
      <section className="stack" style={{ gap: 0 }}>
        {studio.support.faq.map((f) => (
          <details key={f.q} className="list-row" style={{ display: 'block' }}>
            <summary className="card-title" style={{ cursor: 'pointer', fontSize: '1rem' }}>{f.q}</summary>
            <p className="small" style={{ margin: '10px 0 0' }}>{f.a}</p>
          </details>
        ))}
      </section>
      <section className="card stack" style={{ gap: 6 }}>
        <div className="eyebrow">Godziny recepcji</div>
        {WEEKDAY_LONG.slice(1).map((day, i) => {
          const slots = receptionSlots(studio.support.hours).filter((s) => s.weekday === i + 1);
          return (
            <div key={day} className="row between small">
              <span>{day}</span>
              <span className={slots.length ? '' : 'muted'}>{slots.length ? slots.map((s) => `${s.from}–${s.to}`).join(', ') : 'nieczynne'}</span>
            </div>
          );
        })}
      </section>
      {studio.regulations && (
        <details>
          <summary className="card-title" style={{ cursor: 'pointer' }}>Regulamin studia</summary>
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{studio.regulations}</p>
        </details>
      )}
      <p className="tiny muted">Treści o zdrowiu w aplikacji są ogólne i nie zastępują konsultacji lekarskiej.</p>
    </div>
  );
}

function Checkin() {
  const { data, reload } = useApi<{ code: string }>('/my/checkin-code');
  useEffect(() => {
    const t = setInterval(reload, 60 * 60_000);
    return () => clearInterval(t);
  }, [reload]);
  if (!data) return <Spinner />;
  return (
    <div className="stack center">
      <p className="muted">Pokaż ten kod w recepcji albo przy bramce. Kod zmienia się codziennie.</p>
      <QrCode text={data.code} size={240} label="Kod wejścia" />
      <p className="tiny muted">Zrzut ekranu z wczoraj nie zadziała – otwieraj kod w aplikacji.</p>
    </div>
  );
}
