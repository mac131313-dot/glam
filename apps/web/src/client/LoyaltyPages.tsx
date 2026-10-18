// Lojalność (4.7), odznaki i serie (#28), nagroda po 10. zajęciach i „Moja szafka” (4.8.2), ramki profilu (4.12.3).
// Bez rankingów i porównań z innymi – liczy się tylko Twoja droga.
import { useState } from 'react';
import { BADGES, FRAMES, rewardCounterCopy } from '@glam/core';
import { api, fmtDay, useApi } from '../api.ts';
import { Avatar, Empty, ListRow, Progress, Sheet, Pending, useAction } from '../ui.tsx';
import { useClient } from './ClientApp.tsx';
import type { RouteProps } from './router.tsx';

type Loyalty = {
  enabled: boolean;
  points: number;
  level: { current: { id: string; name: string; minPoints: number }; next: { name: string; minPoints: number } | null; toNext: number };
  levels: { id: string; name: string; minPoints: number }[];
  ledger: { points: number; reason: string; created_at: string }[];
  rewards: { id: string; name: string; kind: string; cost_points: number }[];
  badges: { code: string; name: string; description: string; earned_at: string }[];
  reward: { left: number; milestone: number; reached: number; item: string } | null;
  frames: string[];
  frame: string;
  gifts: { code: string; label: string; kind: string; value: number; valid_to: string | null }[];
};

const REASON: Record<string, string> = { training: 'Trening', referral: 'Polecenie', review: 'Opinia', challenge: 'Wyzwanie', birthday: 'Urodziny', reward: 'Nagroda' };

export default function LoyaltyPages({ route }: RouteProps) {
  return route === 'locker' ? <Locker /> : <LoyaltyPage />;
}

