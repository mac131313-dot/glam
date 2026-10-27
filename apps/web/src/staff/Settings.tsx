// Ustawienia studia (właścicielka): dane i widoczność w katalogu, white label, zasady zapisów, wszystkie
// przełączniki modułów (zamrożenia, wejściówki, kartki, NPS, uśpione, wsparcie i FAQ, faktury, sklep, wydarzenia),
// regulamin, zespół i role, kwalifikacje, szablony branżowe, eksport / import konfiguracji, import klientek z CSV,
// bramka płatności, plan i zużycie, zgłoszenia do GLAM, dziennik zmian, kopia danych, konto testowe.
import { useEffect, useState } from 'react';
import { PANEL_TINTS, ROLE_LABEL, type Role, type StudioSettings } from '@glam/core';
import type { MeStudio } from '../App.tsx';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Field, Spinner, Stat, Tabs, Toggle, useAction } from '../ui.tsx';
import { applySystemLook } from '../look.ts';
import { download } from './Clients.tsx';

type Cfg = {
  policy: { opensDaysAhead: number; closesMinutesBefore: number; cancelMinutesBefore: number; waitlist: boolean };
  settings: StudioSettings;
  regulations: string | null;
  studio: { name: string; tagline: string | null; city: string | null; phone: string | null; email: string | null; address: string | null; nip: string | null; foundedOn: string | null; catalogVisible: boolean; published: boolean; welcomeApproval: boolean; inviteCode: string; whiteLabel: Record<string, string> | null };
  gateway: { connected: boolean; provider?: string; merchantId?: string; apiKey?: string };
  presets: { id: string; label: string; description: string }[];
  classTypes: { id: string; name: string }[];
  trainers: { id: string; name: string; classTypeIds: string[] }[];
};

type Tab = 'studio' | 'rules' | 'modules' | 'team' | 'data' | 'plan';

export default function Settings({ onSaved }: { studio: MeStudio; onSaved: () => Promise<void> }) {
  const cfg = useApi<Cfg>('/owner/config');
  const [tab, setTab] = useState<Tab>('studio');
  if (!cfg.data) return <Spinner />;
  if (!cfg.data.settings) return <Empty>Ustawienia zmienia właścicielka studia.</Empty>;
  const reload = async () => (await cfg.reload(), await onSaved());
  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <h1>Ustawienia</h1>
      <Tabs
        label="Ustawienia"
        value={tab}
        onChange={setTab}
        options={[
          ['studio', 'Studio'],
          ['rules', 'Zapisy i regulamin'],
          ['modules', 'Moduły'],
          ['team', 'Zespół'],
          ['data', 'Dane i import'],
          ['plan', 'Plan i wsparcie'],
        ]}
      />
      {tab === 'studio' && (
        <>
          <StudioInfo cfg={cfg.data} reload={reload} />
          <PanelTintPicker value={cfg.data.settings.panelTint} reload={reload} />
        </>
      )}
      {tab === 'rules' && <Rules cfg={cfg.data} reload={reload} />}
      {tab === 'modules' && <Modules settings={cfg.data.settings} reload={reload} />}
      {tab === 'team' && <Team cfg={cfg.data} reload={reload} />}
      {tab === 'data' && <DataTools cfg={cfg.data} reload={reload} />}
      {tab === 'plan' && <PlanSupport />}
    </div>
  );
}

/** Kolor przewodni panelu: kilka stonowanych odcieni do wyboru (bez dowolnego koloru – zawsze spokojnie i czytelnie).
 *  Stuknięcie od razu barwi panel i zapisuje; gdy zapis się nie uda, wraca poprzedni kolor. */
