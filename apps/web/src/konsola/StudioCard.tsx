// Karta studia w konsoli: plan i rozliczenia, zużycie limitów, funkcje (flagi), technikalia, kontakt i historia.
// Bez danych klientek – tylko liczby i dane firmy. Zmiany wg roli: plan, flagi, zawieszenie i rozliczenia poza systemem
// tylko admin; przedłużenie triala i „Wejście w dane studia” admin + wsparcie; finanse oglądają bez przycisków.
import { useState, type ReactNode } from 'react';
import { FEATURE_LABEL, formatPLN, PLANS, plural, planById, type Feature, type LimitUsage } from '@glam/core';
import { api, fmtPhone, fmtTime, useApi } from '../api.ts';
import { Fold, Pending, Progress, Select, Sheet, Tabs, useAction } from '../ui.tsx';
import type { Go, PlatformRole } from './KonsolaApp.tsx';

type Detail = {
  studio: {
    id: string;
    name: string;
    slug: string;
    city: string | null;
    email: string | null;
    phone: string | null;
    nip: string | null;
    address: string | null;
    plan_id: string | null;
    status: string;
    trial_ends_at: string | null;
    created_at: string;
  };
  billing: {
    state: 'none' | 'active' | 'past_due' | 'canceled';
    current_period_end: string | null;
    past_due_since: string | null;
    cancel_at_period_end: number;
    manual_suspension: string | null;
    company_name: string | null;
    nip: string | null;
    address: string | null;
    invoice_email: string | null;
  };
  usage: LimitUsage[];
  flags: Record<string, boolean>;
  metrics: { requests7d: number; errors7d: number; avgMs: number; storageMb: number };
  owner: { name: string | null; phone: string; email: string | null } | null;
  audit: { id: string; created_at: string; action: string; actor: string; details: Record<string, any> | null }[];
};

const DAY = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'numeric', year: 'numeric' });
const date = (iso: string) => DAY.format(new Date(iso));
const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

/** Stan studia po ludzku: zawieszone i trial z `studios.status`, zaległość z rozliczeń. */
export function studioState(status: string, billingState: string): { label: string; tone: '' | 'ok' | 'warn' } {
  if (status === 'suspended') return { label: 'Zawieszone', tone: 'warn' };
  if (billingState === 'past_due') return { label: 'Zaległa płatność', tone: 'warn' };
  if (status === 'trial') return { label: 'Trial', tone: '' };
  return { label: 'Aktywne', tone: 'ok' };
}

const SUBSCRIPTION: Record<Detail['billing']['state'], string> = { none: 'brak karty', active: 'aktywna', past_due: 'płatność zaległa', canceled: 'anulowana' };
const LIMIT_STATE: Record<'near' | 'over', string> = { near: 'blisko limitu', over: 'ponad limitem' };
type FlagChoice = 'inherit' | 'on' | 'off';
const FLAG_CHOICES: [FlagChoice, string][] = [
  ['inherit', 'Jak w planie'],
  ['on', 'Wł.'],
  ['off', 'Wył.'],
];
const FLAG_VALUE: Record<FlagChoice, boolean | null> = { inherit: null, on: true, off: false };
const TRIAL_CHOICES = [7, 14, 30];

