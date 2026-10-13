// Panel motywów (7.7, M2, M9, M10): kalendarz z podglądem na telefonie, ręczne włączanie (opcjonalnie z pushem),
// jeden aktywny naraz, harmonogram automatyczny, segment, paleta z kontrolą kontrastu WCAG, dźwięk i ikona,
// pakiet (odznaka limitowana, wyzwanie, kod rabatowy), biblioteka edycji sezonowych i statystyki.
import { useState } from 'react';
import { themeContrastErrors, type Palette } from '@glam/core';
import { api, useApi } from '../api.ts';
import { Field, Sheet, Spinner, Toggle, useAction } from '../ui.tsx';

type Pack = { badge?: string; challengeTitle?: string; challengeMetric?: string; challengeTarget?: number; couponCode?: string };
type Theme = {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  starts_on: string;
  ends_on: string;
  is_active: number;
  auto: number;
  segment: string | null;
  sound: string | null;
  icon: string | null;
  palette: Record<string, string>;
  effect: string | null;
  pack: Pack;
  stats: { challengeJoined: number; challengeDone: number; pushSent: number; pushOpenRate: number; voucherUses: number };
};
type Library = {
  editions: { id: string; name: string; tagline: string; from: string; to: string; ideas: string; classes: string; badge?: string }[];
  palettes: { id: string; label: string; palette: Palette }[];
  sounds: { id: string; label: string }[];
  icons: { id: string; label: string }[];
  badges: { code: string; name: string }[];
  segments: Record<string, string>;
};

// Stałe pozycje płatków w podglądzie (% szerokości/wysokości, średnica px) – bez losowania przy każdym renderze.
const SNOW_DOTS: [number, number, number][] = [[8, 6, 4], [27, 18, 3], [52, 4, 4], [74, 14, 3], [90, 30, 4], [15, 40, 3], [63, 36, 4], [40, 55, 3], [84, 58, 4], [22, 72, 4], [56, 80, 3], [78, 90, 3]];

function PhonePreview({ t }: { t: Theme }) {
  const p = t.palette;
  return (
    <div className={t.effect === 'snow' ? 'snow-preview' : undefined} style={{ width: 170, borderRadius: 26, padding: 10, background: p.bg, border: '6px solid #2b2228', color: p.ink, flex: 'none' }} aria-label={`Podgląd motywu ${t.name}`}>
      {t.effect === 'snow' && SNOW_DOTS.map(([x, y, d], i) => <span key={i} className="snow-dot" style={{ left: `${x}%`, top: `${y}%`, width: d, height: d }} aria-hidden />)}
      <div style={{ fontSize: 10, color: p.muted }}>Dzień dobry</div>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14, margin: '2px 0 8px' }}>Cześć, Magda</div>
      <div style={{ background: p.soft, borderRadius: 12, padding: 8, fontSize: 10, marginBottom: 6 }}>
        {t.emoji} <b>{t.name}</b>
      </div>
      <div style={{ background: p.surface, borderRadius: 12, padding: 8, fontSize: 10, marginBottom: 6 }}>
        Reformer · 18:00
        <div style={{ color: p.muted }}>prowadzi Marzena</div>
      </div>
      <div style={{ background: p.accent, color: p.accentInk, borderRadius: 999, padding: '6px 0', textAlign: 'center', fontSize: 10, fontWeight: 600 }}>Zarezerwuj</div>
    </div>
  );
}

