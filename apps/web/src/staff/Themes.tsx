// Panel motywów (7.7, M2, M9, M10): kalendarz z podglądem na telefonie, ręczne włączanie (opcjonalnie z pushem),
// jeden aktywny naraz, harmonogram automatyczny, segment, paleta z kontrolą kontrastu WCAG, dźwięk i ikona,
// pakiet (odznaka limitowana, wyzwanie, kod rabatowy), biblioteka edycji sezonowych i statystyki.
import { useState } from 'react';
import { themeContrastErrors, type Palette } from '@glam/core';
import { api, useApi } from '../api.ts';
import { Field, Select, Sheet, Spinner, Toggle, useAction } from '../ui.tsx';
import './Themes.css';

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
type Edition = {
  id: string;
  name: string;
  tagline: string;
  from: string;
  to: string;
  ideas: string;
  classes: string;
  badge?: string;
  emoji: string;
  effect: string | null;
  palette: Record<string, string>;
};
type Library = {
  editions: Edition[];
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
        <EditionLibrary
          editions={lib.data.editions}
          themes={data}
          onUse={(e) => setEdit({ name: e.name, tagline: e.tagline, emoji: e.emoji, effect: e.effect, starts_on: e.from, ends_on: e.to, auto: 1, palette: { ...e.palette }, pack: { badge: e.badge } })}
          onOpen={setEdit}
        />
      )}
      {edit && lib.data && <ThemeEditor theme={edit} lib={lib.data} onClose={() => setEdit(null)} onDone={reload} />}
    </div>
  );
}

const dayMs = 86_400_000;
const parse = (iso: string) => new Date(`${iso}T00:00:00`);
const longDate = (iso: string) => parse(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });

/** „1–30 października”, „24–27 listopada”, „31 października”, „28 grudnia – 3 stycznia”. */
function dateRange(from: string, to: string) {
  if (from === to) return longDate(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${parse(from).getDate()}–${longDate(to)}`;
  return `${longDate(from)} – ${longDate(to)}`;
}

function whenLabel(from: string, to: string, today: string) {
  if (from <= today && today <= to) return { text: 'Trwa teraz', now: true };
  const days = Math.round((parse(from).getTime() - parse(today).getTime()) / dayMs);
  return { text: days === 1 ? 'Jutro' : days < 7 ? `Za ${days} dni` : days < 60 ? `Za ${Math.round(days / 7)} tyg.` : `Za ${Math.round(days / 30)} mies.`, now: false };
}

function EditionLibrary({ editions, themes, onUse, onOpen }: { editions: Edition[]; themes: Theme[]; onUse: (e: Edition) => void; onOpen: (t: Theme) => void }) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Grupujemy po miesiącu początku edycji – łatwiej planować „co w listopadzie”.
  const months = new Map<string, Edition[]>();
  for (const e of editions) months.set(e.from.slice(0, 7), [...(months.get(e.from.slice(0, 7)) ?? []), e]);
  return (
    <section className="stack">
      <div>
        <div className="eyebrow">Biblioteka edycji</div>
        <p className="small muted" style={{ margin: 0 }}>Gotowe pomysły na najbliższe miesiące – z paletą, emoji i datami. „Użyj” otwiera motyw do dopracowania.</p>
      </div>
      {[...months].map(([month, list]) => (
        <div key={month} className="stack" style={{ gap: 10 }}>
          <h2 className="edition-month">{parse(`${month}-01`).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })}</h2>
          <div className="edition-grid">
            {list.map((e) => {
              const p = e.palette;
              const when = whenLabel(e.from, e.to, today);
              const planned = themes.find((t) => t.name === e.name && t.starts_on === e.from);
              return (
                <article key={`${e.id}${e.from}`} className="edition-tile">
                  <div className={`edition-art${e.effect === 'snow' ? ' snow-preview' : ''}`} style={{ background: p.bg }} aria-hidden>
                    <span className="blob" style={{ width: 150, height: 150, right: -30, top: -50, background: p.soft }} />
                    <span className="blob" style={{ width: 90, height: 90, left: 70, bottom: -40, background: p.brand, opacity: 0.35 }} />
                    {e.effect === 'snow' && SNOW_DOTS.map(([x, y, s], i) => <span key={i} className="snow-dot" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s }} />)}
                    <span className={`when${when.now ? ' now' : ''}`}>{when.text}</span>
                    <span className="dots">
                      {['soft', 'brand', 'accent'].map((k) => <span key={k} style={{ background: p[k] }} />)}
                    </span>
                    <span className="emoji">{e.emoji}</span>
                    <span className="mini-btn" style={{ background: p.accent, color: p.accentInk }}>Zarezerwuj</span>
                  </div>
                  <div className="edition-body">
                    <h3>{e.name}</h3>
                    <p className="tiny muted">{dateRange(e.from, e.to)}</p>
                    <p className="small">{e.tagline}</p>
                    <div className="edition-tags">
                      {e.classes.split(', ').filter((c) => c !== 'Bez zmian').map((c) => <span key={c}>{c}</span>)}
                    </div>
                    <div className="spacer" />
                    {planned ? (
                      <button className="btn ghost sm" onClick={() => onOpen(planned)}>✓ W kalendarzu · edytuj</button>
                    ) : (
                      <button className="btn sm" onClick={() => onUse(e)}>Użyj</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </section>
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
          <Select
            ariaLabel="Segment"
            value={f.segment}
            onChange={(v) => setF({ ...f, segment: v })}
            options={[{ value: '', label: 'Dla wszystkich' }, ...Object.entries(lib.segments).map(([k, l]) => ({ value: k, label: String(l) }))]}
          />
          <Select ariaLabel="Dźwięk" value={f.sound} onChange={(v) => setF({ ...f, sound: v })} options={lib.sounds.map((x) => ({ value: x.id, label: x.label }))} />
          <Select ariaLabel="Ikona aplikacji" value={f.icon} onChange={(v) => setF({ ...f, icon: v })} options={lib.icons.map((x) => ({ value: x.id, label: `Ikona: ${x.label}` }))} />
        </div>
        <div className="eyebrow">Pakiet motywu</div>
        <div className="row">
          <Select
            ariaLabel="Odznaka limitowana"
            value={f.pack.badge ?? ''}
            onChange={(v) => setF({ ...f, pack: { ...f.pack, badge: v || undefined } })}
            options={[{ value: '', label: 'Bez odznaki limitowanej' }, ...lib.badges.map((b) => ({ value: b.code, label: b.name }))]}
          />
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
