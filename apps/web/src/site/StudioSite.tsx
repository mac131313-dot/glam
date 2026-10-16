// Publiczna strona studia: /s/:slug. Jeden kod dla każdego studia – układ, teksty i zdjęcia z dokumentu strony
// (core/site.ts), dane (grafik, zajęcia, trenerki) z GLAM. Zapisy i zakupy prowadzą do aplikacji klientki (/app).
// Kierunek: minimalizm na maksa (Isola / Unbound) – dużo powietrza, zdjęcia, jedno kursywne słowo, cienkie linie, bez cieni.
// Kontrakt z edytorem: każda sekcja to bezpośrednie dziecko <main> z id i data-section-name (most szuka `main > section[id]`).
//   ?podglad=1 – szkic zamiast wersji publicznej (wymaga sesji panelu), ?edytor=1 – most do edytora w ramce.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { isNewClass, siteImageUrl, siteLook, specOf, type FieldValue, type Look, type SiteDoc, type SiteSection } from '@glam/core';
import { applyLook } from '../look.ts';
import { StudioBrand } from '../StudioBrand.tsx';
import { Spinner, Watermark } from '../ui.tsx';
import { EditorBridge } from './EditorBridge.tsx';
import { FOOTER_ID, HERO_ID } from './protocol.ts';
import { SideRays } from './SideRays.tsx';
import './site.css';

type PublicSession = { id: string; startsAt: string; endsAt: string; classTypeId: string; className: string; trainer: string; zone: string; kind: string; spotsLeft: number };
type PublicClass = { id: string; name: string; level: string | null; color: string; description: string | null; photoUrl: string | null; zone: string; createdAt: string | null };
type PublicProduct = { id: string; name: string; description: string | null; price: string; soldOut: boolean; photoUrl: string | null };
type PublicTrainer = { id: string; name: string; bio: string | null; about: string | null; avatarUrl: string | null; classes: string[] };
export type PublicStudio = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  tagline: string | null;
  logo: string;
  logoUrl: string | null;
  logoWide: boolean;
  look: Look;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  joinCode: string;
  createdAt: string;
  hours: { weekday: number; from: string; to: string }[];
  faq: { q: string; a: string }[];
  modules: { events: boolean; courses: boolean; shop: boolean };
  trainers: PublicTrainer[];
  classes: PublicClass[];
  products: PublicProduct[];
  schedule: { from: string; sessions: PublicSession[] };
  site: SiteDoc;
};

/** Aplikacja klientki – tam są logowanie, rezerwacje i płatności. */
const APP_URL = '/app';
const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

/**
 * Napis przy wolnych miejscach w grafiku. To decyzja „sprzedażowa”: ile miejsc to już „ostatnie”,
 * czy pokazywać dokładną liczbę, co z pełnymi zajęciami (lista oczekujących jest w aplikacji).
 */
export function spotsLabel(spotsLeft: number): { text: string; tone: 'calm' | 'last' | 'full' } {
  if (spotsLeft <= 0) return { text: 'Lista oczekujących', tone: 'full' };
  if (spotsLeft <= 2) return { text: spotsLeft === 1 ? 'Ostatnie miejsce' : 'Ostatnie 2 miejsca', tone: 'last' };
  return { text: `${spotsLeft} wolnych`, tone: 'calm' };
}

const params = new URLSearchParams(location.search);
const PREVIEW = params.has('podglad');
const IN_EDITOR = PREVIEW && params.has('edytor') && window.self !== window.top;

/** Podgląd szkicu czyta sesję panelu (ten sam adres) – zwykła odwiedzająca jej nie ma i dostaje wersję publiczną. */
function previewHeaders(): Record<string, string> | null {
  try {
    const token = localStorage.getItem('glam.panel.token');
    const studio = localStorage.getItem('glam.panel.studio');
    return token && studio ? { authorization: `Bearer ${token}`, 'x-studio-id': studio } : null;
  } catch {
    return null;
  }
}

async function loadStudio(slug: string): Promise<PublicStudio> {
  const headers = PREVIEW ? previewHeaders() : null;
  const r = await fetch(headers ? '/api/site/preview' : `/api/public/studios/${encodeURIComponent(slug)}`, { headers: headers ?? {} });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message ?? 'Nie udało się wczytać strony.');
  return data as PublicStudio;
}

