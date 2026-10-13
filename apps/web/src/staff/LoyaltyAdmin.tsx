// Lojalność (4.7, 4.12, 4.13): nagrody za punkty, poziomy (Start / Flow / Queen), punkty za akcje,
// nagroda co N treningów, polecenia. Wszystko konfigurowalne przez studio – bez presji i porównań.
import { useEffect, useState } from 'react';
import type { StudioSettings } from '@glam/core';
import { api, useApi } from '../api.ts';
import { Empty, Field, Spinner, Toggle, useAction } from '../ui.tsx';

const KIND: Record<string, string> = { entry: 'Darmowe wejście', discount: 'Rabat %', gift: 'Prezent', early_booking: 'Wcześniejsze zapisy' };
const POINTS: Record<string, string> = { training: 'Trening', referral: 'Polecenie', review: 'Opinia', challenge: 'Wyzwanie', birthday: 'Urodziny' };

export default function LoyaltyAdmin() {
  const rewards = useApi<{ id: string; name: string; kind: string; cost_points: number; value: number | null; active: number; claimed: number }[]>('/owner/rewards');
  const cfg = useApi<{ settings?: StudioSettings }>('/owner/config');
  const [f, setF] = useState({ name: '', kind: 'entry', costPoints: 300, value: '' });
  const { run, busy } = useAction();
  if (rewards.error) return <Empty>Program lojalnościowy nie jest dostępny.</Empty>;
  return (
    <div className="stack-lg">
      <h1>Lojalność</h1>
      <section className="stack">
        <div className="eyebrow">Nagrody za punkty</div>
        {!rewards.data ? (
          <Spinner />
        ) : (
          rewards.data.map((r) => (
            <div key={r.id} className="card flat row between" style={{ opacity: r.active ? 1 : 0.5 }}>
              <span>
                <b>{r.name}</b>
                <span className="tiny muted" style={{ display: 'block' }}>
                  {KIND[r.kind]} {r.value ? `(${r.value})` : ''} · {r.cost_points} pkt · odebrano {r.claimed}
                </span>
              </span>
              <button className="btn ghost sm" onClick={() => run(() => api(`/owner/rewards/${r.id}`, { method: 'PATCH', body: { active: !r.active } }).then(rewards.reload))}>
                {r.active ? 'Ukryj' : 'Pokaż'}
              </button>
            </div>
          ))
        )}
        <section className="card stack">
          <input className="input" placeholder="Nazwa nagrody" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="chips">
            {Object.entries(KIND).map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>
                {l}
              </button>
            ))}
          </div>
          <div className="row">
            <Field label="Koszt (pkt)">
              <input className="input" type="number" value={f.costPoints} onChange={(e) => setF({ ...f, costPoints: Number(e.target.value) })} />
            </Field>
            {f.kind === 'discount' && (
              <Field label="Rabat %">
                <input className="input" type="number" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
              </Field>
            )}
          </div>
          <button className="btn" disabled={!f.name || busy} onClick={() => run(() => api('/owner/rewards', { method: 'POST', body: { ...f, value: f.value ? Number(f.value) : undefined } }).then(() => (setF({ ...f, name: '' }), rewards.reload())), 'Nagroda dodana')}>
            Dodaj nagrodę
          </button>
        </section>
      </section>
      {cfg.data?.settings && <Rules settings={cfg.data.settings} reload={cfg.reload} />}
    </div>
  );
}

function Rules({ settings, reload }: { settings: StudioSettings; reload: () => Promise<void> }) {
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const { run, busy } = useAction();
  const save = () => run(() => api('/owner/settings', { method: 'PUT', body: { loyalty: s.loyalty, tenClassReward: s.tenClassReward, referral: s.referral } }).then(reload), 'Zasady zapisane');
  return (
    <section className="card stack">
      <div className="eyebrow">Zasady</div>
      <Toggle label="Program punktowy włączony" checked={s.loyalty.enabled} onChange={(v) => setS({ ...s, loyalty: { ...s.loyalty, enabled: v } })} />
      <div className="row wrap">
        {s.loyalty.levels.map((l, i) => (
          <Field key={l.id} label={`Poziom ${i + 1}`}>
            <div className="row" style={{ gap: 4 }}>
              <input className="input" value={l.name} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, levels: s.loyalty.levels.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) } })} />
              <input className="input" type="number" style={{ maxWidth: 90 }} disabled={i === 0} value={l.minPoints} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, levels: s.loyalty.levels.map((x, k) => (k === i ? { ...x, minPoints: Number(e.target.value) } : x)) } })} aria-label="Od punktów" />
            </div>
          </Field>
        ))}
      </div>
      <div className="row wrap">
        {Object.entries(POINTS).map(([k, l]) => (
          <Field key={k} label={`${l} (pkt)`}>
            <input className="input" type="number" style={{ maxWidth: 90 }} value={s.loyalty.points[k as keyof typeof s.loyalty.points]} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, points: { ...s.loyalty.points, [k]: Number(e.target.value) } } })} />
          </Field>
        ))}
      </div>
      <Toggle label="Nagroda co N treningów (do „Mojej szafki”)" checked={s.tenClassReward.enabled} onChange={(v) => setS({ ...s, tenClassReward: { ...s.tenClassReward, enabled: v } })} />
      <div className="row">
        <Field label="Co ile treningów">
          <input className="input" type="number" value={s.tenClassReward.every} onChange={(e) => setS({ ...s, tenClassReward: { ...s.tenClassReward, every: Number(e.target.value) } })} />
        </Field>
        <Field label="Domyślna nagroda">
          <input className="input" value={s.tenClassReward.defaultItem} onChange={(e) => setS({ ...s, tenClassReward: { ...s.tenClassReward, defaultItem: e.target.value } })} />
        </Field>
      </div>
      <Toggle label="Polecenia: pierwsze zajęcia znajomej gratis" checked={s.referral.friendFirstClassFree} onChange={(v) => setS({ ...s, referral: { ...s.referral, friendFirstClassFree: v } })} />
      <div className="row">
        <Field label="Bonus wejść dla polecającej">
          <input className="input" type="number" value={s.referral.inviterBonusEntries} onChange={(e) => setS({ ...s, referral: { ...s.referral, inviterBonusEntries: Number(e.target.value) } })} />
        </Field>
        <Field label="Limit poleceń / mies.">
          <input className="input" type="number" value={s.referral.monthlyCap} onChange={(e) => setS({ ...s, referral: { ...s.referral, monthlyCap: Number(e.target.value) } })} />
        </Field>
      </div>
      <button className="btn" disabled={busy} onClick={save}>
        Zapisz zasady
      </button>
    </section>
  );
}
