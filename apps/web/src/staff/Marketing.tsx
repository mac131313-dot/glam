// Marketing (#34, 4.2, 8, 8.1.5): kampanie push / e-mail / SMS z testem A/B i statystyką otwarć i zapisów,
// kody rabatowe, kalendarz powiadomień z podglądem treści i życzenia okolicznościowe (ustawienia + log).
import { useState } from 'react';
import { SEGMENT_LABEL, sentenceCount } from '@glam/core';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Field, Select, Spinner, Tabs, Toggle, useAction } from '../ui.tsx';

type Campaign = {
  id: string;
  name: string;
  channel: string;
  segment: string;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  variants: { id: string; body: string; subject?: string; sent: number; opened: number; booked: number; openRate: number; bookRate: number }[];
};

export default function Marketing() {
  const [tab, setTab] = useState<'campaigns' | 'coupons' | 'calendar' | 'greetings'>('campaigns');
  return (
    <div className="stack-lg">
      <h1>Marketing</h1>
      <Tabs
        label="Marketing"
        value={tab}
        onChange={setTab}
        options={[
          ['campaigns', 'Kampanie'],
          ['coupons', 'Kody rabatowe'],
          ['calendar', 'Kalendarz powiadomień'],
          ['greetings', 'Życzenia'],
        ]}
      />
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'coupons' && <Coupons />}
      {tab === 'calendar' && <PushCalendar />}
      {tab === 'greetings' && <Greetings />}
    </div>
  );
}

