// Wygląd studia (T4): paleta, czcionki w trzech rolach, miękkość zaokrągleń. Podgląd na żywo
// liczony z tych samych zmiennych CSS, które dostanie aplikacja klientki.
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_LOGO_STYLE, DEFAULT_PHOTO_BLUR, DEFAULT_PHOTO_DIM, FONTS, LOGO_LIMITS, PALETTES, PHOTO_BLUR_LIMITS, PHOTO_DIM_LIMITS, SOFTNESS, resolveLook, type FontRole, type Look, type LogoStyle, type Softness } from '@glam/core';
import { api, ApiError, useApi } from '../api.ts';
import { ClassCover } from '../client/ClassCover.tsx';
import type { MeStudio } from '../App.tsx';
import { Icon } from '../icons.tsx';
import { loadFontIds, lookVars } from '../look.ts';
import { StudioBrand, type BrandSource } from '../StudioBrand.tsx';
import { useToast } from '../ui.tsx';
import { prepareLogo } from './logoUpload.ts';

const ROLES: { role: FontRole; label: string; hint: string; sample: string }[] = [
  { role: 'display', label: 'Akcent', hint: 'szeryf w kursywie – imiona, cytaty, duże liczby', sample: 'chwila dla siebie' },
  { role: 'head', label: 'Nagłówki', hint: 'geometryczny sans – tytuły, przyciski, nawigacja', sample: 'Reformer · 18:00' },
  { role: 'body', label: 'Tekst', hint: 'czytelny sans – opisy i treści', sample: 'Wystarczy woda i wygodny strój.' },
  { role: 'label', label: 'Etykiety i kody', hint: 'małe nagłówki, statusy, kody wejściówek – tu pasuje krój mono', sample: 'NAJBLIŻSZE ZAJĘCIA · KOD 7KQ2P9XA' },
];