export function StudioSite({ slug }: { slug: string }) {
  const [studio, setStudio] = useState<PublicStudio | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    loadStudio(slug)
      .then(setStudio)
      .catch((e: Error) => setError(e.message));
  }, [slug]);
  useEffect(reload, [reload]);

  // Dokument na żywo z edytora: podmieniamy tylko układ, teksty i zdjęcia – dane studia zostają.
  const onDoc = useCallback((doc: SiteDoc) => setStudio((s) => (s ? { ...s, site: doc } : s)), []);

  const doc = studio?.site;
  const themeKey = doc ? JSON.stringify(doc.theme) : '';
  useEffect(() => {
    if (studio && doc) applyLook(siteLook(studio.look, doc.theme));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio?.id, themeKey]);

  useEffect(() => {
    if (!studio || !doc) return;
    document.title = doc.seo.title || (studio.tagline ? `${studio.name} – ${studio.tagline}` : studio.name);
    setMeta('description', doc.seo.description || studio.tagline || '');
    if (PREVIEW) setMeta('robots', 'noindex');
  }, [studio, doc]);

  if (error)
    return (
      <main className="site-state">
        <div className="wordmark">glam</div>
        <p className="muted">{error}</p>
        <a className="btn ghost sm" href="/">
          Wróć
        </a>
      </main>
    );
  if (!studio || !doc)
    return (
      <main className="site-state">
        <Spinner />
      </main>
    );

  const news = newClasses(studio);
  return (
    <VideoIds.Provider value={doc.media}>
    <div className="site with-watermark">
      <Watermark src={studio.look.watermark} />
      <SiteNav studio={studio} />
      <main>
        {doc.hero.visible && <Hero studio={studio} news={news} />}
        {doc.sections
          .filter((s) => s.visible)
          .map((s) => (
            <SectionView key={s.key} studio={studio} section={s} news={news} />
          ))}
        {doc.footer.visible && <Footer studio={studio} />}
      </main>
      {IN_EDITOR && <EditorBridge onDoc={onDoc} onRefresh={reload} />}
    </div>
    </VideoIds.Provider>
  );
}

function setMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

// ——— dostęp do wartości pól ———

type Values = Record<string, FieldValue>;
const s = (v: Values, k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
const b = (v: Values, k: string) => v[k] === true;
const img = (v: Values, k: string) => (s(v, k) ? siteImageUrl(s(v, k)) : null);

/** Tytuł z dopiskiem w kursywie – jedyny ozdobnik strony. */
function Title({ v, as = 'h2', className = 'site-h2' }: { v: Values; as?: 'h1' | 'h2'; className?: string }) {
  const Tag = as;
  if (!s(v, 'title') && !s(v, 'serif')) return null;
  return (
    <Tag className={className}>
      {s(v, 'title')}
      {s(v, 'serif') && <span className="serif"> {s(v, 'serif')}</span>}
    </Tag>
  );
}

function Head({ v, children }: { v: Values; children?: ReactNode }) {
  if (!s(v, 'title') && !s(v, 'serif') && !s(v, 'eyebrow') && !children) return null;
  return (
    <div className="site-head">
      <div>
        {s(v, 'eyebrow') && <div className="site-eyebrow">{s(v, 'eyebrow')}</div>}
        <Title v={v} />
      </div>
      {children}
    </div>
  );
}

/** Które pliki strony są filmami (SiteDoc.media). Pole zdjęcia przyjmuje też film – rozpoznajemy go po id. */
const VideoIds = createContext<Record<string, 'video'>>({});

function useIsVideo(src: string) {
  const videos = useContext(VideoIds);
  const id = /\/api\/public-media\/([0-9a-f-]{36})/.exec(src)?.[1];
  return !!id && videos[id] === 'video';
}

const prefersReducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Film jak ruchome zdjęcie: bez dźwięku, w pętli, bez paska sterowania. Gra tylko na ekranie (oszczędza baterię),
 * a przy „ograniczeniu ruchu” w systemie nie startuje sam – wtedy z przyciskami, żeby można go było puścić.
 */
function LoopVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [still] = useState(prefersReducedMotion);
  useEffect(() => {
    const v = ref.current;
    if (!v || still) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? void v.play().catch(() => {}) : v.pause()), { threshold: 0.15 });
    io.observe(v);
    return () => io.disconnect();
  }, [still]);
  // autoPlay: przeglądarki pozwalają same uruchamiać tylko wyciszone filmy z tym atrybutem (np. na telefonie bez dotknięcia).
  return <video ref={ref} src={still ? `${src}#t=0.1` : src} autoPlay={!still} muted loop playsInline preload={still ? 'metadata' : 'auto'} controls={still} aria-hidden={still ? undefined : 'true'} />;
}