/** Wpis historii: nazwa działania i krótki opis szczegółów. */
function describeAudit(action: string, d: Record<string, any> | null): { title: string; detail?: string } {
  const planName = (id: string | null | undefined) => (id ? planById(id).name : 'brak');
  switch (action) {
    case 'studio.plan':
      return { title: 'Zmiana planu', detail: `${planName(d?.from)} → ${planName(d?.to)}` };
    case 'studio.suspend':
      return { title: 'Zawieszenie', detail: d?.reason };
    case 'studio.unsuspend':
      return { title: 'Zdjęcie zawieszenia' };
    case 'studio.trial':
      return { title: 'Przedłużenie triala', detail: d?.days && d.to ? `o ${d.days} dni, do ${date(d.to)}` : undefined };
    case 'studio.offline_billing':
      return { title: 'Rozliczane poza systemem' };
    case 'studio.flag': {
      const label = FEATURE_LABEL[d?.flag as Feature] ?? d?.flag;
      return { title: 'Zmiana funkcji', detail: `${label}: ${d?.enabled === null ? 'jak w planie' : d?.enabled ? 'włączona' : 'wyłączona'}` };
    }
    case 'studio.fill':
      return { title: 'Uzupełnienie grafiku' };
    case 'payment.invoiced':
      return { title: 'Płatność zafakturowana', detail: d?.number };
    default:
      return { title: action };
  }
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="konsola-line">
      <span className="muted small">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function StudioCard({ studioId, role, go }: { studioId: string; role: PlatformRole; go: Go }) {
  const { data, error, reload } = useApi<Detail>(`/platform/studios/${studioId}`, [], { global: true });
  const { run } = useAction();
  const [sheet, setSheet] = useState<'suspend' | 'offline' | 'trial' | 'access' | null>(null);
  const isAdmin = role === 'admin';
  const canSupport = role === 'admin' || role === 'support';

  if (!data) return <Pending error={error} reload={reload} />;
  const { studio, billing, usage, flags, metrics, owner, audit } = data;
  const plan = planById(studio.plan_id);
  const state = studioState(studio.status, billing.state);
  const base = `/platform/studios/${studioId}`;
  const post = (path: string, body?: unknown, method = 'POST') => api(`${base}${path}`, { method, body, global: true });
  /** Wywołuje akcję, a po sukcesie odświeża kartę. */
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    const done = await run(fn, ok);
    if (done !== undefined) await reload();
    return done !== undefined;
  };

  const setFlag = (flag: string, choice: FlagChoice) => act(() => post('/flags', { flag, enabled: FLAG_VALUE[choice] }, 'PUT'), 'Zapisano');
  const overrides = Object.keys(flags).length;
  const features = Object.entries(FEATURE_LABEL) as [Feature, string][];

  return (
    <div className="stack-lg">
      <div className="stack gap-2">
        <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => go('studios')}>
          ← Studia
        </button>
        <div className="row between wrap">
          <div>
            <h1 style={{ marginBottom: 0 }}>{studio.name}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {[studio.city, `od ${date(studio.created_at)}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <span className={`badge ${state.tone}`}>{state.label}</span>
        </div>
        {canSupport && (
          <div className="row wrap">
            {studio.trial_ends_at && (
              <button className="btn quiet sm" onClick={() => setSheet('trial')}>
                Przedłuż trial
              </button>
            )}
            <button className="btn quiet sm" onClick={() => setSheet('access')}>
              Wejście w dane studia
            </button>
            {isAdmin && studio.trial_ends_at && (
              <button className="btn quiet sm" onClick={() => setSheet('offline')}>
                Rozliczane poza systemem
              </button>
            )}
            {isAdmin &&
              (billing.manual_suspension ? (
                <button className="btn quiet sm" onClick={() => act(() => post('/unsuspend'), 'Zawieszenie zdjęte')}>
                  Zdejmij zawieszenie
                </button>
              ) : (
                <button className="btn quiet sm" onClick={() => setSheet('suspend')}>
                  Zawieś
                </button>
              ))}
          </div>
        )}
      </div>

      <section className="stack gap-2">
        <h3>Plan i rozliczenia</h3>
        <div>
          <Line label="Plan">
            {isAdmin ? (
              <Select
                ariaLabel="Plan studia"
                value={plan.id}
                options={PLANS.map((p) => ({ value: p.id, label: `${p.name} · ${formatPLN(p.priceGrosze)}` }))}
                onChange={(planId) => planId !== plan.id && act(() => post('', { planId }, 'PUT'), 'Plan zmieniony')}
              />
            ) : (
              `${plan.name} · ${formatPLN(plan.priceGrosze)}`
            )}
          </Line>
          <Line label="Stan">{state.label}</Line>
          {billing.manual_suspension && <Line label="Zawieszone ręcznie">{billing.manual_suspension}</Line>}
          {studio.trial_ends_at ? (
            <Line label="Trial">
              do {date(studio.trial_ends_at)}
              {Date.parse(studio.trial_ends_at) > Date.now() && ` · jeszcze ${daysLeft(studio.trial_ends_at)} ${plural(daysLeft(studio.trial_ends_at), 'dzień', 'dni', 'dni')}`}
            </Line>
          ) : (
            <Line label="Okres próbny">rozliczane poza systemem</Line>
          )}
          <Line label="Subskrypcja">
            {SUBSCRIPTION[billing.state]}
            {billing.state === 'past_due' && billing.past_due_since && ` od ${date(billing.past_due_since)}`}
          </Line>
          {billing.current_period_end && (
            <Line label={billing.cancel_at_period_end ? 'Kończy się' : 'Opłacone do'}>{date(billing.current_period_end)}</Line>
          )}
        </div>
      </section>

      <section className="stack gap-2">
        <h3>Zużycie planu</h3>
        <div className="stack">
          {usage.map((u) => (
            <div key={u.key} className="stack gap-1">
              <div className="row between">
                <span>{u.label}</span>
                <span className="row gap-2">
                  {u.state !== 'ok' && <span className={u.state === 'over' ? 'badge warn' : 'badge'}>{LIMIT_STATE[u.state]}</span>}
                  <b>
                    {u.used} / {u.limit}
                  </b>
                </span>
              </div>
              <Progress value={u.used} max={u.limit} label={u.label} />
            </div>
          ))}
        </div>
      </section>

      <Fold title="Funkcje" meta={overrides ? `${overrides} ustawione ręcznie` : 'jak w planie'}>
        <div className="stack">
          {features
            .filter(([key]) => isAdmin || key in flags)
            .map(([key, label]) => {
              const effective = key in flags ? flags[key] : plan.features.includes(key);
              const choice: FlagChoice = !(key in flags) ? 'inherit' : flags[key] ? 'on' : 'off';
              return (
                <div key={key} className="stack gap-1">
                  <div className="row between">
                    <span>{label}</span>
                    <span className="small muted">{effective ? 'działa' : 'wyłączona'}</span>
                  </div>
                  {isAdmin ? (
                    <Tabs label={label} value={choice} options={FLAG_CHOICES} onChange={(c) => c !== choice && setFlag(key, c)} />
                  ) : (
                    <span className="small muted">{flags[key] ? 'Włączona ręcznie' : 'Wyłączona ręcznie'}</span>
                  )}
                </div>
              );
            })}
          {!isAdmin && overrides === 0 && <p className="small muted" style={{ margin: 0 }}>Wszystkie funkcje jak w planie.</p>}
        </div>
      </Fold>

      <section className="stack gap-2">
        <h3>Technikalia</h3>
        <div>
          <Line label="Zapytania (7 dni)">{metrics.requests7d}</Line>
          <Line label="Błędy (7 dni)">{metrics.errors7d}</Line>
          <Line label="Średni czas odpowiedzi">{metrics.avgMs} ms</Line>
          <Line label="Pliki">{metrics.storageMb} MB</Line>
        </div>
      </section>

      <section className="stack gap-2">
        <h3>Kontakt i firma</h3>
        <div>
          {owner && <Line label="Właścicielka">{owner.name ?? '—'}</Line>}
          {owner && <Line label="Telefon">{fmtPhone(owner.phone)}</Line>}
          {owner?.email && (
            <Line label="E-mail">
              <a href={`mailto:${owner.email}`}>{owner.email}</a>
            </Line>
          )}
          {!owner && <p className="small muted" style={{ margin: 0 }}>Studio nie ma jeszcze właścicielki.</p>}
          {billing.company_name && <Line label="Firma">{billing.company_name}</Line>}
          {(billing.nip ?? studio.nip) && <Line label="NIP">{billing.nip ?? studio.nip}</Line>}
          {(billing.address ?? studio.address) && <Line label="Adres">{billing.address ?? studio.address}</Line>}
          {billing.invoice_email && <Line label="E-mail do faktur">{billing.invoice_email}</Line>}
          {studio.email && <Line label="E-mail studia">{studio.email}</Line>}
          {studio.phone && <Line label="Telefon studia">{fmtPhone(studio.phone)}</Line>}
        </div>
      </section>

      <section className="stack gap-2">
        <h3>Historia</h3>
        {audit.length === 0 && <p className="small muted" style={{ margin: 0 }}>Brak zmian w konsoli.</p>}
        <div>
          {audit.map((e) => {
            const d = describeAudit(e.action, e.details);
            return (
              <div key={e.id} className="konsola-line">
                <span>
                  {d.title}
                  {d.detail && <span className="small muted" style={{ display: 'block' }}>{d.detail}</span>}
                </span>
                <span className="small muted">
                  {e.actor} · {date(e.created_at)} {fmtTime(e.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {sheet === 'suspend' && (
        <ReasonSheet
          label="Zawieszenie studia"
          title={`Zawieś ${studio.name}`}
          intro="Klientki tracą dostęp do studia, a właścicielka dostaje e-mail. Panel studia zostaje dostępny."
          cta="Zawieś studio"
          onClose={() => setSheet(null)}
          onSubmit={(reason) => act(() => post('/suspend', { reason }), 'Studio zawieszone')}
        />
      )}
      {sheet === 'access' && (
        <ReasonSheet
          label="Wejście w dane studia"
          title="Wejście w dane studia"
          intro="Podaj powód, np. numer zgłoszenia. Wejście trafia do dziennika dostępu."
          cta="Zapisz wejście"
          onClose={() => setSheet(null)}
          onSubmit={async (reason) => {
            const done = await run(() => api('/platform/access', { method: 'POST', body: { studioId, reason }, global: true }), 'Wejście zapisane w dzienniku');
            return done !== undefined;
          }}
        />
      )}
      {sheet === 'trial' && <TrialSheet onClose={() => setSheet(null)} onSubmit={(days) => act(() => post('/trial', { days }), `Trial przedłużony o ${days} dni`)} />}
      {sheet === 'offline' && (
        <Sheet onClose={() => setSheet(null)} label="Rozliczanie poza systemem">
          <div className="stack">
            <h2>Rozliczane poza systemem</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Studio przestaje mieć okres próbny i zostaje aktywne bez płatności w GLAM (faktura, umowa). Zawieszenie ręczne nadal wygrywa.
            </p>
            <button
              className="btn"
              onClick={async () => {
                if (await act(() => post('/offline-billing'), 'Studio rozliczane poza systemem')) setSheet(null);
              }}
            >
              Potwierdź
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Okno z polem powodu: przycisk aktywny dopiero od 10 znaków (tyle wymaga serwer), licznik pokazuje, ile brakuje. */
function ReasonSheet({ label, title, intro, cta, onClose, onSubmit }: { label: string; title: string; intro: string; cta: string; onClose: () => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const missing = 10 - reason.trim().length;
  return (
    <Sheet onClose={onClose} label={label}>
      <div className="stack">
        <h2>{title}</h2>
        <p className="small muted" style={{ margin: 0 }}>{intro}</p>
        <div className="field">
          <label htmlFor="konsola-reason">Powód</label>
          <textarea id="konsola-reason" className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <span className="tiny muted">{missing > 0 ? `Jeszcze ${missing} ${plural(missing, 'znak', 'znaki', 'znaków')} (min. 10)` : ' '}</span>
        </div>
        <button
          className="btn"
          disabled={missing > 0 || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await onSubmit(reason.trim());
            setBusy(false);
            if (ok) onClose();
          }}
        >
          {cta}
        </button>
      </div>
    </Sheet>
  );
}

function TrialSheet({ onClose, onSubmit }: { onClose: () => void; onSubmit: (days: number) => Promise<boolean> }) {
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet onClose={onClose} label="Przedłużenie triala">
      <div className="stack">
        <h2>Przedłuż trial</h2>
        <p className="small muted" style={{ margin: 0 }}>Liczymy od późniejszej z dat: dziś albo obecnego końca triala. Właścicielka dostanie nowe przypomnienia.</p>
        <Tabs label="Liczba dni" value={String(days)} options={TRIAL_CHOICES.map((d) => [String(d), `${d} dni`] as [string, string])} onChange={(v) => setDays(Number(v))} />
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await onSubmit(days);
            setBusy(false);
            if (ok) onClose();
          }}
        >
          Przedłuż o {days} dni
        </button>
      </div>
    </Sheet>
  );
}