export function LookEditor({ studio, onSaved }: { studio: MeStudio; onSaved: () => Promise<void> }) {
  const [look, setLook] = useState<Look>(resolveLook(studio.look));
  const [identity, setIdentity] = useState({ name: studio.name, tagline: studio.tagline ?? '', city: studio.city ?? '' });
  // Podglądy pokazują nową nazwę już w trakcie pisania (przed zapisem).
  const draftName = identity.name.trim() || studio.name;
  const shown = { ...studio, name: draftName, logo: draftName.charAt(0).toLocaleUpperCase('pl-PL') };
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dirty = JSON.stringify(look) !== JSON.stringify(resolveLook(studio.look));
  // Do podglądu przyciemnienia bierzemy pierwsze wgrane zdjęcie zajęć (Grafik i sale).
  const { data: config } = useApi<{ classTypes: { name: string; photo_url: string | null; photo_ratio: number | null }[] }>('/owner/config');
  const sample = config?.classTypes.find((c) => c.photo_url) ?? null;

  useEffect(() => loadFontIds(FONTS.map((f) => f.id)), []);

  const save = async () => {
    setBusy(true);
    try {
      await api('/owner/look', { method: 'PUT', body: look });
      await onSaved();
      toast('Wygląd zapisany');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>
            Wygląd <span className="serif">studia</span>
          </h1>
          <p className="muted" style={{ margin: 0 }}>Kolory, czcionki i miękkość. Klientki zobaczą zmiany przy następnym otwarciu aplikacji.</p>
        </div>
        <div className="row">
          {dirty && (
            <button className="btn ghost" onClick={() => setLook(resolveLook(studio.look))}>
              Cofnij
            </button>
          )}
          <button className="btn" disabled={!dirty || busy} onClick={save}>
            Zapisz wygląd
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 32, alignItems: 'start' }} className="look-grid">
        <div className="stack-lg">
          <IdentitySection studio={studio} identity={identity} setIdentity={setIdentity} onSaved={onSaved} />

          <LogoSection studio={shown} look={look} setLook={setLook} onChanged={onSaved} />

          <section className="stack">
            <div className="eyebrow">Paleta</div>
            <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  className="card flat"
                  style={{ textAlign: 'left', cursor: 'pointer', padding: 18, outline: look.palette === p.id ? '1.5px solid var(--ink)' : undefined, outlineOffset: 2 }}
                  aria-pressed={look.palette === p.id}
                  onClick={() => setLook({ ...look, palette: p.id })}
                >
                  <div className="row" style={{ gap: 6, marginBottom: 12 }}>
                    {[p.palette.bg, p.palette.soft, p.palette.brand, p.palette.ink].map((c) => (
                      <span key={c} className="swatch" style={{ background: c, width: 28, height: 28 }} />
                    ))}
                  </div>
                  <div className="card-title">{p.label}</div>
                  <div className="tiny muted">{p.inspiration}</div>
                </button>
              ))}
            </div>
          </section>

          {ROLES.map((r) => (
            <section key={r.role} className="stack" style={{ gap: 10 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 2 }}>
                  {r.label}
                </div>
                <div className="tiny muted">{r.hint}</div>
              </div>
              <div className="chips" style={{ flexWrap: 'wrap' }}>
                {FONTS.filter((f) => f.roles.includes(r.role)).map((f) => (
                  <button
                    key={f.id}
                    className="chip"
                    aria-pressed={look.fonts[r.role] === f.id}
                    disabled={!!f.pending}
                    style={{
                      fontFamily: f.pending ? undefined : f.family,
                      fontStyle: r.role === 'display' && !f.pending ? 'italic' : 'normal',
                      fontSize: r.role === 'display' ? '1.1rem' : '0.95rem',
                      padding: '8px 18px',
                      ...(f.pending ? { borderStyle: 'dashed', opacity: 0.55, cursor: 'not-allowed' } : {}),
                    }}
                    title={f.pending ? `${f.label}: ${f.pending}` : f.standIn ? `Zastępczo za: ${f.standIn}` : undefined}
                    onClick={() => setLook({ ...look, fonts: { ...look.fonts, [r.role]: f.id } })}
                  >
                    {f.label}
                    {f.pending && <span className="tiny"> · czeka na pliki</span>}
                  </button>
                ))}
              </div>
              <div
                style={{
                  fontFamily: FONTS.find((f) => f.id === look.fonts[r.role])?.family,
                  fontStyle: r.role === 'display' ? 'italic' : 'normal',
                  fontSize: r.role === 'body' ? '1rem' : r.role === 'label' ? '0.8rem' : '1.7rem',
                  letterSpacing: r.role === 'head' ? '-0.02em' : r.role === 'label' ? '0.14em' : undefined,
                }}
              >
                {r.sample}
              </div>
            </section>
          ))}

          <section className="card flat stack" style={{ borderStyle: 'dashed', boxShadow: 'none' }}>
            <div className="row">
              <Icon name="type" />
              <div className="card-title">Czcionki marki</div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Kroje oznaczone „czeka na pliki” (Alte Haas Grotesk, Louis George Café, Circular Std, Jane Austen, Relationship of Mélodrame,
              Altesse Std, Apercu Mono) włączą się, gdy dostaniemy pliki .woff2 z licencją na aplikację mobilną i web. Do tego czasu
              DM Mono zastępuje Apercu Mono, Cormorant – Loretta Display / The Seasons, a Outfit – MDF Canno / Altone.
            </p>
          </section>

          <section className="stack" style={{ gap: 10 }}>
            <div className="eyebrow">Miękkość zaokrągleń</div>
            <div className="segmented" role="group" aria-label="Miękkość">
              {(Object.keys(SOFTNESS) as Softness[]).map((k) => (
                <button key={k} aria-pressed={look.softness === k} onClick={() => setLook({ ...look, softness: k })}>
                  {SOFTNESS[k].label}
                </button>
              ))}
            </div>
          </section>

          <section className="stack" style={{ gap: 10 }}>
            <div className="eyebrow">Zdjęcia zajęć</div>
            <Range
              label="Przyciemnienie pod nazwą zajęć"
              value={Math.round(look.photoDim * 100)}
              min={PHOTO_DIM_LIMITS[0] * 100}
              max={PHOTO_DIM_LIMITS[1] * 100}
              suffix="%"
              onChange={(v) => setLook({ ...look, photoDim: v / 100 })}
            />
            <Range
              label={look.photoBlur ? 'Rozmycie pod nazwą zajęć' : 'Rozmycie pod nazwą zajęć · wyłączone'}
              value={look.photoBlur}
              min={PHOTO_BLUR_LIMITS[0]}
              max={PHOTO_BLUR_LIMITS[1]}
              suffix=" px"
              onChange={(photoBlur) => setLook({ ...look, photoBlur })}
            />
            <div className="row between">
              <p className="small muted" style={{ margin: 0 }}>
                {sample ? `Podgląd na zdjęciu „${sample.name}”.` : 'Wgraj zdjęcie w Grafik i sale, żeby zobaczyć efekt na prawdziwym zdjęciu.'} Jaśniejsze zdjęcia potrzebują mocniejszego przyciemnienia. Rozmycie wycisza detale za tekstem i zanika ku górze zdjęcia.
              </p>
              {(look.photoDim !== DEFAULT_PHOTO_DIM || look.photoBlur !== DEFAULT_PHOTO_BLUR) && (
                <button className="btn quiet sm" onClick={() => setLook({ ...look, photoDim: DEFAULT_PHOTO_DIM, photoBlur: DEFAULT_PHOTO_BLUR })}>
                  Domyślne
                </button>
              )}
            </div>
          </section>
        </div>

        <PhonePreview look={look} studio={{ ...shown, look }} photo={sample?.photo_url ?? null} photoRatio={sample?.photo_ratio ?? null} />
      </div>
    </div>
  );
}