/** Zdjęcie albo film w kadrze (wypełnia rodzica jak object-fit: cover). */
function MediaEl({ src, alt = '' }: { src: string; alt?: string }) {
  return useIsVideo(src) ? <LoopVideo src={src} /> : <img src={src} alt={alt} loading="lazy" decoding="async" />;
}

/** Zdjęcie (lub film) strony: leniwe, z kadrem w proporcjach z CSS. */
function Photo({ src, className, alt = '' }: { src: string; className?: string; alt?: string }) {
  return (
    <div className={`site-photo${className ? ` ${className}` : ''}`}>
      <MediaEl src={src} alt={alt} />
    </div>
  );
}

/** Nowe zajęcia według ustawień sekcji „Zajęcia” (nowość = dodane do oferty po starcie studia, przez N dni). */
function newClasses(studio: PublicStudio): Set<string> {
  const sec = studio.site.sections.find((x) => x.type === 'classes');
  if (!sec || !sec.visible || !b(sec.values, 'newsEnabled')) return new Set();
  const days = Number(sec.values.newsDays) || 30;
  return new Set(studio.classes.filter((c) => isNewClass(c.createdAt, studio.createdAt, days)).map((c) => c.id));
}

const newsLabel = (studio: PublicStudio) => s(studio.site.sections.find((x) => x.type === 'classes')?.values ?? {}, 'newsLabel') || 'Nowość';
const classPhoto = (studio: PublicStudio, c: PublicClass) => (studio.site.photos.classes[c.id] ? siteImageUrl(studio.site.photos.classes[c.id]) : c.photoUrl);
const trainerPhoto = (studio: PublicStudio, t: PublicTrainer) => (studio.site.photos.trainers[t.id] ? siteImageUrl(studio.site.photos.trainers[t.id]) : t.avatarUrl);
const sectionKey = (studio: PublicStudio, type: SiteSection['type']) => studio.site.sections.find((x) => x.type === type)?.key ?? type;

// ——— sekcje ———

function SiteNav({ studio }: { studio: PublicStudio }) {
  const doc = studio.site;
  // Sklep bez produktów (albo wyłączony) nie ma sekcji na stronie – więc i odnośnika w menu.
  const links = doc.sections.filter((x) => x.visible && x.nav.trim() && (x.type !== 'shop' || (studio.modules.shop && studio.products.length > 0)));
  return (
    <header className="site-nav" data-edit-target={HERO_ID}>
      <a className="site-brand" href={`#${HERO_ID}`} aria-label={`${studio.name} – początek strony`}>
        {studio.logoUrl ? <StudioBrand studio={studio} scale={1} /> : <span className="site-wordmark">{studio.name}</span>}
      </a>
      {doc.nav.showLinks && links.length > 0 && (
        <nav className="site-links" aria-label="Sekcje strony">
          {links.map((l) => (
            <a key={l.key} href={`#${l.key}`}>
              {l.nav}
            </a>
          ))}
        </nav>
      )}
      <a className="btn sm" href={APP_URL}>
        {doc.nav.button}
      </a>
    </header>
  );
}