function LoyaltyPage() {
  const { me, open, studio } = useClient();
  const { data, error, reload } = useApi<Loyalty>('/my/loyalty');
  const { run } = useAction();
  if (!data) return <Pending error={error} reload={reload} />;
  const earned = new Set(data.badges.map((b) => b.code));
  return (
    <div className="stack-lg">
      <section className="center stack" style={{ gap: 10 }}>
        <div className={`frame-${FRAMES.find((f) => f.id === data.frame)?.style ?? 'hairline'}`} style={{ borderRadius: '50%', width: 64, height: 64, margin: '0 auto' }}>
          <Avatar name={me.user.name} />
        </div>
        {data.enabled && (
          <>
            <div className="eyebrow">Twój poziom</div>
            <div className="serif" style={{ fontSize: '2.4rem', lineHeight: 1 }}>
              {data.level.current.name}
            </div>
            <div className="small muted">{data.points} pkt</div>
            {data.level.next && (
              <div style={{ width: '100%' }}>
                <Progress value={data.points - data.level.current.minPoints} max={data.level.next.minPoints - data.level.current.minPoints} label="Postęp do następnego poziomu" />
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  Do poziomu {data.level.next.name}: {data.level.toNext} pkt
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {data.reward && (
        <section className="card soft stack" style={{ gap: 8 }}>
          <div className="eyebrow">Nagroda po {data.reward.milestone} treningach</div>
          <div className="card-title">{data.reward.item}</div>
          <Progress value={studio.reward.every - data.reward.left} max={studio.reward.every} label="Postęp do nagrody" />
          <div className="small muted">{rewardCounterCopy(data.reward.left)}</div>
        </section>
      )}

      {data.gifts.length > 0 && (
        <section className="stack">
          <div className="eyebrow">Prezenty dla Ciebie</div>
          {data.gifts.map((g) => (
            <div key={g.code} className="card flat row between">
              <span>
                <b>{g.label}</b>
                <span className="small muted" style={{ display: 'block' }}>
                  {g.kind === 'percent' ? `-${g.value}%` : `-${g.value / 100} zł`}
                  {g.valid_to && ` · do ${g.valid_to.split('-').reverse().join('.')}`}
                </span>
              </span>
              <span className="code">{g.code}</span>
            </div>
          ))}
        </section>
      )}

      {data.enabled && data.rewards.length > 0 && (
        <section className="stack">
          <div className="eyebrow">Wymień punkty</div>
          {data.rewards.map((r) => (
            <div key={r.id} className="row between card flat">
              <span>
                <b>{r.name}</b>
                <span className="small muted" style={{ display: 'block' }}>{r.cost_points} pkt</span>
              </span>
              <button
                className="btn sm"
                disabled={data.points < r.cost_points}
                onClick={() => run(async () => {
                  const res = await api<{ message: string }>(`/rewards/${r.id}/claim`, { method: 'POST' });
                  reload();
                  return res;
                })}
              >
                Wymień
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="stack">
        <div className="eyebrow">Odznaki</div>
        <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
          {BADGES.filter((b) => !b.limited || earned.has(b.code)).map((b) => (
            <div key={b.code} className={`card ${earned.has(b.code) ? 'soft' : 'flat'} center`} style={{ padding: 14, opacity: earned.has(b.code) ? 1 : 0.45 }}>
              <div className="serif" style={{ fontSize: '1.6rem' }}>{earned.has(b.code) ? '✦' : '·'}</div>
              <div className="small" style={{ fontWeight: 600 }}>{b.name}</div>
              <div className="tiny muted">{b.description}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="eyebrow">Ramka profilu</div>
        <div className="pill-row">
          {FRAMES.map((f) => {
            const unlocked = data.frames.includes(f.id);
            return (
              <button
                key={f.id}
                className="chip"
                disabled={!unlocked}
                aria-pressed={data.frame === f.id}
                title={unlocked ? f.name : 'Odblokujesz odznaką albo poziomem'}
                onClick={() => run(() => api('/my/frame', { method: 'PUT', body: { frame: f.id } }).then(reload))}
              >
                {unlocked ? f.name : `🔒 ${f.name}`}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <ListRow title="Moja szafka" hint="Nagrody i rzeczy do odbioru w studiu" onClick={() => open('locker')} />
      </section>

      {data.ledger.length > 0 && (
        <section className="stack">
          <div className="eyebrow">Historia punktów</div>
          {data.ledger.map((l, i) => (
            <div key={i} className="row between small">
              <span>{REASON[l.reason] ?? l.reason}</span>
              <span className="muted">
                {l.points > 0 ? `+${l.points}` : l.points} · {fmtDay(l.created_at)}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Locker() {
  const { me, open } = useClient();
  const { data, error, reload } = useApi<{ id: string; title: string; status: string; size: string | null; delivery: string | null; sizes: string[]; options: { delivery?: string[] } }[]>('/my/locker');
  const [choose, setChoose] = useState<string | null>(null);
  const [size, setSize] = useState('');
  const [delivery, setDelivery] = useState<'pickup' | 'ship'>('pickup');
  const { run, busy } = useAction();
  if (!data) return <Pending error={error} reload={reload} />;
  const item = data.find((d) => d.id === choose);
  const STATUS: Record<string, string> = { choose: 'wybierz rozmiar', queued: 'przygotowujemy', ready: 'czeka w recepcji', shipped: 'wysłana', collected: 'odebrana' };
  return (
    <div className="stack">
      {data.length === 0 && <Empty>Tu pojawią się nagrody i prezenty od studia.</Empty>}
      {data.map((l) => (
        <div key={l.id} className="card flat row between">
          <span>
            <b>{l.title}</b>
            <span className="small muted" style={{ display: 'block' }}>
              {STATUS[l.status]}
              {l.size && ` · ${l.size}`}
            </span>
          </span>
          {l.status === 'choose' && (
            <button className="btn sm" onClick={() => (setChoose(l.id), setSize(l.sizes[0] ?? ''))}>
              Wybierz
            </button>
          )}
        </div>
      ))}
      {item && (
        <Sheet onClose={() => setChoose(null)} label="Nagroda">
          <div className="stack">
            <h2>{item.title}</h2>
            {item.sizes.length > 0 && (
              <div className="pill-row">
                {item.sizes.map((s) => (
                  <button key={s} className="chip" aria-pressed={size === s} onClick={() => setSize(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="segmented">
              <button aria-pressed={delivery === 'pickup'} onClick={() => setDelivery('pickup')}>
                Odbiór w recepcji
              </button>
              {(item.options.delivery ?? []).includes('ship') && (
                <button aria-pressed={delivery === 'ship'} onClick={() => setDelivery('ship')}>
                  Wysyłka
                </button>
              )}
            </div>
            {delivery === 'ship' && !me.user.hasAddress && (
              <p className="small">
                Do wysyłki potrzebujemy adresu.{' '}
                <button className="link" onClick={() => open('settings')}>
                  Dodaj adres
                </button>
              </p>
            )}
            <button
              className="btn block"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<{ message: string }>(`/locker/${item.id}`, { method: 'POST', body: { size: size || undefined, delivery } });
                  setChoose(null);
                  reload();
                  return r;
                })
              }
            >
              Potwierdź
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
