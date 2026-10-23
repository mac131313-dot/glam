// Abonament GLAM w panelu studia (właścicielka): plan i stan, liczniki limitów, dane do faktury, karta (Stripe Checkout
// i Billing Portal), zmiana planu, rezygnacja i lista opłaconych okresów. Bez Stripe GLAM (`configured: false`)
// zamiast przycisków płatności jest jedno zdanie, a dane do faktury i liczniki działają dalej.
import { useState } from 'react';
import { BILLING_GRACE_DAYS, validEmail, validNip, type LimitUsage } from '@glam/core';
import { api, useApi } from '../api.ts';
import { Field, ListRow, Pending, Progress, Sheet, useAction, useToast } from '../ui.tsx';

type PlanInfo = { id: string; name: string; price: string; limits: { activeClients: number; smsPerMonth: number; staff: number }; featureLabels: string[] };
type BillingData = {
  configured: boolean;
  plan: { id: string; name: string; price: string };
  status: 'trial' | 'active' | 'suspended';
  trialEndsAt: string | null;
  billing: {
    state: 'none' | 'active' | 'past_due' | 'canceled';
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    pendingPlanId: string | null;
    pastDueSince: string | null;
    companyName: string | null;
    nip: string | null;
    address: string | null;
    invoiceEmail: string | null;
    hasCard: boolean;
  };
  usage: LimitUsage[];
  payments: { periodStart: string; periodEnd: string; amount: string; paidAt: string }[];
  plans: PlanInfo[];
};

const DAY_MS = 86_400_000;
const SHORT = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'numeric' });
const short = (iso: string | number) => SHORT.format(new Date(iso));

const daysWord = (n: number) => (n === 1 ? '1 dzień' : `${n} dni`);

/** Jedno zdanie o stanie abonamentu. */
function stateLine(d: BillingData): string {
  const { billing: b } = d;
  const next = d.plans.find((p) => p.id === b.pendingPlanId) ?? d.plan;
  if (b.state === 'past_due') {
    const until = b.pastDueSince ? short(Date.parse(b.pastDueSince) + BILLING_GRACE_DAYS * DAY_MS) : null;
    return `Płatność nieudana – zaktualizuj kartę${until ? ` do ${until}` : ''}`;
  }
  if (b.state === 'active') {
    if (b.cancelAtPeriodEnd && b.currentPeriodEnd) return `Abonament wygasa ${short(b.currentPeriodEnd)} – do tego dnia studio działa normalnie`;
    return b.currentPeriodEnd ? `Następna płatność ${short(b.currentPeriodEnd)} · ${next.price}` : 'Abonament aktywny';
  }
  if (b.state === 'canceled') return b.currentPeriodEnd && Date.parse(b.currentPeriodEnd) > Date.now() ? `Abonament zakończony – studio działa do ${short(b.currentPeriodEnd)}` : 'Abonament zakończony';
  if (d.status === 'trial' && d.trialEndsAt) {
    const left = Math.max(1, Math.ceil((Date.parse(d.trialEndsAt) - Date.now()) / DAY_MS));
    return `Okres próbny – ${left === 1 ? 'został 1 dzień' : `zostało ${left} dni`}`;
  }
  if (d.status === 'suspended') return 'Dostęp klientek do studia jest wstrzymany';
  return 'Bez abonamentu – studio działa normalnie';
}