function Campaigns() {
  const list = useApi<Campaign[]>('/owner/campaigns');
  const [f, setF] = useState({ name: '', channel: 'push', segment: 'all', a: '', b: '', subject: '', scheduledAt: '' });
  const reach = useApi<{ count: number }>(`/owner/audience?segment=${f.segment}`, [f.segment]);
  const { run, busy } = useAction();
  const tooLong = (s: string) => f.channel !== 'email' && sentenceCount(s) > 2;
  if (list.error) return <Empty>Kampanie nie są dostępne w Twojej roli lub planie.</Empty>;
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="eyebrow">Nowa kampania</div>
        <input className="input" placeholder="Nazwa, np. Powrót po wakacjach" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="chips">
          {[
            ['push', 'Push'],
            ['email', 'E-mail'],
            ['sms', 'SMS'],
          ].map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={f.channel === k} onClick={() => setF({ ...f, channel: k })}>
              {l}
            </button>
          ))}
        </div>
        <div className="pill-row">
          {[['all', 'Wszystkie'], ...Object.entries(SEGMENT_LABEL)].map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={f.segment === k} onClick={() => setF({ ...f, segment: k })}>
              {l}
            </button>
          ))}
        </div>
        <span className="small muted">Zasięg: {reach.data?.count ?? '…'} klientek (wyślemy tylko tym ze zgodą na marketing).</span>
        {f.channel === 'email' && <input className="input" placeholder="Temat e-maila" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}
        <Field label="Wariant A" hint={tooLong(f.a) ? 'Max 2 zdania – krótko i ciepło.' : undefined}>
          <textarea className="input" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} placeholder="Wracasz po wakacjach? Mamy dla Ciebie miejsce na macie 🌿" />
        </Field>
        <Field label="Wariant B (opcjonalnie – test A/B, losowy podział 50/50)" hint={tooLong(f.b) ? 'Max 2 zdania.' : undefined}>
          <textarea className="input" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} />
        </Field>
        <Field label="Zaplanuj (puste = szkic do wysłania ręcznie)">
          <input className="input" type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} />
        </Field>
        <button
          className="btn"
          disabled={!f.name || !f.a || tooLong(f.a) || tooLong(f.b) || busy}
          onClick={() =>
            run(
              () =>
                api('/owner/campaigns', {
                  method: 'POST',
                  body: {
                    name: f.name,
                    channel: f.channel,
                    segment: f.segment,
                    scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null,
                    variants: [{ body: f.a, subject: f.subject }, ...(f.b ? [{ body: f.b, subject: f.subject }] : [])],
                  },
                }).then(() => (setF({ ...f, name: '', a: '', b: '' }), list.reload())),
              'Kampania zapisana',
            )
          }
        >
          Zapisz kampanię
        </button>
      </section>
      {!list.data ? (
        <Spinner />
      ) : (
        list.data.map((c) => (
          <section key={c.id} className="card flat stack gap-2">
            <div className="row between">
              <b>{c.name}</b>
              <span className="badge">{c.status === 'sent' ? 'wysłana' : c.status === 'scheduled' ? `zaplanowana ${c.scheduled_at ? fmtDay(c.scheduled_at) : ''}` : 'szkic'}</span>
            </div>
            <div className="tiny muted">
              {c.channel} · {c.segment === 'all' ? 'wszystkie' : (SEGMENT_LABEL as Record<string, string>)[c.segment] ?? c.segment}
            </div>
            {c.variants.map((v) => (
              <div key={v.id} className="small">
                <b>{v.id}:</b> {v.body}
                {c.status === 'sent' && (
                  <span className="tiny muted" style={{ display: 'block' }}>
                    wysłane {v.sent} · otwarcia {v.openRate}% · zapisy w 7 dni {v.bookRate}%
                  </span>
                )}
              </div>
            ))}
            {c.status !== 'sent' && (
              <div className="row">
                <button className="btn sm" onClick={() => window.confirm('Wysłać teraz?') && run(() => api(`/owner/campaigns/${c.id}/send`, { method: 'POST' }).then((r) => (list.reload(), r)))}>
                  Wyślij teraz
                </button>
                <button className="btn ghost sm" onClick={() => window.confirm(`Usunąć kampanię „${c.name}”?`) && run(() => api(`/owner/campaigns/${c.id}`, { method: 'DELETE' }).then(list.reload))}>
                  Usuń
                </button>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

function Coupons() {
  const list = useApi<{ id: string; code: string; label: string; label2: string; applies_to: string; used: number; max_uses: number | null; discount_total: number; active: number; valid_to: string | null; returning_only: number; first_purchase_only: number }[]>('/owner/coupons');
  const [f, setF] = useState({ code: '', label: '', kind: 'percent', value: 15, appliesTo: 'all', maxUses: '', returningOnly: false, firstPurchaseOnly: false, validTo: '' });
  const { run, busy } = useAction();
  const SCOPE: Record<string, string> = { all: 'wszystko', pass: 'karnety', course: 'kursy', event: 'wydarzenia', shop: 'sklep', guest_pass: 'wejściówki' };
  return (
    <div className="stack-lg">
      {list.data?.map((c) => (
        <div key={c.id} className="card flat row between" style={{ opacity: c.active ? 1 : 0.5 }}>
          <span>
            <b className="code">{c.code}</b> · {c.label2}
            <span className="tiny muted" style={{ display: 'block' }}>
              {SCOPE[c.applies_to]} · użyty {c.used}
              {c.max_uses ? `/${c.max_uses}` : ''} · rabaty {(c.discount_total / 100).toFixed(0)} zł {c.valid_to ? `· do ${c.valid_to.slice(0, 10)}` : ''} {c.returning_only ? '· powracające' : ''} {c.first_purchase_only ? '· pierwszy zakup' : ''}
            </span>
          </span>
          <button className="btn ghost sm" onClick={() => run(() => api(`/owner/coupons/${c.id}`, { method: 'PATCH', body: { active: !c.active } }).then(list.reload))}>
            {c.active ? 'Wyłącz' : 'Włącz'}
          </button>
        </div>
      ))}
      <section className="card stack">
        <div className="eyebrow">Nowy kod</div>
        <div className="row">
          <input className="input" placeholder="KOD" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          <input className="input" placeholder="Opis" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </div>
        <div className="row">
          <Select
            ariaLabel="Rodzaj"
            value={f.kind}
            onChange={(v) => setF({ ...f, kind: v })}
            options={[
              { value: 'percent', label: 'procent' },
              { value: 'amount', label: 'kwota (gr)' },
            ]}
          />
          <input className="input" type="number" value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} aria-label="Wartość" />
          <input className="input" placeholder="Limit użyć" value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} />
          <input className="input" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} aria-label="Ważny do" />
        </div>
        <div className="pill-row">
          {Object.entries(SCOPE).map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={f.appliesTo === k} onClick={() => setF({ ...f, appliesTo: k })}>
              {l}
            </button>
          ))}
        </div>
        <Toggle label="Tylko powracające klientki" checked={f.returningOnly} onChange={(v) => setF({ ...f, returningOnly: v })} />
        <Toggle label="Tylko pierwszy zakup" checked={f.firstPurchaseOnly} onChange={(v) => setF({ ...f, firstPurchaseOnly: v })} />
        <button
          className="btn"
          disabled={!f.code || busy}
          onClick={() => run(() => api('/owner/coupons', { method: 'POST', body: { ...f, maxUses: f.maxUses ? Number(f.maxUses) : null, validTo: f.validTo ? `${f.validTo}T23:59:59Z` : null } }).then(list.reload), 'Kod dodany')}
        >
          Dodaj kod
        </button>
      </section>
    </div>
  );
}

function PushCalendar() {
  const cal = useApi<{ rules: string[]; triggers: { key: string; label: string; when: string; category: string; preview: string }[]; stats: { category: string; sent: number; openRate: number; suppressed: number }[] }>('/owner/push-calendar');
  if (!cal.data) return <Spinner />;
  return (
    <div className="stack-lg">
      <section className="card soft stack gap-1">
        {cal.data.rules.map((r) => (
          <div key={r} className="small">
            · {r}
          </div>
        ))}
      </section>
      <div className="kpis">
        {cal.data.stats.map((s) => (
          <div key={s.category} className="card kpi">
            <div className="eyebrow">{s.category}</div>
            <div className="value">{s.openRate}%</div>
            <div className="small muted">
              otwarć z {s.sent} · wstrzymane {s.suppressed}
            </div>
          </div>
        ))}
      </div>
      {cal.data.triggers.map((t) => (
        <div key={t.key} className="card flat stack gap-1">
          <div className="row between">
            <b>{t.label}</b>
            <span className="tiny muted">{t.when}</span>
          </div>
          <div className="push-preview small">{t.preview}</div>
        </div>
      ))}
    </div>
  );
}

function Greetings() {
  const g = useApi<{
    settings: { birthday: boolean; nameday: boolean; anniversary: boolean; studioAnniversary: boolean; holidays: string[]; birthdayGiftPct: number; birthdayGiftDays: number };
    hour: string;
    previews: Record<string, string>;
    holidays: { id: string; date: string; time: string; body: string; extra: string | null }[];
    log: { created_at: string; status: string; reason: string | null; name: string; preview: string }[];
  }>('/owner/greetings');
  const { run } = useAction();
  if (g.error) return <Empty>Ustawienia życzeń zmienia właścicielka.</Empty>;
  if (!g.data) return <Spinner />;
  const s = g.data.settings;
  const save = (patch: Partial<typeof s>, hour?: string) => run(() => api('/owner/settings', { method: 'PUT', body: { greetings: { ...s, ...patch }, ...(hour ? { greetingsHour: hour } : {}) } }).then(g.reload), 'Zapisane');
  const LABELS: Record<string, string> = { birthday: 'Urodziny', nameday: 'Imieniny', anniversary: 'Rocznica w studiu', studioAnniversary: 'Urodziny studia' };
  return (
    <div className="stack-lg">
      <section className="card stack">
        {(['birthday', 'nameday', 'anniversary', 'studioAnniversary'] as const).map((k) => (
          <div key={k} className="stack gap-1">
            <Toggle label={LABELS[k]} checked={s[k]} onChange={(v) => save({ [k]: v })} />
            {g.data!.previews[k] && <div className="push-preview small">{g.data!.previews[k]}</div>}
          </div>
        ))}
        <div className="row">
          <Field label="Godzina wysyłki">
            <input className="input" type="time" defaultValue={g.data.hour} onBlur={(e) => e.target.value !== g.data!.hour && save({}, e.target.value)} />
          </Field>
          <Field label="Prezent urodzinowy %">
            <input className="input" type="number" defaultValue={s.birthdayGiftPct} onBlur={(e) => save({ birthdayGiftPct: Number(e.target.value) })} />
          </Field>
          <Field label="Ważny (dni)">
            <input className="input" type="number" defaultValue={s.birthdayGiftDays} onBlur={(e) => save({ birthdayGiftDays: Number(e.target.value) })} />
          </Field>
        </div>
      </section>
      <section className="stack">
        <div className="eyebrow">Święta</div>
        {g.data.holidays.map((h) => (
          <div key={h.id} className="card flat stack gap-1">
            <Toggle label={`${h.date} · ${h.time}`} checked={s.holidays.includes(h.id)} onChange={(v) => save({ holidays: v ? [...s.holidays, h.id] : s.holidays.filter((x) => x !== h.id) })} />
            <div className="push-preview small">{h.body}</div>
            {h.extra && <div className="tiny muted">{h.extra}</div>}
          </div>
        ))}
      </section>
      <section className="stack">
        <div className="eyebrow">Log wysyłek</div>
        {g.data.log.length === 0 && <Empty>Jeszcze nic nie wysłaliśmy.</Empty>}
        {g.data.log.map((l, i) => (
          <div key={i} className="small">
            <span className="muted">{fmtDay(l.created_at)}</span> · {l.name} · {l.status === 'sent' ? 'wysłane' : `wstrzymane (${l.reason ?? '—'})`} · {l.preview}…
          </div>
        ))}
      </section>
    </div>
  );
}