/** Miniatura ekranu Start – zmienne CSS ustawione na kontenerze, więc dziedziczą je prawdziwe klasy aplikacji. */
function PhonePreview({ look, studio, photo, photoRatio }: { look: Look; studio: BrandSource; photo: string | null; photoRatio: number | null }) {
  const vars = lookVars(look);
  return (
    <div style={{ position: 'sticky', top: 24 }}>
      <div className="eyebrow center">Podgląd</div>
      <div
        className="look-preview"
        style={{
          ...(vars as React.CSSProperties),
          width: 300,
          height: 610,
          borderRadius: 46,
          border: '9px solid #1b1715',
          background: 'var(--bg)',
          color: 'var(--ink)',
          fontFamily: 'var(--font-body)',
          overflow: 'hidden',
          position: 'relative',
          boxShadow: '0 40px 80px -40px rgb(27 23 21 / 0.45)',
          transition: 'background 0.4s',
        }}
      >
        <div style={{ padding: '22px 18px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="studio-chip" style={{ alignSelf: 'flex-start', fontSize: '0.8rem' }}>
            <StudioBrand studio={studio} scale={0.8} />
          </span>
          <div>
            <div className="eyebrow" style={{ fontSize: '0.6rem' }}>
              wtorek, 13 października
            </div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: '1.7rem', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
              Dobry wieczór,
              <br />
              <span className="serif" style={{ fontSize: '2.1rem' }}>
                Magda
              </span>
            </div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <div className="eyebrow" style={{ fontSize: '0.6rem', margin: 0 }}>
              Najbliższe zajęcia
            </div>
            <ClassCover
              photoUrl={photo}
              photoRatio={photoRatio}
              backdrop={photo ? undefined : 'var(--brand)'}
              eyebrow="śr., 14.10 · 18:00"
              title="Reformer"
              meta="prowadzi Marzena · Sala Pilates"
              corner={<span className="badge ok" style={{ fontSize: '0.65rem' }}>zapisana</span>}
            />
          </div>
          <div className="card soft" style={{ padding: 16 }}>
            <div className="eyebrow" style={{ fontSize: '0.6rem' }}>
              Mój karnet
            </div>
            <div className="card-title" style={{ fontSize: '0.9rem' }}>
              Pilates Reformer 9 – pozostały 3, ważny do 02.12
            </div>
          </div>
          <div className="btn" style={{ minHeight: 42, fontSize: '0.85rem' }}>
            Zarezerwuj zajęcia
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            right: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            background: 'color-mix(in srgb, var(--surface) 85%, transparent)',
            border: '1px solid var(--line)',
            borderRadius: 999,
            padding: 5,
          }}
        >
          {(['home', 'calendar', 'leaf', 'heart', 'user'] as const).map((n, i) => (
            <span key={n} style={{ display: 'grid', placeItems: 'center', height: 40, borderRadius: 999, background: i === 0 ? 'var(--soft)' : undefined, color: i === 0 ? 'var(--ink)' : 'var(--muted)' }}>
              <Icon name={n} size={18} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

type Identity = { name: string; tagline: string; city: string };

/** Nazwa, hasło i miasto studia – zapis jednym kliknięciem, osobno od wyglądu. */
function IdentitySection({ studio, identity, setIdentity, onSaved }: { studio: MeStudio; identity: Identity; setIdentity: (i: Identity) => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const changed = identity.name.trim() !== studio.name || identity.tagline.trim() !== (studio.tagline ?? '') || identity.city.trim() !== (studio.city ?? '');
  const valid = identity.name.trim().length >= 2 && identity.name.trim().length <= 60;

  const save = async () => {
    setBusy(true);
    try {
      await api('/owner/studio', { method: 'PUT', body: { name: identity.name, tagline: identity.tagline, city: identity.city } });
      await onSaved();
      toast('Nazwa zapisana – klientki zobaczą ją w aplikacji');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack" id="studio-name">
      <div className="eyebrow">Nazwa studia</div>
      <div className="field">
        <label htmlFor="studio-name-input">Nazwa (widoczna dla klientek)</label>
        <div className="row">
          <input
            id="studio-name-input"
            className="input"
            value={identity.name}
            maxLength={60}
            onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && changed && valid && save()}
            style={{ fontFamily: 'var(--font-head)', fontSize: '1.1rem' }}
          />
        </div>
        {!valid && <span className="tiny" style={{ color: 'var(--danger)' }}>Od 2 do 60 znaków.</span>}
      </div>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <div className="field grow" style={{ minWidth: 220 }}>
          <label htmlFor="studio-tagline">Hasło (opcjonalnie)</label>
          <input id="studio-tagline" className="input" value={identity.tagline} maxLength={120} placeholder="np. Pilates, stretch i oddech" onChange={(e) => setIdentity({ ...identity, tagline: e.target.value })} />
        </div>
        <div className="field" style={{ width: 200 }}>
          <label htmlFor="studio-city">Miasto</label>
          <input id="studio-city" className="input" value={identity.city} maxLength={60} onChange={(e) => setIdentity({ ...identity, city: e.target.value })} />
        </div>
      </div>
      {changed && (
        <div className="row">
          <button className="btn" disabled={busy || !valid} onClick={save}>
            Zapisz nazwę
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => setIdentity({ name: studio.name, tagline: studio.tagline ?? '', city: studio.city ?? '' })}>
            Cofnij
          </button>
        </div>
      )}
    </section>
  );
}

/** Logo studia: wgranie (kliknięcie albo przeciągnięcie pliku) i pełne dopasowanie wyświetlania. */
function LogoSection({ studio, look, setLook, onChanged }: { studio: MeStudio; look: Look; setLook: (l: Look) => void; onChanged: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const toast = useToast();
  const st = look.logo;
  const set = (patch: Partial<LogoStyle>) => setLook({ ...look, logo: { ...st, ...patch } });
  const brand = { ...studio, look };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { dataUrl, ratio } = await prepareLogo(file);
      await api('/owner/logo', { method: 'PUT', body: { dataUrl, ratio } });
      await onChanged();
      toast('Logo zapisane – dopasuj je poniżej');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api('/owner/logo', { method: 'DELETE' });
      await onChanged();
      toast('Logo usunięte');
    } finally {
      setBusy(false);
    }
  };

  // Przeciąganie w dużym podglądzie ustawia kadr (przesunięcie x/y).
  const drag = useRef<{ x: number; y: number; sx: number; sy: number; w: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y, w: e.currentTarget.getBoundingClientRect().width || 1 };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const clamp = (v: number) => Math.round(Math.min(LOGO_LIMITS.offset[1], Math.max(LOGO_LIMITS.offset[0], v)));
    set({ x: clamp(d.sx + ((e.clientX - d.x) / d.w) * 100), y: clamp(d.sy + ((e.clientY - d.y) / d.w) * 100) });
  };

  return (
    <section className="stack">
      <div className="eyebrow">Logo</div>
      <div
        className={`logo-drop ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files[0]);
        }}
      >
        {studio.logoUrl ? (
          <div className="row wrap" style={{ gap: 24, justifyContent: 'center' }}>
            <div
              className="logo-stage"
              title="Przeciągnij, żeby ustawić kadr"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <StudioBrand studio={brand} scale={128 / st.size} showName={false} />
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <div className="tiny muted">Tak wygląda na górze aplikacji:</div>
              {(['bg', 'soft', 'surface'] as const).map((bg) => (
                <div key={bg} style={{ background: `var(--${bg})`, padding: 12, borderRadius: 'var(--radius-sm)' }}>
                  <span className="studio-chip" style={{ cursor: 'default' }}>
                    <StudioBrand studio={brand} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="stack center" style={{ gap: 6 }}>
            <span className="studio-logo" style={{ width: 52, height: 52, fontSize: '1.5rem', margin: '0 auto' }}>
              {studio.logo}
            </span>
            <span className="small muted">Przeciągnij tu plik logo albo wybierz go z dysku</span>
          </div>
        )}
      </div>
      <div className="row wrap">
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}>
          {studio.logoUrl ? 'Zmień plik' : 'Wgraj logo'}
        </button>
        {studio.logoUrl && (
          <button className="btn ghost" disabled={busy} onClick={remove}>
            Usuń
          </button>
        )}
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => upload(e.target.files?.[0])} />
      </div>

      {studio.logoUrl && (
        <div className="card flat stack" style={{ gap: 18 }}>
          <Seg
            label="Kształt"
            value={st.shape}
            options={[
              ['auto', 'Automatycznie'],
              ['circle', 'Koło'],
              ['rounded', 'Zaokrąglony'],
              ['square', 'Kwadrat'],
              ['free', 'Swobodny'],
            ]}
            onChange={(shape) => set({ shape })}
          />
          <Range label="Rozmiar na górze aplikacji" value={st.size} min={LOGO_LIMITS.size[0]} max={LOGO_LIMITS.size[1]} suffix=" px" onChange={(size) => set({ size })} />
          <div className="field">
            <label>Tło pod logo</label>
            <div className="row wrap" style={{ gap: 8 }}>
              {(
                [
                  ['none', 'Brak'],
                  ['surface', 'Jasne'],
                  ['soft', 'Miękkie'],
                  ['brand', 'Kolor marki'],
                  ['ink', 'Ciemne'],
                ] as const
              ).map(([v, l]) => (
                <button key={v} className="chip row" aria-pressed={st.background === v} onClick={() => set({ background: v })} style={{ gap: 8 }}>
                  <span className="swatch" style={{ width: 16, height: 16, background: v === 'none' ? 'transparent' : `var(--${v})`, border: v === 'none' ? '1px dashed var(--muted)' : undefined }} />
                  {l}
                </button>
              ))}
            </div>
          </div>
          <Seg
            label="Dopasowanie"
            value={st.fit}
            options={[
              ['contain', 'Zmieść całe logo'],
              ['cover', 'Wypełnij kształt'],
            ]}
            onChange={(fit) => set({ fit })}
          />
          <Range label="Margines wewnętrzny" value={st.padding} min={LOGO_LIMITS.padding[0]} max={LOGO_LIMITS.padding[1]} suffix=" %" onChange={(padding) => set({ padding })} disabled={st.fit === 'cover' && st.shape !== 'free'} />
          <Range label="Przybliżenie" value={st.zoom} min={LOGO_LIMITS.zoom[0]} max={LOGO_LIMITS.zoom[1]} step={0.05} suffix="×" onChange={(zoom) => set({ zoom })} />
          <div className="row" style={{ gap: 16 }}>
            <div className="grow">
              <Range label="Przesunięcie w poziomie" value={st.x} min={LOGO_LIMITS.offset[0]} max={LOGO_LIMITS.offset[1]} suffix=" %" onChange={(x) => set({ x })} />
            </div>
            <div className="grow">
              <Range label="Przesunięcie w pionie" value={st.y} min={LOGO_LIMITS.offset[0]} max={LOGO_LIMITS.offset[1]} suffix=" %" onChange={(y) => set({ y })} />
            </div>
          </div>
          <Seg
            label="Nazwa studia obok logo"
            value={st.showName}
            options={[
              ['auto', 'Automatycznie'],
              ['yes', 'Zawsze'],
              ['no', 'Nigdy'],
            ]}
            onChange={(showName) => set({ showName })}
          />
          <div className="row between wrap">
            <span className="tiny muted">Kadr ustawisz też, przeciągając logo w dużym podglądzie. Zmiany zapisuje przycisk „Zapisz wygląd”.</span>
            <button className="btn ghost sm" onClick={() => set(DEFAULT_LOGO_STYLE)}>
              Przywróć domyślne
            </button>
          </div>
        </div>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>
        PNG, JPG, WebP albo SVG. Najlepiej logo na przezroczystym tle; jeśli ma białe tło, wybierz kształt i „Wypełnij kształt”.
      </p>
    </section>
  );
}

// Pola formularza poza komponentem – stabilna tożsamość, więc suwak nie gubi przeciągania.
function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="segmented" role="group" aria-label={label} style={{ flexWrap: 'wrap' }}>
        {options.map(([v, l]) => (
          <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Range({ label, value, min, max, step = 1, suffix = '', onChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="field" style={{ opacity: disabled ? 0.4 : 1 }}>
      <span className="row between" style={{ fontFamily: 'var(--font-label)', fontSize: '0.8rem', letterSpacing: '0.04em', color: 'var(--muted)' }}>
        {label}
        <span className="code">
          {step < 1 ? value.toFixed(2) : value}
          {suffix}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} style={{ accentColor: 'var(--ink)', width: '100%' }} />
    </label>
  );
}