export function Themes() {
  const { data, reload } = useApi<Theme[]>('/owner/themes');
  const lib = useApi<Library>('/owner/themes/library');
  const [edit, setEdit] = useState<Partial<Theme> | null>(null);
  const [notifyOn, setNotifyOn] = useState(false);
  const { run, busy } = useAction();
  if (!data) return <Spinner />;
  const post = (path: string, msg: string, body?: unknown) => run(() => api(path, { method: 'POST', body }).then(reload), msg);

  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div>
          <h1 style={{ marginBottom: 0 }}>Motywy i edycje sezonowe</h1>
          <p className="muted" style={{ margin: 0 }}>Motyw to dodatek – nie zmienia funkcji ani zasad. Klientka może wybrać „Zawsze standard”.</p>
        </div>
        <div className="row">
          {data.some((t) => t.is_active) && (
            <button className="btn ghost" disabled={busy} onClick={() => post('/owner/themes/deactivate', 'Przywrócono wygląd standardowy')}>
              Wróć do standardu
            </button>
          )}
          <button className="btn" onClick={() => setEdit({ palette: lib.data?.palettes[0]?.palette as unknown as Record<string, string>, pack: {} })}>
            + Nowy motyw
          </button>
        </div>
      </div>
      <Toggle label="Przy ręcznym włączeniu wyślij push do klientek z segmentu" checked={notifyOn} onChange={setNotifyOn} />
      <div className="grid-2">
        {data.map((t) => (
          <section key={t.id} className="card row" style={{ alignItems: 'flex-start', outline: t.is_active ? '3px solid var(--accent)' : undefined }}>
            <PhonePreview t={t} />
            <div className="stack grow" style={{ gap: 8 }}>
              <h3 style={{ margin: 0 }}>
                {t.emoji} {t.name}
              </h3>
              <p className="small muted" style={{ margin: 0 }}>{t.tagline}</p>
              {t.effect === 'snow' && <p className="tiny muted" style={{ margin: 0 }}>Lekki padający śnieg w aplikacji klientek (wyłączony przy ograniczeniu ruchu).</p>}
              <p className="tiny muted" style={{ margin: 0 }}>
                {t.starts_on === t.ends_on ? t.starts_on : `${t.starts_on ?? '—'} – ${t.ends_on ?? '—'}`} {t.auto ? '· automatycznie' : ''} {t.segment ? `· ${lib.data?.segments[t.segment] ?? t.segment}` : ''}
              </p>
              <div className="row" style={{ gap: 4 }}>
                {['bg', 'soft', 'brand', 'accent', 'ink'].map((k) => (
                  <span key={k} className="swatch" style={{ background: t.palette[k] }} title={k} />
                ))}
              </div>
              {(t.stats.pushSent > 0 || t.stats.challengeJoined > 0 || t.stats.voucherUses > 0) && (
                <p className="tiny muted" style={{ margin: 0 }}>
                  push {t.stats.pushSent} · otwarcia {t.stats.pushOpenRate}% · wyzwanie {t.stats.challengeJoined}/{t.stats.challengeDone} · kod {t.stats.voucherUses}×
                </p>
              )}
              <div className="row wrap" style={{ gap: 6 }}>
                {t.is_active ? (
                  <span className="badge ok">aktywny</span>
                ) : (
                  <button className="btn sm" disabled={busy} onClick={() => post(`/owner/themes/${t.id}/activate`, `Włączono motyw „${t.name}”`, { notify: notifyOn })}>
                    Włącz teraz
                  </button>
                )}
                <button className="btn ghost sm" onClick={() => setEdit(t)}>
                  Edytuj
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>
      {lib.data && (
        <section className="stack">
          <div className="eyebrow">Biblioteka edycji – pomysły na najbliższe miesiące</div>
          {lib.data.editions.map((e) => (
            <div key={`${e.id}${e.from}`} className="card flat row between" style={{ alignItems: 'flex-start' }}>
              <span>
                <b>{e.name}</b> <span className="tiny muted">{e.from} – {e.to}</span>
                <span className="small muted" style={{ display: 'block' }}>
                  {e.tagline} · {e.classes}
                </span>
              </span>
              <button
                className="btn ghost sm"
                onClick={() => setEdit({ name: e.name, tagline: e.tagline, starts_on: e.from, ends_on: e.to, auto: 1, palette: lib.data!.palettes[0].palette as unknown as Record<string, string>, pack: { badge: e.badge } })}
              >
                Użyj
              </button>
            </div>
          ))}
        </section>
      )}
      {edit && lib.data && <ThemeEditor theme={edit} lib={lib.data} onClose={() => setEdit(null)} onDone={reload} />}
    </div>
  );
}

const COLOR_KEYS: [keyof Palette, string][] = [
  ['bg', 'Tło'],
  ['surface', 'Karty'],
  ['soft', 'Delikatne tło'],
  ['ink', 'Tekst'],
  ['muted', 'Tekst drugorzędny'],
  ['brand', 'Marka'],
  ['accent', 'Akcent (przyciski)'],
  ['accentInk', 'Tekst na akcencie'],
];

function ThemeEditor({ theme, lib, onClose, onDone }: { theme: Partial<Theme>; lib: Library; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: theme.name ?? '',
    tagline: theme.tagline ?? '',
    emoji: theme.emoji ?? '',
    startsOn: theme.starts_on ?? '',
    endsOn: theme.ends_on ?? '',
    auto: !!theme.auto,
    segment: theme.segment ?? '',
    effect: theme.effect ?? '',
    sound: theme.sound ?? 'none',
    icon: theme.icon ?? 'default',
    palette: { ...(theme.palette ?? {}) } as Record<string, string>,
    pack: { ...(theme.pack ?? {}) } as Pack,
  });
  const { run, busy } = useAction();
  const errors = themeContrastErrors(f.palette as Partial<Palette>);
  const save = () =>
    run(async () => {
      const body = { ...f, segment: f.segment || null, effect: f.effect || null, startsOn: f.startsOn || null, endsOn: f.endsOn || null };
      if (theme.id) await api(`/owner/themes/${theme.id}`, { method: 'PUT', body });
      else await api('/owner/themes', { method: 'POST', body });
      onDone();
      onClose();
    }, 'Motyw zapisany');
  const preview = { ...(theme as Theme), name: f.name, emoji: f.emoji, effect: f.effect || null, palette: f.palette };
  return (
    <Sheet onClose={onClose} label="Motyw">
      <div className="stack">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <PhonePreview t={preview} />
          <div className="stack grow">
            <input className="input" placeholder="Nazwa" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input className="input" placeholder="Hasło" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} />
            <input className="input" placeholder="Emoji" value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} style={{ maxWidth: 90 }} />
          </div>
        </div>
        <div className="pill-row">
          {lib.palettes.map((p) => (
            <button key={p.id} className="chip" onClick={() => setF({ ...f, palette: { ...(p.palette as unknown as Record<string, string>) } })}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="row wrap">
          {COLOR_KEYS.map(([k, l]) => (
            <label key={k} className="small stack" style={{ gap: 2, alignItems: 'center' }}>
              <input type="color" value={f.palette[k] ?? '#ffffff'} onChange={(e) => setF({ ...f, palette: { ...f.palette, [k]: e.target.value } })} aria-label={l} />
              <span className="tiny">{l}</span>
            </label>
          ))}
        </div>
        {errors.length > 0 && (
          <div className="tiny" style={{ color: 'var(--danger)' }}>
            {errors.map((e) => (
              <div key={e}>Za mały kontrast: {e}</div>
            ))}
          </div>
        )}
        <div className="row">
          <Field label="Od">
            <input className="input" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
          </Field>
          <Field label="Do">
            <input className="input" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
          </Field>
        </div>
        <Toggle label="Włączaj i wyłączaj automatycznie w tych datach" checked={f.auto} onChange={(v) => setF({ ...f, auto: v })} />
        <Toggle label="Efekt śniegu" checked={f.effect === 'snow'} onChange={(v) => setF({ ...f, effect: v ? 'snow' : '' })} />
        <div className="row">
          <select className="input" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })} aria-label="Segment">
            <option value="">Dla wszystkich</option>
            {Object.entries(lib.segments).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <select className="input" value={f.sound} onChange={(e) => setF({ ...f, sound: e.target.value })} aria-label="Dźwięk">
            {lib.sounds.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <select className="input" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} aria-label="Ikona aplikacji">
            {lib.icons.map((x) => (
              <option key={x.id} value={x.id}>
                Ikona: {x.label}
              </option>
            ))}
          </select>
        </div>
        <div className="eyebrow">Pakiet motywu</div>
        <div className="row">
          <select className="input" value={f.pack.badge ?? ''} onChange={(e) => setF({ ...f, pack: { ...f.pack, badge: e.target.value || undefined } })} aria-label="Odznaka limitowana">
            <option value="">Bez odznaki limitowanej</option>
            {lib.badges.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Kod rabatowy (np. JESIEN15)" value={f.pack.couponCode ?? ''} onChange={(e) => setF({ ...f, pack: { ...f.pack, couponCode: e.target.value.toUpperCase() || undefined } })} />
        </div>
        <div className="row">
          <input className="input" placeholder="Wyzwanie (np. 6 treningów jesienią)" value={f.pack.challengeTitle ?? ''} onChange={(e) => setF({ ...f, pack: { ...f.pack, challengeTitle: e.target.value || undefined, challengeMetric: f.pack.challengeMetric ?? 'trainings' } })} />
          <input className="input" type="number" placeholder="Cel" style={{ maxWidth: 90 }} value={f.pack.challengeTarget ?? ''} onChange={(e) => setF({ ...f, pack: { ...f.pack, challengeTarget: Number(e.target.value) || undefined } })} />
        </div>
        <div className="row">
          <button className="btn" disabled={!f.name || errors.length > 0 || busy} onClick={save}>
            Zapisz
          </button>
          {theme.id && (
            <button className="btn danger" onClick={() => window.confirm('Usunąć motyw?') && run(() => api(`/owner/themes/${theme.id}`, { method: 'DELETE' }).then(() => (onDone(), onClose())))}>
              Usuń
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