function PanelTintPicker({ value, reload }: { value: string; reload: () => Promise<void> }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const { run } = useAction();
  const pick = (id: string) => {
    if (id === v) return;
    setV(id);
    applySystemLook(id);
    run(
      () =>
        api('/owner/settings', { method: 'PUT', body: { panelTint: id } })
          .then(reload)
          .catch((e) => {
            setV(value);
            applySystemLook(value);
            throw e;
          }),
      'Kolor zapisany',
    );
  };
  return (
    <section className="card stack">
      <div className="eyebrow">Kolor przewodni panelu</div>
      <p className="small muted">Delikatny akcent w menu, przełącznikach i polach – widzi go cały zespół. Wygląd aplikacji klientek ustawiasz w zakładce Marka.</p>
      <div className="tint-row" role="radiogroup" aria-label="Kolor przewodni panelu">
        {PANEL_TINTS.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={v === t.id} className="tint-option" onClick={() => pick(t.id)}>
            <span className="tint-dot" style={{ background: t.color }} />
            {t.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function StudioInfo({ cfg, reload }: { cfg: Cfg; reload: () => Promise<void> }) {
  const [s, setS] = useState(cfg.studio);
  const [wl, setWl] = useState(JSON.stringify(cfg.studio.whiteLabel ?? {}, null, 2));
  const { run, busy } = useAction();
  const text = (k: keyof Cfg['studio'], label: string, type = 'text') => (
    <Field label={label}>
      <input className="input" type={type} value={(s[k] as string) ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
    </Field>
  );
  return (
    <section className="card stack">
      {text('name', 'Nazwa')}
      {text('tagline', 'Hasło')}
      <div className="row">
        {text('city', 'Miasto')}
        {text('address', 'Adres')}
      </div>
      <div className="row">
        {text('phone', 'Telefon', 'tel')}
        {text('email', 'E-mail', 'email')}
      </div>
      <div className="row">
        {text('nip', 'NIP')}
        {text('foundedOn', 'Data założenia (urodziny studia)', 'date')}
      </div>
      <div className="small muted">
        Kod zaproszenia: <b className="code">{cfg.studio.inviteCode}</b> · link: {location.origin}/app?kod={cfg.studio.inviteCode}
      </div>
      <Toggle label="Studio opublikowane (klientki mogą dołączać)" checked={s.published} onChange={(v) => setS({ ...s, published: v })} />
      <Toggle label="Widoczne w katalogu studiów GLAM" checked={s.catalogVisible} onChange={(v) => setS({ ...s, catalogVisible: v })} />
      <Toggle label="Powitania trenerek wymagają mojej akceptacji" checked={s.welcomeApproval} onChange={(v) => setS({ ...s, welcomeApproval: v })} />
      <Field label="White label (plan Sieć): appName, domain, supportEmail…" hint="JSON – nazwa i ikona aplikacji zamiast GLAM.">
        <textarea className="input code" style={{ minHeight: 90 }} value={wl} onChange={(e) => setWl(e.target.value)} />
      </Field>
      <button
        className="btn"
        disabled={busy}
        onClick={() =>
          run(async () => {
            let whiteLabel: Record<string, string> | null = null;
            try {
              const parsed = JSON.parse(wl || '{}');
              whiteLabel = Object.keys(parsed).length ? parsed : null;
            } catch {
              throw new Error('White label: nieprawidłowy JSON.');
            }
            await api('/owner/studio', { method: 'PUT', body: { ...s, whiteLabel } });
            await reload();
          }, 'Zapisane')
        }
      >
        Zapisz
      </button>
    </section>
  );
}

function Rules({ cfg, reload }: { cfg: Cfg; reload: () => Promise<void> }) {
  const [p, setP] = useState(cfg.policy);
  const [reg, setReg] = useState(cfg.regulations ?? '');
  const { run, busy } = useAction();
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="eyebrow">Zasady zapisów</div>
        <div className="row">
          <Field label="Zapisy otwarte (dni naprzód)">
            <input className="input" type="number" value={p.opensDaysAhead} onChange={(e) => setP({ ...p, opensDaysAhead: Number(e.target.value) })} />
          </Field>
          <Field label="Zamknięcie zapisów (min przed)">
            <input className="input" type="number" value={p.closesMinutesBefore} onChange={(e) => setP({ ...p, closesMinutesBefore: Number(e.target.value) })} />
          </Field>
          <Field label="Bezpłatne odwołanie (min przed)">
            <input className="input" type="number" value={p.cancelMinutesBefore} onChange={(e) => setP({ ...p, cancelMinutesBefore: Number(e.target.value) })} />
          </Field>
        </div>
        <Toggle label="Lista rezerwowa z automatycznym awansem" checked={p.waitlist} onChange={(v) => setP({ ...p, waitlist: v })} />
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => run(() => api('/owner/policy', { method: 'PUT', body: p }).then(reload), 'Zasady zapisane')}>
          Zapisz zasady
        </button>
      </section>
      <section className="card stack">
        <div className="eyebrow">Regulamin studia</div>
        <textarea className="input" style={{ minHeight: 220 }} value={reg} onChange={(e) => setReg(e.target.value)} />
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => run(() => api('/owner/regulations', { method: 'PUT', body: { regulations: reg } }).then(reload), 'Regulamin zapisany')}>
          Zapisz regulamin
        </button>
      </section>
    </div>
  );
}

// Bloki ustawień edytowane generycznie: przełączniki, liczby, teksty; listy (warianty wejściówek, FAQ) jako JSON.
const BLOCKS: { key: keyof StudioSettings; label: string; hint?: string }[] = [
  { key: 'freeze', label: 'Zawieszanie karnetu', hint: 'Ile razy i na ile dni łącznie.' },
  { key: 'guestPass', label: 'Wejściówki dla znajomych', hint: 'Warianty: nazwa, cena w groszach, liczba wejść, typy zajęć.' },
  { key: 'cards', label: 'Odręczne kartki po pierwszym miesiącu' },
  { key: 'fallbackWelcome', label: 'Powitanie zastępcze (gdy trenerka nie zdąży)' },
  { key: 'nps', label: 'Ankieta NPS' },
  { key: 'dormant', label: 'Uśpione klientki: ankieta i oferta powrotu' },
  { key: 'support', label: 'Czat z recepcją: godziny, autoodpowiedź, FAQ' },
  { key: 'invoice', label: 'Faktury' },
  { key: 'shop', label: 'Sklep' },
  { key: 'events', label: 'Wydarzenia prywatne' },
];

function Modules({ settings, reload }: { settings: StudioSettings; reload: () => Promise<void> }) {
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const { run, busy } = useAction();
  const save = (patch: Partial<StudioSettings>) => run(() => api('/owner/settings', { method: 'PUT', body: patch }).then(reload), 'Zapisane');
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="eyebrow">Ogólne</div>
        <Toggle label="Automatyczna obecność po zajęciach (bez check-inu)" checked={s.autoAttend} onChange={(v) => save({ autoAttend: v })} />
        <Toggle label="Właścicielka widzi notatki trenerek" checked={s.ownerSeesTrainerNotes} onChange={(v) => save({ ownerSeesTrainerNotes: v })} />
        <Toggle label="Publiczne profile w społeczności" checked={s.communityPublicProfiles} onChange={(v) => save({ communityPublicProfiles: v })} />
        <div className="row">
          <Field label="Prośba o potwierdzenie obecności (min przed)">
            <input className="input" type="number" value={s.confirmBeforeMinutes} onChange={(e) => setS({ ...s, confirmBeforeMinutes: Number(e.target.value) })} onBlur={() => save({ confirmBeforeMinutes: s.confirmBeforeMinutes })} />
          </Field>
        </div>
      </section>
      {BLOCKS.map((b) => (
        <Block key={b.key} label={b.label} hint={b.hint} value={s[b.key] as Record<string, unknown>} busy={busy} onSave={(v) => save({ [b.key]: v } as Partial<StudioSettings>)} />
      ))}
    </div>
  );
}

function Block({ label, hint, value, busy, onSave }: { label: string; hint?: string; value: Record<string, unknown>; busy: boolean; onSave: (v: Record<string, unknown>) => void }) {
  const [v, setV] = useState(value);
  const [json, setJson] = useState<Record<string, string>>({});
  useEffect(() => setV(value), [value]);
  const NAMES: Record<string, string> = {
    maxTimes: 'Maks. razy',
    maxDays: 'Maks. dni',
    validityDays: 'Ważność (dni)',
    variants: 'Warianty',
    enabled: 'Włączone',
    afterDays: 'Po ilu dniach',
    body: 'Treść',
    hoursBefore: 'Godzin przed zajęciami',
    afterFirstMonth: 'Po pierwszym miesiącu',
    everyNthTraining: 'Co N treningów',
    surveyAfterDays: 'Ankieta po (dni)',
    offerAfterDays: 'Oferta po (dni)',
    offerPercent: 'Rabat powrotu %',
    hours: 'Godziny recepcji',
    autoReply: 'Autoodpowiedź poza godzinami',
    faq: 'FAQ',
    vatRate: 'VAT %',
    prefix: 'Prefiks numeru',
    sellerName: 'Sprzedawca',
    sellerAddress: 'Adres sprzedawcy',
    reservationDays: 'Rezerwacja do odbioru (dni)',
    shipping: 'Wysyłka',
    shippingGrosze: 'Koszt wysyłki (gr)',
    minNoticeDays: 'Min. wyprzedzenie (dni)',
    cancelDays: 'Bezpłatne odwołanie (dni)',
    regulations: 'Regulamin wydarzeń',
  };
  const save = () => {
    const out = { ...v };
    for (const [k, txt] of Object.entries(json)) {
      try {
        out[k] = JSON.parse(txt);
      } catch {
        return alert(`${NAMES[k] ?? k}: nieprawidłowy JSON`);
      }
    }
    onSave(out);
  };
  return (
    <section className="card stack">
      <div className="eyebrow">{label}</div>
      {hint && <span className="tiny muted">{hint}</span>}
      {Object.entries(v).map(([k, val]) =>
        typeof val === 'boolean' ? (
          <Toggle key={k} label={NAMES[k] ?? k} checked={val} onChange={(x) => setV({ ...v, [k]: x })} />
        ) : typeof val === 'number' ? (
          <Field key={k} label={NAMES[k] ?? k}>
            <input className="input" type="number" value={val} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
          </Field>
        ) : typeof val === 'string' ? (
          <Field key={k} label={NAMES[k] ?? k}>
            {val.length > 60 ? <textarea className="input" value={val} onChange={(e) => setV({ ...v, [k]: e.target.value })} /> : <input className="input" value={val} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
          </Field>
        ) : (
          <Field key={k} label={NAMES[k] ?? k}>
            <textarea className="input code" style={{ minHeight: 100, fontSize: 12 }} value={json[k] ?? JSON.stringify(val, null, 2)} onChange={(e) => setJson({ ...json, [k]: e.target.value })} />
          </Field>
        ),
      )}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={save}>
        Zapisz
      </button>
    </section>
  );
}

function Team({ cfg, reload }: { cfg: Cfg; reload: () => Promise<void> }) {
  const staff = useApi<{ id: string; name: string; phone: string; role: Role; bio: string | null }[]>('/owner/staff');
  const [f, setF] = useState({ phone: '', name: '', role: 'trainer' as Role });
  const { run, busy } = useAction();
  const people = [...new Map((staff.data ?? []).map((s) => [s.id, s])).values()];
  return (
    <div className="stack-lg">
      {people.map((p) => {
        const roles = staff.data!.filter((s) => s.id === p.id).map((s) => s.role);
        const quals = cfg.trainers.find((t) => t.id === p.id)?.classTypeIds;
        return (
          <section key={p.id} className="card flat stack gap-2">
            <div className="row between">
              <b>{p.name}</b>
              <span className="tiny muted">{p.phone}</span>
            </div>
            <div className="row wrap gap-1">
              {roles.map((r) => (
                <span key={r} className="chip">
                  {ROLE_LABEL[r] ?? r}{' '}
                  <button className="link tiny" aria-label={`Odbierz rolę ${r}`} onClick={() => window.confirm(`Odebrać rolę „${ROLE_LABEL[r]}”?`) && run(() => api(`/owner/staff/${p.id}/${r}`, { method: 'DELETE' }).then(() => (staff.reload(), reload())))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            {quals && (
              <div className="pill-row">
                <span className="tiny muted">Kwalifikacje:</span>
                {cfg.classTypes.map((c) => (
                  <button
                    key={c.id}
                    className="chip"
                    aria-pressed={quals.includes(c.id)}
                    onClick={() => run(() => api(`/owner/staff/${p.id}`, { method: 'PUT', body: { classTypeIds: quals.includes(c.id) ? quals.filter((x) => x !== c.id) : [...quals, c.id] } }).then(reload))}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <section className="card stack">
        <div className="eyebrow">Dodaj osobę do zespołu</div>
        <div className="row">
          <input className="input" inputMode="tel" placeholder="Telefon" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <input className="input" placeholder="Imię" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="chips">
          {(['trainer', 'reception', 'coordinator', 'owner'] as Role[]).map((r) => (
            <button key={r} className="chip" aria-pressed={f.role === r} onClick={() => setF({ ...f, role: r })}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <button className="btn" disabled={!f.phone || busy} onClick={() => run(() => api('/owner/staff', { method: 'POST', body: f }).then(() => (setF({ ...f, phone: '', name: '' }), staff.reload(), reload())), 'Dodane – dostanie SMS z zaproszeniem')}>
          Dodaj
        </button>
      </section>
    </div>
  );
}

function DataTools({ cfg, reload }: { cfg: Cfg; reload: () => Promise<void> }) {
  const [csv, setCsv] = useState('');
  const [report, setReport] = useState<{ clients: number; passes: number; errors: string[]; dryRun?: boolean } | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const [gw, setGw] = useState({ provider: cfg.gateway.provider ?? 'p24', merchantId: cfg.gateway.merchantId ?? '', apiKey: '', crc: '' });
  const audit = useApi<{ action: string; entity: string; created_at: string; actor: string | null }[]>('/owner/audit');
  const { run, busy } = useAction();
  const importCsv = (dryRun: boolean) => run(() => api<typeof report>('/owner/import/clients', { method: 'POST', body: { csv, dryRun } }).then((r) => (setReport(r), dryRun ? undefined : reload())));
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="eyebrow">Szablon branżowy</div>
        <p className="small muted" style={{ margin: 0 }}>Gotowe strefy, typy zajęć i karnety – dodawane obok istniejących.</p>
        <div className="row wrap">
          {cfg.presets.map((p) => (
            <button key={p.id} className="btn ghost sm" title={p.description} onClick={() => window.confirm(`Dodać szablon „${p.label}”?`) && run(() => api(`/owner/presets/${p.id}/apply`, { method: 'POST' }).then((r) => (reload(), r)))}>
              {p.label}
            </button>
          ))}
        </div>
      </section>
      <section className="card stack">
        <div className="eyebrow">Import klientek z CSV</div>
        <p className="tiny muted" style={{ margin: 0 }}>Kolumny: telefon;imię;email;karnet;wejścia;ważny_do – najpierw sprawdzimy plik bez zapisywania.</p>
        <label className="btn ghost sm" style={{ alignSelf: 'flex-start' }}>
          Wybierz plik
          <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => e.target.files?.[0] && setCsv(await e.target.files[0].text())} />
        </label>
        <textarea className="input code" style={{ minHeight: 90, fontSize: 12 }} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="telefon;imię;email" />
        <div className="row">
          <button className="btn ghost sm" disabled={!csv || busy} onClick={() => importCsv(true)}>
            Sprawdź
          </button>
          <button className="btn sm" disabled={!csv || busy || !report?.dryRun} onClick={() => importCsv(false)}>
            Importuj
          </button>
        </div>
        {report && (
          <div className="small">
            {report.dryRun ? 'Podgląd: ' : 'Zaimportowano: '}
            {report.clients} klientek, {report.passes} karnetów
            {report.errors.map((e) => (
              <div key={e} className="tiny" style={{ color: 'var(--danger)' }}>
                {e}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="card stack">
        <div className="eyebrow">Konfiguracja i kopia danych</div>
        <div className="row wrap">
          <button className="btn ghost sm" onClick={() => download('/owner/config/export', 'konfiguracja.json')}>
            Eksport konfiguracji (JSON)
          </button>
          <label className="btn ghost sm">
            Import konfiguracji
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f && window.confirm('Zaimportować konfigurację? Istniejące elementy zostaną, nowe zostaną dodane.')) await run(async () => api('/owner/config/import', { method: 'POST', body: { config: JSON.parse(await f.text()) } }).then((r) => (reload(), r)), 'Konfiguracja zaimportowana');
              }}
            />
          </label>
          <button className="btn ghost sm" onClick={() => download('/owner/backup', 'kopia-studia.json')}>
            Kopia wszystkich danych
          </button>
          <button className="btn ghost sm" onClick={() => run(() => api<{ phone: string }>('/owner/test-account', { method: 'POST' }).then((r) => setTest(r.phone)))}>
            Konto testowe klientki
          </button>
        </div>
        {test && <span className="small">Konto testowe: zaloguj się w aplikacji numerem <b>{test}</b> (kod SMS w trybie demo pokazuje się na ekranie).</span>}
      </section>
      <section className="card stack">
        <div className="eyebrow">Bramka płatności {cfg.gateway.connected ? `· połączona (${cfg.gateway.provider}, klucz ${cfg.gateway.apiKey})` : '· niepołączona'}</div>
        <div className="chips">
          {['p24', 'payu', 'tpay', 'stripe'].map((p) => (
            <button key={p} className="chip" aria-pressed={gw.provider === p} onClick={() => setGw({ ...gw, provider: p })}>
              {p === 'p24' ? 'Przelewy24' : p === 'payu' ? 'PayU' : p === 'tpay' ? 'Tpay' : 'Stripe'}
            </button>
          ))}
        </div>
        <div className="row">
          <input className="input" placeholder="Merchant ID" value={gw.merchantId} onChange={(e) => setGw({ ...gw, merchantId: e.target.value })} />
          <input className="input" type="password" placeholder="Klucz API" value={gw.apiKey} onChange={(e) => setGw({ ...gw, apiKey: e.target.value })} autoComplete="off" />
          <input className="input" type="password" placeholder="CRC (P24)" value={gw.crc} onChange={(e) => setGw({ ...gw, crc: e.target.value })} autoComplete="off" />
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>Klucze zapisujemy zaszyfrowane. Wpisuje je właścicielka – pieniądze trafiają bezpośrednio na konto studia.</p>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!gw.merchantId || !gw.apiKey || busy} onClick={() => run(() => api('/owner/gateway', { method: 'PUT', body: gw }).then(() => (setGw({ ...gw, apiKey: '', crc: '' }), reload())), 'Bramka zapisana')}>
          Zapisz bramkę
        </button>
      </section>
      <section className="stack">
        <div className="eyebrow">Dziennik zmian</div>
        {audit.data?.slice(0, 40).map((a, i) => (
          <div key={i} className="small">
            <span className="muted">{fmtDay(a.created_at)}</span> · {a.actor ?? 'system'} · {a.action}
          </div>
        ))}
      </section>
    </div>
  );
}

function PlanSupport() {
  const plan = useApi<{ plan: { name: string; price: string; limits: Record<string, number> }; status: string; trialEndsAt: string | null; features: Record<string, boolean>; usage: { activeClients: number; smsThisMonth: number; smsCost: string; storageMb: number; staff: number; facilities: number } }>('/owner/plan');
  const tickets = useApi<{ id: string; subject: string; status: string; priority: string; sla_due_at: string; messages: { body: string; from_platform: number; name: string; created_at: string }[] }[]>('/owner/tickets');
  const [t, setT] = useState({ subject: '', body: '', priority: 'normal', grantDataAccess: false });
  const [reply, setReply] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  if (!plan.data) return <Spinner />;
  const u = plan.data.usage;
  const L = plan.data.plan.limits;
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="row between">
          <b>
            Plan {plan.data.plan.name} · {plan.data.plan.price}/mies.
          </b>
          <span className="badge">{plan.data.status === 'trial' ? `okres próbny do ${plan.data.trialEndsAt?.slice(0, 10)}` : plan.data.status}</span>
        </div>
        <div className="kpis">
          <Stat label="Aktywne klientki" value={`${u.activeClients}/${L.activeClients}`} />
          <Stat label="SMS w tym miesiącu" value={`${u.smsThisMonth}/${L.smsPerMonth}`} hint={u.smsCost} />
          <Stat label="Wideo" value={`${u.storageMb}/${L.videoMb} MB`} />
          <Stat label="Zespół" value={`${u.staff}/${L.staff}`} hint={`obiekty ${u.facilities}/${L.facilities}`} />
        </div>
        <div className="pill-row">
          {Object.entries(plan.data.features).map(([f, on]) => (
            <span key={f} className="chip" aria-pressed={on} style={{ opacity: on ? 1 : 0.45 }}>
              {f}
            </span>
          ))}
        </div>
      </section>
      <section className="card stack">
        <div className="eyebrow">Napisz do zespołu GLAM</div>
        <input className="input" placeholder="Temat" value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} />
        <textarea className="input" placeholder="Opisz, co się dzieje" value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} />
        <div className="chips">
          {[
            ['low', 'Niski'],
            ['normal', 'Normalny'],
            ['high', 'Wysoki'],
            ['urgent', 'Pilne – studio stoi'],
          ].map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={t.priority === k} onClick={() => setT({ ...t, priority: k })}>
              {l}
            </button>
          ))}
        </div>
        <Toggle label="Zgoda na wgląd w dane studia na czas zgłoszenia" hint="Każdy dostęp trafia do dziennika i wygasa po zamknięciu zgłoszenia." checked={t.grantDataAccess} onChange={(v) => setT({ ...t, grantDataAccess: v })} />
        <button className="btn" disabled={!t.subject || !t.body || busy} onClick={() => run(() => api<{ slaHours: number }>('/owner/tickets', { method: 'POST', body: t }).then((r) => (setT({ ...t, subject: '', body: '' }), tickets.reload(), r)), (r) => `Wysłane – odpowiemy w ciągu ${r?.slaHours} h`)}>
          Wyślij
        </button>
      </section>
      {tickets.data?.map((x) => (
        <section key={x.id} className="card flat stack gap-2">
          <div className="row between">
            <b>{x.subject}</b>
            <span className="badge">
              {x.status} · SLA {fmtDay(x.sla_due_at)}
            </span>
          </div>
          {x.messages.map((m, i) => (
            <div key={i} className={`chat-bubble ${m.from_platform ? '' : 'mine'}`}>
              <span className="tiny muted">{m.from_platform ? 'GLAM' : m.name}</span>
              <div className="small">{m.body}</div>
            </div>
          ))}
          <div className="row">
            <input className="input" placeholder="Odpowiedz" value={reply[x.id] ?? ''} onChange={(e) => setReply({ ...reply, [x.id]: e.target.value })} />
            <button className="btn sm" disabled={!reply[x.id]} onClick={() => run(() => api(`/owner/tickets/${x.id}`, { method: 'POST', body: { body: reply[x.id] } }).then(() => (setReply({ ...reply, [x.id]: '' }), tickets.reload())))}>
              Wyślij
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