export function Billing({ onChanged }: { onChanged: () => unknown }) {
  const { data, error, reload } = useApi<BillingData>('/owner/billing');
  const [sheet, setSheet] = useState<'plan' | 'cancel' | null>(null);
  const { run, busy } = useAction();
  const toast = useToast();
  if (!data) return <Pending error={error} reload={reload} />;
  const { billing: b } = data;
  const detailsReady = !!b.companyName && !!b.nip;
  const refresh = async () => {
    await reload();
    await onChanged();
  };
  /** Stripe prowadzi dalej na swojej stronie (Checkout, Billing Portal) i wraca na /panel. */
  const redirect = (path: string, body?: object) =>
    run(async () => {
      const r = await api<{ url: string }>(path, { method: 'POST', body });
      location.href = r.url;
    });
  const resume = () => run(() => api('/owner/billing/resume', { method: 'POST' }).then(refresh), 'Abonament wznowiony');
  const nearOrOver = data.usage.some((u) => u.state !== 'ok');
  const higher = data.plans[data.plans.findIndex((p) => p.id === data.plan.id) + 1];

  return (
    <div className="stack-lg">
      <section className="stack gap-2">
        <div className="eyebrow">Abonament</div>
        <h2 style={{ margin: 0 }}>
          Plan {data.plan.name} · {data.plan.price}/mies.
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          {stateLine(data)}
        </p>
        {b.pendingPlanId && b.currentPeriodEnd && (
          <p className="small muted" style={{ margin: 0 }}>
            Od {short(b.currentPeriodEnd)}: plan {data.plans.find((p) => p.id === b.pendingPlanId)?.name}
          </p>
        )}
        {data.configured && !b.hasCard && (
          <div className="stack gap-2" style={{ alignItems: 'flex-start', marginTop: 8 }}>
            <button className="btn" disabled={!detailsReady || busy} onClick={() => redirect('/owner/billing/checkout', { planId: data.plan.id })}>
              Dodaj kartę
            </button>
            {!detailsReady && <span className="small muted">Najpierw uzupełnij dane do faktury</span>}
          </div>
        )}
      </section>

      <section className="stack gap-2">
        <div className="eyebrow">Limity planu</div>
        {data.usage.map((u) => (
          <div key={u.key} className="stack gap-1">
            <div className="row between small">
              <span>
                {u.label}
                {u.state !== 'ok' && <span className="badge warn" style={{ marginLeft: 8 }}>{u.state === 'over' ? 'Przekroczony' : 'Blisko limitu'}</span>}
              </span>
              <span className="muted">
                {u.used} / {u.limit}
              </span>
            </div>
            <Progress value={u.used} max={u.limit} label={u.label} />
          </div>
        ))}
        {nearOrOver && (
          <p className="small muted" style={{ margin: 0 }}>
            {higher ? `Plan ${higher.name} (${higher.price}/mies.) ma wyższe limity.` : 'To najwyższy plan – napisz do nas, jeśli potrzebujesz więcej.'}
            {data.configured && higher && (
              <>
                {' '}
                <button className="link" onClick={() => setSheet('plan')}>
                  Zmień plan
                </button>
              </>
            )}
          </p>
        )}
      </section>

      {data.configured ? (
        <div className="list-rows">
          <ListRow title="Zmień plan" hint={`Teraz: ${data.plan.name}`} onClick={() => setSheet('plan')} />
          {b.hasCard && <ListRow title="Karta i płatności" hint="Zmiana karty, historia płatności w Stripe" onClick={() => redirect('/owner/billing/portal')} />}
          {b.hasCard && !b.cancelAtPeriodEnd && <ListRow title="Zrezygnuj" hint="Abonament nie odnowi się po opłaconym okresie" onClick={() => setSheet('cancel')} />}
          {b.hasCard && b.cancelAtPeriodEnd && <ListRow title="Wznów" hint="Abonament znów będzie się odnawiał" onClick={resume} />}
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Płatności abonamentu wkrótce – do tego czasu studio działa normalnie.
        </p>
      )}

      <InvoiceDetails billing={b} onSaved={reload} />

      {data.payments.length > 0 && (
        <section className="stack gap-2">
          <div className="eyebrow">Opłacone okresy</div>
          <div>
            {data.payments.map((p) => (
              <div key={p.paidAt} className="konsola-line">
                <span className="small">
                  {short(p.periodStart)} – {short(p.periodEnd)}
                </span>
                <span>{p.amount}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {sheet === 'plan' && (
        <PlanSheet
          data={data}
          detailsReady={detailsReady}
          busy={busy}
          onClose={() => setSheet(null)}
          onCheckout={(planId) => redirect('/owner/billing/checkout', { planId })}
          onChange={(planId) =>
            run(async () => {
              const r = await api<{ effective: 'now' | 'next_period' }>('/owner/billing/plan', { method: 'POST', body: { planId } });
              setSheet(null);
              await refresh();
              toast(r.effective === 'now' ? 'Plan zmieniony' : `Plan zmieni się od ${b.currentPeriodEnd ? short(b.currentPeriodEnd) : 'następnego okresu'}`);
            })
          }
        />
      )}
      {sheet === 'cancel' && (
        <Sheet onClose={() => setSheet(null)} label="Rezygnacja z abonamentu">
          <div className="stack">
            <h2 style={{ marginBottom: 0 }}>Zrezygnować z abonamentu?</h2>
            <p className="muted" style={{ margin: 0 }}>
              Abonament nie odnowi się. Studio działa normalnie {b.currentPeriodEnd ? `do ${short(b.currentPeriodEnd)}` : 'do końca opłaconego okresu'}, potem dostęp klientek zostanie wstrzymany. Do tego dnia możesz wznowić abonament.
            </p>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api('/owner/billing/cancel', { method: 'POST' });
                  setSheet(null);
                  await refresh();
                }, 'Abonament nie odnowi się')
              }
            >
              Zrezygnuj
            </button>
            <button className="btn quiet" onClick={() => setSheet(null)}>
              Zostaję
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Trzy plany z informacją, kiedy zmiana zadziała; wybór dopiero po potwierdzeniu (zmiana na droższy płaci się od razu). */
function PlanSheet({ data, detailsReady, busy, onClose, onCheckout, onChange }: { data: BillingData; detailsReady: boolean; busy: boolean; onClose: () => void; onCheckout: (planId: string) => unknown; onChange: (planId: string) => unknown }) {
  const { billing: b } = data;
  const currentIdx = data.plans.findIndex((p) => p.id === data.plan.id);
  const [picked, setPicked] = useState<string | null>(null);
  const when = (idx: number) => (idx > currentIdx ? 'od razu' : `od ${b.currentPeriodEnd ? short(b.currentPeriodEnd) : 'następnego okresu'}`);
  const target = data.plans.find((p) => p.id === picked);
  const targetIdx = data.plans.findIndex((p) => p.id === picked);
  // Wybór obecnego planu przy zaplanowanym obniżeniu cofa to obniżenie.
  const undoPending = b.hasCard && !!b.pendingPlanId && picked === data.plan.id;

  const badge = (p: PlanInfo, idx: number) => {
    const sel = picked === p.id;
    if (!b.hasCard) return idx === currentIdx ? <span className="badge">Twój plan</span> : sel ? <span className="badge ok">wybrany</span> : undefined;
    if (idx === currentIdx) return sel ? <span className="badge ok">Twój plan</span> : <span className="badge">Twój plan</span>;
    return <span className={sel ? 'badge ok' : 'badge'}>{when(idx)}</span>;
  };
  const canPick = (p: PlanInfo, idx: number) => !b.hasCard || idx !== currentIdx || (!!b.pendingPlanId && p.id === data.plan.id);
  const noop = () => {};

  return (
    <Sheet onClose={onClose} label="Zmień plan">
      <div className="stack">
        <h2 style={{ marginBottom: 0 }}>{b.hasCard ? 'Zmień plan' : 'Wybierz plan'}</h2>
        <div className="list-rows">
          {data.plans.map((p, idx) => (
            <ListRow
              key={p.id}
              title={`${p.name} · ${p.price}/mies.`}
              hint={`${p.limits.activeClients} aktywnych klientek · ${p.limits.smsPerMonth} SMS · zespół do ${p.limits.staff} osób`}
              badge={badge(p, idx)}
              onClick={canPick(p, idx) ? () => setPicked(p.id) : noop}
            />
          ))}
        </div>
        {target && b.hasCard && !undoPending && (
          <p className="small muted" style={{ margin: 0 }}>
            {targetIdx > currentIdx ? 'Plan zadziała od razu, dopłatę za bieżący okres policzy Stripe.' : `Do ${b.currentPeriodEnd ? short(b.currentPeriodEnd) : 'końca okresu'} masz obecne limity, potem plan ${target.name}.`}
          </p>
        )}
        {target && !b.hasCard && !detailsReady && <p className="small muted" style={{ margin: 0 }}>Najpierw uzupełnij dane do faktury</p>}
        {target && (
          <button
            className="btn"
            disabled={busy || (!b.hasCard && !detailsReady)}
            onClick={() => (b.hasCard ? onChange(target.id) : onCheckout(target.id))}
          >
            {!b.hasCard ? `Dodaj kartę – plan ${target.name}` : undoPending ? `Zostań przy planie ${target.name}` : `Przejdź na plan ${target.name}`}
          </button>
        )}
      </div>
    </Sheet>
  );
}

const digits = (s: string) => s.replace(/[\s-]/g, '');

/** Dane do faktury: pola same pilnują wartości – zapis aktywny dopiero przy poprawnych i zmienionych danych. */
function InvoiceDetails({ billing: b, onSaved }: { billing: BillingData['billing']; onSaved: () => unknown }) {
  const saved = { companyName: b.companyName ?? '', nip: b.nip ?? '', address: b.address ?? '', invoiceEmail: b.invoiceEmail ?? '' };
  const [v, setV] = useState(saved);
  const { run, busy } = useAction();
  const company = v.companyName.trim();
  const nipOk = validNip(v.nip);
  const emailOk = v.invoiceEmail.trim() === '' || validEmail(v.invoiceEmail.trim());
  const valid = company.length >= 2 && nipOk && emailOk;
  const changed = company !== saved.companyName || digits(v.nip) !== digits(saved.nip) || v.address.trim() !== saved.address || v.invoiceEmail.trim() !== saved.invoiceEmail;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <section className="stack">
      <div className="eyebrow">Dane do faktury</div>
      <Field label="Nazwa firmy">
        <input className="input" maxLength={200} value={v.companyName} onChange={set('companyName')} autoComplete="organization" />
      </Field>
      <Field label="NIP" hint={v.nip && !nipOk ? 'Sprawdź NIP – 10 cyfr' : undefined}>
        <input className="input" inputMode="numeric" maxLength={13} value={v.nip} onChange={(e) => setV({ ...v, nip: e.target.value.replace(/[^\d\s-]/g, '') })} />
      </Field>
      <Field label="Adres (opcjonalnie)">
        <input className="input" maxLength={300} value={v.address} onChange={set('address')} autoComplete="street-address" />
      </Field>
      <Field label="E-mail do faktur (opcjonalnie)" hint={!emailOk ? 'Sprawdź adres e-mail' : undefined}>
        <input className="input" type="email" value={v.invoiceEmail} onChange={set('invoiceEmail')} autoComplete="email" />
      </Field>
      <div>
        <button
          className="btn"
          disabled={!valid || !changed || busy}
          onClick={() =>
            run(async () => {
              await api('/owner/billing/details', { method: 'PUT', body: { companyName: company, nip: digits(v.nip), address: v.address.trim(), invoiceEmail: v.invoiceEmail.trim() } });
              await onSaved();
            }, 'Dane zapisane')
          }
        >
          Zapisz
        </button>
      </div>
    </section>
  );
}