function Hero({ studio, news }: { studio: PublicStudio; news: Set<string> }) {
  const v = studio.site.hero.values;
  const fmt = useFormatters(studio.timezone);
  const now = Date.now();
  const next = studio.schedule.sessions.filter((x) => new Date(x.startsAt).getTime() > now).slice(0, 3);
  const fresh = studio.classes.filter((c) => news.has(c.id));
  const title = s(v, 'title') || studio.name;
  const serif = s(v, 'serif') || (studio.tagline ? lowerFirst(studio.tagline) : '');
  const photo = img(v, 'image');
  const layout = photo ? s(v, 'imageLayout') || 'full' : 'text';

  const text = (
    <div className="site-hero-text">
      {b(v, 'showNews') && fresh.length > 0 && (
        <a className="site-news" href={`#${sectionKey(studio, 'classes')}`}>
          <span className="site-new">{newsLabel(studio)}</span> {fresh.map((c) => c.name).join(', ')}
        </a>
      )}
      {s(v, 'eyebrow') && <div className="site-eyebrow">{s(v, 'eyebrow')}</div>}
      <h1 className="site-title">
        {title}
        {serif && <span className="serif"> {serif}</span>}
      </h1>
      {s(v, 'text') && <p className="site-lead">{s(v, 'text')}</p>}
      {(s(v, 'button') || s(v, 'button2')) && (
        <div className="site-actions">
          {s(v, 'button') && (
            <a className="btn" href={APP_URL}>
              {s(v, 'button')}
            </a>
          )}
          {s(v, 'button2') && (
            <a className="site-link" href={`#${sectionKey(studio, 'schedule')}`}>
              {s(v, 'button2')}
            </a>
          )}
        </div>
      )}
      {b(v, 'showNext') && next.length > 0 && (
        <div className="site-next">
          {s(v, 'nextLabel') && <div className="site-eyebrow">{s(v, 'nextLabel')}</div>}
          <ul>
            {next.map((x) => (
              <li key={x.id}>
                <span className="site-time">{fmt.time(x.startsAt)}</span>
                <span>{x.className}</span>
                <span className="site-quiet">{fmt.dayShort(x.startsAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <section id={HERO_ID} data-section-name="Nagłówek strony" className={`site-hero layout-${layout}`}>
      {layout === 'cover' && photo ? (
        <div className="site-hero-cover">
          <MediaEl src={photo} />
          <SideRays className="site-hero-rays" rayColor1="#FFD9A0" rayColor2="#FFF4E2" intensity={1.6} speed={1.6} dust={0.3} />
          {text}
        </div>
      ) : layout === 'side' && photo ? (
        <div className="site-split">
          <SideRays className="site-hero-rays bleed" lightMode rayColor1="#E8B27A" rayColor2="#F2C9B8" intensity={1.8} speed={1.6} opacity={0.75} />
          {text}
          <Photo src={photo} className="tall" />
        </div>
      ) : (
        <>
          <SideRays className="site-hero-rays bleed" lightMode rayColor1="#E8B27A" rayColor2="#F2C9B8" intensity={1.8} speed={1.6} opacity={0.75} />
          {photo && <Photo src={photo} className="wide" />}
          {text}
        </>
      )}
    </section>
  );
}

function SectionView({ studio, section, news }: { studio: PublicStudio; section: SiteSection; news: Set<string> }) {
  const label = section.type === 'article' ? s(section.values, 'title') || 'Sekcja z tekstem' : section.type === 'gallery' ? s(section.values, 'title') || 'Galeria' : specOf(section.type).label;
  const attrs = { id: section.key, 'data-section-name': label, className: `site-section site-${section.type}` };
  switch (section.type) {
    case 'about':
      return <About studio={studio} v={section.values} attrs={attrs} />;
    case 'schedule':
      return <ScheduleSection studio={studio} v={section.values} attrs={attrs} news={news} />;
    case 'classes':
      return <ClassesSection studio={studio} v={section.values} attrs={attrs} news={news} />;
    case 'trainers':
      return <TrainersSection studio={studio} v={section.values} attrs={attrs} />;
    case 'shop':
      return <ShopSection studio={studio} v={section.values} attrs={attrs} />;
    case 'more':
      return <MoreSection studio={studio} v={section.values} attrs={attrs} />;
    case 'article':
      return <Article v={section.values} attrs={attrs} />;
    case 'gallery':
      return <Gallery v={section.values} attrs={attrs} />;
  }
}

type Attrs = { id: string; 'data-section-name': string; className: string };

/** Tekst ze zdjęciem obok (lewo/prawo) albo nad nim – wspólny układ „O studiu” i sekcji z tekstem. */
function WithPhoto({ photo, position, children }: { photo: string | null; position: string; children: ReactNode }) {
  if (!photo) return <div className="site-text-only">{children}</div>;
  if (position === 'top')
    return (
      <>
        <Photo src={photo} className="wide" />
        <div className="site-text-only">{children}</div>
      </>
    );
  return (
    <div className={`site-split${position === 'left' ? ' reverse' : ''}`}>
      <div>{children}</div>
      <Photo src={photo} className="tall" />
    </div>
  );
}

function About({ studio, v, attrs }: { studio: PublicStudio; v: Values; attrs: Attrs }) {
  const zones = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of studio.classes) m.set(c.zone, (m.get(c.zone) ?? 0) + 1);
    return [...m.entries()];
  }, [studio.classes]);
  return (
    <section {...attrs}>
      <WithPhoto photo={img(v, 'image')} position={s(v, 'imagePosition')}>
        <Head v={v} />
        <Paragraphs text={s(v, 'text') || (studio.tagline ? `${studio.tagline}.` : '')} className="site-prose" />
        {b(v, 'showZones') && (
          <ul className="site-facts">
            {zones.map(([zone, n]) => (
              <li key={zone}>
                <span className="site-time">{n}</span> {zone}
              </li>
            ))}
          </ul>
        )}
        {b(v, 'showContact') && <Contact studio={studio} label={s(v, 'contactLabel')} />}
      </WithPhoto>
      {b(v, 'showFaq') && studio.faq.length > 0 && (
        <div className="site-faq">
          {studio.faq.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function Contact({ studio, label }: { studio: PublicStudio; label: string }) {
  const days = new Map<number, string[]>();
  for (const h of studio.hours) days.set(h.weekday, [...(days.get(h.weekday) ?? []), `${h.from}–${h.to}`]);
  return (
    <div className="site-contact">
      {label && <div className="site-eyebrow">{label}</div>}
      <dl>
        {[...days.entries()].map(([d, ranges]) => (
          <div key={d}>
            <dt>{WEEKDAYS[d % 7]}</dt>
            <dd>{ranges.join(', ')}</dd>
          </div>
        ))}
      </dl>
      <div className="site-contact-lines">
        {studio.address && <span>{studio.address}</span>}
        {studio.phone && <a href={`tel:${studio.phone.replace(/\s/g, '')}`}>{studio.phone}</a>}
        {studio.email && <a href={`mailto:${studio.email}`}>{studio.email}</a>}
      </div>
    </div>
  );
}

function ScheduleSection({ studio, v, attrs, news }: { studio: PublicStudio; v: Values; attrs: Attrs; news: Set<string> }) {
  const fmt = useFormatters(studio.timezone);
  const days = useMemo(() => {
    const m = new Map<string, PublicSession[]>();
    for (const x of studio.schedule.sessions) {
      const key = fmt.dateKey(x.startsAt);
      m.set(key, [...(m.get(key) ?? []), x]);
    }
    return m;
  }, [studio.schedule.sessions, fmt]);
  const keys = nextDays(studio.schedule.from, 7);
  const [day, setDay] = useState(keys[0]);
  const now = Date.now();
  const list = (days.get(day) ?? []).filter((x) => b(v, 'showPast') || new Date(x.startsAt).getTime() >= now);
  const label = newsLabel(studio);

  return (
    <section {...attrs}>
      <Head v={v}>
        {s(v, 'button') && (
          <a className="site-link" href={APP_URL}>
            {s(v, 'button')}
          </a>
        )}
      </Head>
      <div className="site-days" role="group" aria-label="Dzień tygodnia">
        {keys.map((k) => {
          const d = new Date(`${k}T12:00:00Z`);
          return (
            <button key={k} aria-pressed={k === day} onClick={() => setDay(k)}>
              <span>{WEEKDAYS[d.getUTCDay()].slice(0, 3)}</span>
              <b>{d.getUTCDate()}</b>
            </button>
          );
        })}
      </div>
      {list.length === 0 ? (
        <p className="site-empty">{s(v, 'emptyText')}</p>
      ) : (
        <ul className="site-rows">
          {list.map((x) => {
            const past = new Date(x.startsAt).getTime() < now;
            const spots = spotsLabel(x.spotsLeft);
            return (
              <li key={x.id} className={past ? 'past' : undefined}>
                <span className="site-time">{fmt.time(x.startsAt)}</span>
                <span className="site-row-main">
                  <span className="site-row-name">
                    {x.className}
                    {news.has(x.classTypeId) && <span className="site-new">{label}</span>}
                  </span>
                  <span className="site-quiet">
                    {x.trainer} · {minutes(x.startsAt, x.endsAt)} min
                  </span>
                </span>
                {!past && b(v, 'showSpots') && <span className={`site-quiet site-spots ${spots.tone}`}>{spots.text}</span>}
                {!past && s(v, 'bookLabel') && (
                  <a className="site-link" href={APP_URL} aria-label={`${s(v, 'bookLabel')}: ${x.className}, ${fmt.time(x.startsAt)}`}>
                    {s(v, 'bookLabel')}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ClassesSection({ studio, v, attrs, news }: { studio: PublicStudio; v: Values; attrs: Attrs; news: Set<string> }) {
  const zones = [...new Set(studio.classes.map((c) => c.zone))];
  const [zone, setZone] = useState<string | null>(null);
  // Nowości na początku listy – reszta w kolejności sal i nazw.
  const list = studio.classes.filter((c) => !zone || c.zone === zone).sort((a, c) => Number(news.has(c.id)) - Number(news.has(a.id)));
  const trainersOf = (id: string) => studio.trainers.filter((t) => t.classes.includes(id)).map((t) => t.name);
  const label = newsLabel(studio);
  const photos = b(v, 'showPhotos');
  const anyPhoto = photos && list.some((c) => classPhoto(studio, c));
  return (
    <section {...attrs}>
      <Head v={v} />
      {b(v, 'showFilter') && zones.length > 1 && (
        <div className="site-filter" role="group" aria-label="Sala">
          <button aria-pressed={zone === null} onClick={() => setZone(null)}>
            Wszystkie
          </button>
          {zones.map((z) => (
            <button key={z} aria-pressed={zone === z} onClick={() => setZone(z)}>
              {z}
            </button>
          ))}
        </div>
      )}
      <div className={anyPhoto ? 'site-cards' : 'site-list'}>
        {list.map((c) => {
          const who = trainersOf(c.id);
          const photo = photos ? classPhoto(studio, c) : null;
          return (
            <article key={c.id} className="site-item">
              {anyPhoto && (photo ? <Photo src={photo} className="card" /> : <div className="site-photo card empty" aria-hidden="true" />)}
              <h3>
                {c.name}
                {news.has(c.id) && <span className="site-new">{label}</span>}
              </h3>
              {c.level && <p className="site-quiet">{c.level}</p>}
              {b(v, 'showDescription') && c.description && <p className="site-desc">{c.description}</p>}
              {b(v, 'showTrainers') && who.length > 0 && <p className="site-quiet">prowadzi {who.join(', ')}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Trenerki jako zakładki: karta (zdjęcie + imię) otwiera pod siatką panel z większym zdjęciem, bio, opisem własnym
 * i zajęciami. Ponowne kliknięcie zamyka. Zdjęcie: z edytora strony, a gdy go nie ma – z profilu w GLAM.
 */
function TrainersSection({ studio, v, attrs }: { studio: PublicStudio; v: Values; attrs: Attrs }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = studio.trainers.find((t) => t.id === openId) ?? null;
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const r = panelRef.current.getBoundingClientRect();
    // Panel poza ekranem (np. na telefonie pod długą siatką) – przewijamy do niego łagodnie.
    if (r.top > window.innerHeight * 0.75 || r.bottom < 0) panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [open]);
  if (studio.trainers.length === 0) return null;
  const className = (id: string) => studio.classes.find((c) => c.id === id)?.name;
  const panelId = `${attrs.id}-panel`;
  return (
    <section {...attrs}>
      <Head v={v} />
      <div className="site-people" role="tablist" aria-label="Trenerki">
        {studio.trainers.map((t) => {
          const names = [...new Set(t.classes.map(className).filter(Boolean))];
          const photo = trainerPhoto(studio, t);
          const selected = t.id === openId;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              className="site-person"
              onClick={() => setOpenId(selected ? null : t.id)}
            >
              {photo ? (
                <Photo src={photo} className="portrait" />
              ) : (
                <div className="site-photo portrait empty" aria-hidden="true">
                  <span className="serif">{t.name.charAt(0)}</span>
                </div>
              )}
              <h3>{t.name}</h3>
              {b(v, 'showBio') && t.bio && <p className="site-desc">{t.bio}</p>}
              {b(v, 'showClasses') && names.length > 0 && <p className="site-quiet">{names.slice(0, 3).join(' · ')}</p>}
              {(t.bio || t.about) && <span className="site-person-more">{selected ? 'zwiń' : 'poznaj'}</span>}
            </button>
          );
        })}
      </div>
      {open && <TrainerPanel key={open.id} studio={studio} t={open} id={panelId} panelRef={panelRef} names={[...new Set(open.classes.map(className).filter(Boolean))] as string[]} />}
    </section>
  );
}

/**
 * Sklep na stronie głównej: produkty z panelu (Sklep → Produkty i stany) z „Kup teraz” prosto do zakupu w aplikacji.
 * Pełny katalog z kategoriami i stroną produktu to osobna podstrona /s/:slug/sklep (ShopSite).
 */
function ShopSection({ studio, v, attrs }: { studio: PublicStudio; v: Values; attrs: Attrs }) {
  const list = studio.products.filter((p) => b(v, 'showSoldOut') || !p.soldOut);
  if (!studio.modules.shop || list.length === 0) return null;
  const buy = s(v, 'buyLabel') || 'Kup teraz';
  return (
    <section {...attrs}>
      <Head v={v}>
        <a className="site-link" href={`/s/${encodeURIComponent(studio.slug)}/sklep`}>
          Cały sklep
        </a>
      </Head>
      <div className="site-cards">
        {list.map((p) => (
          <article key={p.id} className="site-item site-product">
            {p.photoUrl ? <Photo src={p.photoUrl} className="card" alt={p.name} /> : <div className="site-photo card empty" aria-hidden="true" />}
            <h3>{p.name}</h3>
            <p className="site-quiet">{p.soldOut ? 'Wyprzedane' : p.price}</p>
            {b(v, 'showDescription') && p.description && <p className="site-desc">{p.description}</p>}
            {!p.soldOut && (
              <a className="btn sm" href={`${APP_URL}?go=${encodeURIComponent(`shop/${p.id}`)}`} aria-label={`${buy}: ${p.name}, ${p.price}`}>
                {buy}
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function TrainerPanel({ studio, t, id, names, panelRef }: { studio: PublicStudio; t: PublicTrainer; id: string; names: string[]; panelRef: RefObject<HTMLDivElement | null> }) {
  const photo = trainerPhoto(studio, t);
  const paragraphs = (t.about ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div ref={panelRef} id={id} role="tabpanel" aria-label={t.name} className="site-trainer site-split">
      {photo ? (
        <Photo src={photo} className="tall" alt={t.name} />
      ) : (
        <div className="site-photo tall empty" aria-hidden="true">
          <span className="serif">{t.name.charAt(0)}</span>
        </div>
      )}
      <div className="site-trainer-text">
        <h3 className="site-trainer-name serif">{t.name}</h3>
        {t.bio && <p className="site-lead">{t.bio}</p>}
        {paragraphs.map((p, i) => (
          <p key={i} className="site-prose">
            {p}
          </p>
        ))}
        {names.length > 0 && <p className="site-quiet">prowadzi {names.join(' · ')}</p>}
        <a className="site-link" href={APP_URL}>
          Zapisz się na zajęcia
        </a>
      </div>
    </div>
  );
}

/** Odnośniki do podstron (wydarzenia i kursy – wkrótce; sklep – /s/:slug/sklep). */
function MoreSection({ studio, v, attrs }: { studio: PublicStudio; v: Values; attrs: Attrs }) {
  const items = (['events', 'courses', 'shop'] as const).filter((k) => studio.modules[k] && b(v, `${k}Visible`));
  if (items.length === 0) return null;
  const href = (k: (typeof items)[number]) => (k === 'shop' ? `/s/${encodeURIComponent(studio.slug)}/sklep` : null);
  return (
    <section {...attrs}>
      <Head v={v} />
      <ul className="site-rows">
        {items.map((k) => {
          const to = href(k);
          const body = (
            <>
              <span className="site-row-main">
                <span className="site-row-name">{s(v, `${k}Title`)}</span>
                {s(v, `${k}Text`) && <span className="site-quiet">{s(v, `${k}Text`)}</span>}
              </span>
              {!to && s(v, 'soonLabel') && <span className="site-quiet">{s(v, 'soonLabel')}</span>}
            </>
          );
          return to ? (
            <li key={k}>
              <a href={to} className="site-row-link">
                {body}
              </a>
            </li>
          ) : (
            <li key={k} aria-disabled="true">
              {body}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Article({ v, attrs }: { v: Values; attrs: Attrs }) {
  const layout = s(v, 'layout');
  const link = s(v, 'link') || APP_URL;
  return (
    <section {...attrs} className={`${attrs.className} ${layout}`}>
      <div className={layout === 'card' ? 'site-plane' : undefined}>
        <WithPhoto photo={img(v, 'image')} position={s(v, 'imagePosition')}>
          <Head v={v} />
          <Paragraphs text={s(v, 'text')} className="site-prose" />
          {s(v, 'button') && (
            <div className="site-actions">
              <a className="btn" href={link} {...(/^https?:/.test(link) ? { target: '_blank', rel: 'noopener' } : {})}>
                {s(v, 'button')}
              </a>
            </div>
          )}
        </WithPhoto>
      </div>
    </section>
  );
}

function Gallery({ v, attrs }: { v: Values; attrs: Attrs }) {
  const ids = Array.isArray(v.images) ? v.images : [];
  // Pusta galeria: na stronie jej nie ma, w edytorze czeka miejsce na zdjęcia.
  if (ids.length === 0 && !IN_EDITOR) return null;
  const layout = s(v, 'layout') || 'grid';
  return (
    <section {...attrs}>
      <Head v={v} />
      {ids.length === 0 ? (
        <div className={`site-gallery ${layout}`}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="site-photo empty">
              {i === 1 && <span className="site-quiet">Dodaj zdjęcia w panelu po prawej</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className={`site-gallery ${layout}`}>
          {ids.map((id) => (
            <Photo key={id} src={siteImageUrl(id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function Footer({ studio }: { studio: PublicStudio }) {
  const v = studio.site.footer.values;
  const text = s(v, 'text');
  const [before, after] = text.includes('{kod}') ? text.split('{kod}', 2) : [text, null];
  const photo = img(v, 'image');
  return (
    <section id={FOOTER_ID} data-section-name="Stopka" className="site-footer">
      {photo && <Photo src={photo} className="wide" />}
      <div className="site-cta">
        <Title v={v} />
        {text && (
          <p className="site-prose">
            {before}
            {after !== null && <span className="site-code">{studio.joinCode}</span>}
            {after}
          </p>
        )}
        {s(v, 'button') && (
          <a className="btn" href={APP_URL}>
            {s(v, 'button')}
          </a>
        )}
      </div>
      <div className="site-footer-row">
        <span>
          © {new Date().getFullYear()} {studio.name}
          {b(v, 'showAddress') && studio.address ? ` · ${studio.address}` : ''}
        </span>
        {b(v, 'showGlam') && (
          <span>
            działa na <span className="serif">glam</span>
          </span>
        )}
      </div>
    </section>
  );
}

function Paragraphs({ text, className }: { text: string; className?: string }) {
  const parts = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <p key={i} className={className}>
          {p.split('\n').map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

// ——— pomocnicze ———

function useFormatters(timeZone: string) {
  return useMemo(() => {
    const time = new Intl.DateTimeFormat('pl-PL', { timeZone, hour: '2-digit', minute: '2-digit' });
    const dayShort = new Intl.DateTimeFormat('pl-PL', { timeZone, weekday: 'long' });
    const key = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return {
      time: (iso: string) => time.format(new Date(iso)),
      dayShort: (iso: string) => dayShort.format(new Date(iso)),
      dateKey: (iso: string) => key.format(new Date(iso)),
    };
  }, [timeZone]);
}

function nextDays(from: string, n: number) {
  const start = new Date(`${from}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

const minutes = (a: string, c: string) => Math.round((new Date(c).getTime() - new Date(a).getTime()) / 60_000);
const lowerFirst = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
