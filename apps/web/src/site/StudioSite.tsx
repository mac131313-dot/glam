// Publiczna strona studia: /s/:slug. Jeden kod dla każdego studia – układ, teksty i zdjęcia z dokumentu strony
// (core/site.ts), dane (grafik, zajęcia, trenerki) z GLAM. Zapisy i zakupy prowadzą do aplikacji klientki (/app).
// Kierunek: minimalizm na maksa (Isola / Unbound) – dużo powietrza, zdjęcia, jedno kursywne słowo, cienkie linie, bez cieni.
// Kontrakt z edytorem: każda sekcja to bezpośrednie dziecko <main> z id i data-section-name (most szuka `main > section[id]`).
//   ?podglad=1 – szkic zamiast wersji publicznej (wymaga sesji panelu), ?edytor=1 – most do edytora w ramce.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { isNewClass, menuItems, siteImageUrl, siteLook, sitePages, specOf, type FieldValue, type Look, type MenuItem, type SiteDoc, type SitePage, type SiteSection } from '@glam/core';
import { applyLook } from '../look.ts';
import { Icon } from '../icons.tsx';
import { StudioBrand } from '../StudioBrand.tsx';
import { Spinner, Watermark } from '../ui.tsx';
import { Carousel } from './Carousel.tsx';
import { EditorBridge } from './EditorBridge.tsx';
import { GradualBlur } from './GradualBlur.tsx';
import { MOTION, useScrollVar } from './motion.ts';
import { FOOTER_ID, HERO_ID } from './protocol.ts';
import { Reveal } from './Reveal.tsx';
import { SideRays } from './SideRays.tsx';
import { pageHref, SiteNav } from './SiteNav.tsx';
import { SplitHeading } from './SplitHeading.tsx';
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
export function spotsLabel(spotsLeft: number): { text: string; tone: 'calm' | 'few' | 'last' | 'full' } {
  if (spotsLeft <= 0) return { text: 'Lista oczekujących', tone: 'full' };
  // Ostatnie miejsce mocno (wykrzyknik w CSS), dwa–trzy jako odliczanie, dalej spokojna liczba.
  if (spotsLeft === 1) return { text: 'Ostatnie miejsce', tone: 'last' };
  if (spotsLeft <= 3) return { text: `Zostały ${spotsLeft} miejsca`, tone: 'few' };
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

  // Podstrona = jedna zakładka menu pod własnym adresem. Przejścia bez przeładowania; Wstecz w przeglądarce działa.
  const [path, setPath] = useState(pathFromUrl);
  useEffect(() => {
    const sync = () => setPath(pathFromUrl());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const navigate = useCallback(
    (next: string | null) => {
      if (next !== path) history.pushState(null, '', pageHref(slug, next));
      setPath(next);
      window.scrollTo({ top: 0 });
    },
    [path, slug],
  );

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

  const page = studio && !IN_EDITOR && path ? (pagesOf(studio).find((p) => p.path === path) ?? null) : null;
  useEffect(() => {
    if (!studio || !doc) return;
    const home = doc.seo.title || (studio.tagline ? `${studio.name} – ${studio.tagline}` : studio.name);
    document.title = page ? `${page.label} – ${studio.name}` : home;
    setMeta('description', doc.seo.description || studio.tagline || '');
    if (PREVIEW) setMeta('robots', 'noindex');
  }, [studio, doc, page]);

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
      <StudioNav studio={studio} current={page?.path ?? null} onNavigate={navigate} />
      {/* key: przy zmianie podstrony React buduje treść od nowa – nagłówki i karty wjeżdżają jeszcze raz. */}
      <main key={page?.key ?? 'home'} className={page ? 'site-subpage' : undefined}>
        {page ? (
          doc.sections
            .filter((s) => s.key === page.key)
            .map((s) => (
              <PageView key={s.key} studio={studio} section={s} page={page} news={news} onNavigate={navigate} />
            ))
        ) : (
          <>
            {doc.hero.visible && <Hero studio={studio} news={news} />}
            {doc.sections
              .filter((s) => s.visible)
              .map((s) => (
                <SectionView key={s.key} studio={studio} section={s} news={news} />
              ))}
          </>
        )}
        {doc.footer.visible && <Footer studio={studio} />}
      </main>
      {/* Dół okna: treść miękko rozmywa się i ginie w tle strony; przy końcu strony rozmycie znika, żeby nie zasłaniać stopki. */}
      <PageBlur />
      {IN_EDITOR && <EditorBridge onDoc={onDoc} onRefresh={reload} />}
    </div>
    </VideoIds.Provider>
  );
}

/**
 * Rozmycie na dole okna. Nad nagłówkiem strony go nie ma (rozmazywałoby przycisk zapisu na zdjęciu):
 * pojawia się płynnie dopiero, gdy dół nagłówka wyjedzie nad dolną krawędź okna.
 * Siłę skalujemy zmienną --gradual-blur-hover (GradualBlur mnoży przez nią rozmycie i tint) – nie przez opacity,
 * bo przezroczysty rodzic odciąłby backdrop-filter od treści strony.
 */
function PageBlur() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const hero = document.getElementById(HERO_ID);
      const reach = el.firstElementChild?.getBoundingClientRect().height || 1;
      const k = hero ? Math.min(1, Math.max(0, (innerHeight - hero.getBoundingClientRect().bottom) / reach)) : 1;
      el.style.setProperty('--gradual-blur-hover', k.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  });
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      <GradualBlur target="page" position="bottom" height="7rem" strength={2} layers={8} tint="color-mix(in srgb, var(--bg) 55%, transparent)" autoHide zIndex={5} />
    </div>
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
  if (!s(v, 'title') && !s(v, 'serif')) return null;
  return <SplitHeading as={as} className={className} title={s(v, 'title')} serif={s(v, 'serif')} />;
}

function Head({ v, children }: { v: Values; children?: ReactNode }) {
  if (!s(v, 'title') && !s(v, 'serif') && !s(v, 'eyebrow') && !children) return null;
  return (
    <div className="site-head">
      <div>
        {s(v, 'eyebrow') && <Reveal className="site-eyebrow">{s(v, 'eyebrow')}</Reveal>}
        <Title v={v} />
      </div>
      {children && <Reveal delay={0.2}>{children}</Reveal>}
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

/** Zakładki menu tego studia (sklep tylko z produktami – inaczej podstrona byłaby pusta). */
const pagesOf = (studio: PublicStudio) => sitePages(studio.site, { shop: studio.modules.shop && studio.products.length > 0 });

/** Adres podstrony z paska adresu: /s/:slug/:path → path (null = strona główna). */
const pathFromUrl = () => {
  const m = /^\/s\/[^/]+\/([^/?#]+)/.exec(location.pathname);
  return m ? decodeURIComponent(m[1]) : null;
};

/** Układ zdjęcia w nagłówku – ta sama reguła co w Hero (bez zdjęcia zawsze sam tekst). */
const heroLayout = (studio: PublicStudio) => (img(studio.site.hero.values, 'image') ? s(studio.site.hero.values, 'imageLayout') || 'full' : 'text');

function StudioNav({ studio, current, onNavigate }: { studio: PublicStudio; current: string | null; onNavigate: (path: string | null) => void }) {
  const doc = studio.site;
  // Zdjęcie na cały ekran: menu leży na zdjęciu (przezroczyste, jasne), dopóki nie przewiniemy dalej.
  const overPhoto = !current && doc.hero.visible && heroLayout(studio) === 'screen';
  return (
    <SiteNav
      slug={studio.slug}
      brand={studio.logoUrl ? <StudioBrand studio={studio} scale={1} /> : <span className="site-wordmark">{studio.name}</span>}
      brandLabel={`${studio.name} – strona główna`}
      pages={doc.nav.showLinks ? pagesOf(studio) : []}
      current={current}
      button={{ label: doc.nav.button, href: APP_URL }}
      onNavigate={onNavigate}
      // W edytorze cała strona jest jedną kartką – zakładki przewijają do sekcji zamiast zmieniać adres ramki.
      hrefOf={IN_EDITOR ? (p) => `#${p.key}` : undefined}
      editTarget={HERO_ID}
      overlay={overPhoto}
    />
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
  const layout = heroLayout(studio);
  // Przewinięcie nagłówka (0–1) jako --hero-p: zdjęcie zostaje w tyle (parallax), tekst odpływa w górę i blednie.
  const ref = useRef<HTMLElement>(null);
  useScrollVar(ref, '--hero-p');

  const text = (
    <div className="site-hero-text">
      {b(v, 'showNews') && fresh.length > 0 && (
        <a className="site-news" href={`#${sectionKey(studio, 'classes')}`}>
          <span className="site-new">{newsLabel(studio)}</span> {fresh.map((c) => c.name).join(', ')}
        </a>
      )}
      {s(v, 'eyebrow') && <div className="site-eyebrow">{s(v, 'eyebrow')}</div>}
      <SplitHeading as="h1" className="site-title" title={title} serif={serif} delay={0.3} immediate />
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
    <section ref={ref} id={HERO_ID} data-section-name="Nagłówek strony" className={`site-hero layout-${layout}${MOTION ? ' has-motion' : ''}`}>
      {(layout === 'cover' || layout === 'screen') && photo ? (
        <div className="site-hero-cover">
          <MediaEl src={photo} />
          {s(v, 'imageBlur') && s(v, 'imageBlur') !== 'none' && <div className={`site-hero-blur ${s(v, 'imageBlur')}`} aria-hidden />}
          {/* Na zdjęciu promienie mają być ledwo widoczne: chłodna biel zamiast złota, słabiej i z mniejszą ilością pyłu. */}
          <SideRays className="site-hero-rays" rayColor1="#F3F1EC" rayColor2="#FFFFFF" intensity={0.8} speed={1.2} dust={0.12} opacity={0.55} />
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

/**
 * Podstrona = jedna zakładka menu: duży nagłówek strony (tytuł sekcji, wstęp, szerokie zdjęcie), pod nim treść sekcji
 * w pełnej wersji (siatka zamiast karuzeli, galeria sal…) i na dole przejście do następnej zakładki.
 * Tytuł sekcji jest już w nagłówku strony, więc sekcja dostaje wartości bez własnego tytułu.
 */
function PageView({ studio, section, page, news, onNavigate }: { studio: PublicStudio; section: SiteSection; page: SitePage; news: Set<string>; onNavigate: (path: string | null) => void }) {
  const v = section.values;
  const photo = img(v, 'pageImage');
  const pages = pagesOf(studio);
  const next = pages[(pages.findIndex((p) => p.key === page.key) + 1) % pages.length];
  const bare = { ...section, values: { ...v, title: '', serif: '', eyebrow: '' } };
  return (
    <>
      <header className={`site-page-head${photo ? ' has-photo' : ''}`}>
        <SplitHeading as="h1" className="site-page-title" title={s(v, 'title') || page.label} serif={s(v, 'serif')} immediate />
        {s(v, 'pageIntro') && (
          <Reveal delay={0.25}>
            <p className="site-lead">{s(v, 'pageIntro')}</p>
          </Reveal>
        )}
        {photo && (
          <Reveal delay={0.35}>
            <Photo src={photo} className="wide" />
          </Reveal>
        )}
      </header>
      <SectionView studio={studio} section={bare} news={news} subpage />
      {next && next.key !== page.key && (
        <nav className="site-page-next" aria-label="Następna zakładka">
          <a
            href={pageHref(studio.slug, next.path)}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onNavigate(next.path);
            }}
          >
            <span className="site-eyebrow">Dalej</span>
            <span className="site-page-next-name">
              {next.label} <span aria-hidden="true">→</span>
            </span>
          </a>
        </nav>
      )}
    </>
  );
}

function SectionView({ studio, section, news, subpage = false }: { studio: PublicStudio; section: SiteSection; news: Set<string>; subpage?: boolean }) {
  const label = section.type === 'article' ? s(section.values, 'title') || 'Sekcja z tekstem' : section.type === 'gallery' ? s(section.values, 'title') || 'Galeria' : specOf(section.type).label;
  // .site-menu to już okno menu nawigacji na telefonie – sekcja menu baru dostaje klasę .site-bar.
  const attrs = { id: section.key, 'data-section-name': label, className: `site-section site-${section.type === 'menu' ? 'bar' : section.type}` };
  switch (section.type) {
    case 'about':
      return <About studio={studio} v={section.values} attrs={attrs} subpage={subpage} />;
    case 'schedule':
      return <ScheduleSection studio={studio} v={section.values} attrs={attrs} news={news} />;
    case 'classes':
      return <ClassesSection studio={studio} v={section.values} attrs={attrs} news={news} subpage={subpage} />;
    case 'trainers':
      return <TrainersSection studio={studio} v={section.values} attrs={attrs} subpage={subpage} />;
    case 'shop':
      return <ShopSection studio={studio} v={section.values} attrs={attrs} />;
    case 'menu':
      return <MenuSection v={section.values} attrs={attrs} subpage={subpage} />;
    case 'more':
      return <MoreSection studio={studio} v={section.values} attrs={attrs} />;
    case 'article':
      return <Article v={section.values} attrs={attrs} />;
    case 'gallery':
      return <Gallery v={section.values} attrs={attrs} />;
  }
}

type Attrs = { id: string; 'data-section-name': string; className: string };

/** Karty: na stronie głównej karuzela, na podstronie wszystkie naraz w siatce (podstrona ma pokazać całość). */
function Cards({ subpage, label, className, children }: { subpage: boolean; label: string; className?: string; children: ReactNode }) {
  if (subpage) return <div className={`site-cards${className ? ` ${className}` : ''}`}>{children}</div>;
  return (
    <Reveal>
      <Carousel label={label} className={className}>
        {children}
      </Carousel>
    </Reveal>
  );
}

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

function About({ studio, v, attrs, subpage }: { studio: PublicStudio; v: Values; attrs: Attrs; subpage: boolean }) {
  const rooms = Array.isArray(v.rooms) ? (v.rooms as string[]) : [];
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
      {rooms.length > 0 && (
        <div className="site-rooms">
          <div className="site-head">
            <SplitHeading as="h2" className="site-h2 site-h2-sm" title={s(v, 'roomsTitle')} serif={s(v, 'roomsSerif')} />
            {zones.length > 0 && <Reveal className="site-quiet">{zones.map(([z]) => z).join(' · ')}</Reveal>}
          </div>
          {/* Strona główna: pasek do przewijania; podstrona „Studio”: duże kadry po dwa – sala w pełnej krasie. */}
          <PhotoGallery ids={rooms} layout={subpage ? 'rooms' : 'row'} label="Zdjęcia sal" />
        </div>
      )}
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
  const now = Date.now();
  const showPast = b(v, 'showPast');
  /** Zajęcia dnia do pokazania (bez minionych, chyba że studio chce je widzieć). */
  const days = useMemo(() => {
    const m = new Map<string, PublicSession[]>();
    for (const x of studio.schedule.sessions) {
      if (!showPast && new Date(x.startsAt).getTime() < now) continue;
      const key = fmt.dateKey(x.startsAt);
      m.set(key, [...(m.get(key) ?? []), x]);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.schedule.sessions, fmt, showPast]);
  const keys = nextDays(studio.schedule.from, 7);
  // Na start pierwszy dzień, w którym coś jeszcze się odbędzie – wieczorem nie otwieramy pustego „dziś”.
  const [day, setDay] = useState(() => keys.find((k) => days.has(k)) ?? keys[0]);
  const list = days.get(day) ?? [];
  const nextDay = keys.find((k) => k > day && days.has(k));
  const label = newsLabel(studio);
  const dayIndex = Math.max(0, keys.indexOf(day));
  const [openId, setOpenId] = useState<string | null>(null);
  const open = studio.schedule.sessions.find((x) => x.id === openId) ?? null;

  return (
    <section {...attrs}>
      <Head v={v}>
        {s(v, 'button') && (
          <a className="site-link" href={APP_URL}>
            {s(v, 'button')}
          </a>
        )}
      </Head>
      {/* Wskaźnik pod wybranym dniem przesuwa się (--i), zamiast skakać. Kropki = ile zajęć tego dnia. */}
      <div className="site-days" role="group" aria-label="Dzień tygodnia" style={{ '--i': dayIndex, '--n': keys.length } as CSSProperties}>
        {keys.map((k) => {
          const d = new Date(`${k}T12:00:00Z`);
          const count = days.get(k)?.length ?? 0;
          return (
            <button key={k} type="button" aria-pressed={k === day} className={count ? undefined : 'rest'} onClick={() => setDay(k)} aria-label={`${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}, ${count ? `zajęcia: ${count}` : 'bez zajęć'}`}>
              <span className="site-day-name">{WEEKDAYS[d.getUTCDay()].slice(0, 3)}</span>
              <b>{d.getUTCDate()}</b>
              <span className="site-day-dots" aria-hidden="true">
                {Array.from({ length: Math.min(count, 6) }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </button>
          );
        })}
        <span className="site-days-bar" aria-hidden="true" />
      </div>
      {list.length === 0 ? (
        <div className="site-empty" key={`empty-${day}`}>
          <p className="serif">{s(v, 'emptyText')}</p>
          {nextDay && (
            <button type="button" className="site-link site-empty-next" onClick={() => setDay(nextDay)}>
              Najbliższe zajęcia: {fmt.dayShort(days.get(nextDay)![0].startsAt)}, {fmt.time(days.get(nextDay)![0].startsAt)} →
            </button>
          )}
        </div>
      ) : (
        <ul className="site-rows" key={day}>
          {list.map((x, i) => {
            const past = new Date(x.startsAt).getTime() < now;
            const spots = spotsLabel(x.spotsLeft);
            return (
              <li key={x.id} className={past ? 'past' : undefined} style={{ '--i': i } as CSSProperties}>
                <span className="site-time">{fmt.time(x.startsAt)}</span>
                {/* Cały wiersz otwiera okno zajęć (przycisk rozciągnięty na wiersz), „Zapisz się” leży nad nim. */}
                <button type="button" className="site-row-main" aria-haspopup="dialog" onClick={() => setOpenId(x.id)}>
                  <span className="site-row-name">
                    {x.className}
                    {news.has(x.classTypeId) && <span className="site-new">{label}</span>}
                  </span>
                  <span className="site-quiet">
                    {x.trainer} · {minutes(x.startsAt, x.endsAt)} min{x.zone ? ` · ${x.zone}` : ''}
                  </span>
                </button>
                {!past && b(v, 'showSpots') && <span className={`site-spots ${spots.tone}`}>{spots.text}</span>}
                {!past && s(v, 'bookLabel') && (
                  <a className="site-book" href={APP_URL} aria-label={`${s(v, 'bookLabel')}: ${x.className}, ${fmt.time(x.startsAt)}`}>
                    {s(v, 'bookLabel')} <span aria-hidden="true">→</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && <SessionDialog key={open.id} studio={studio} v={v} x={open} isNew={news.has(open.classTypeId)} onClose={() => setOpenId(null)} />}
    </section>
  );
}

/**
 * Okno zajęć z grafiku: zdjęcie i opis typu zajęć z GLAM, termin, kto prowadzi, sala, wolne miejsca i zapis.
 * Ten sam natywny <dialog> co okno trenerki (fokus, Esc, tło), na telefonie wysuwa się od dołu.
 */
function SessionDialog({ studio, v, x, isNew, onClose }: { studio: PublicStudio; v: Values; x: PublicSession; isNew: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const fmt = useFormatters(studio.timezone);
  const c = studio.classes.find((k) => k.id === x.classTypeId);
  const photo = c ? classPhoto(studio, c) : null;
  const past = new Date(x.startsAt).getTime() < Date.now();
  const spots = spotsLabel(x.spotsLeft);
  const book = s(v, 'bookLabel') || 'Zapisz się';
  const paragraphs = (c?.description ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const titleId = `session-${x.id}-name`;
  // Grafik zna tylko imię prowadzącej – profil szukamy po imieniu (dokładnie, potem po pierwszym słowie).
  const trainer =
    studio.trainers.find((t) => t.name === x.trainer) ??
    studio.trainers.find((t) => t.name.split(' ')[0] === x.trainer.split(' ')[0]) ??
    null;
  const [showTrainer, setShowTrainer] = useState(false);
  const trainerPic = trainer ? trainerPhoto(studio, trainer) : null;
  const trainerClasses = trainer
    ? ([...new Set(trainer.classes.map((id) => studio.classes.find((k) => k.id === id)?.name).filter(Boolean))] as string[])
    : [];
  return (
    <dialog
      ref={ref}
      className="site-dialog"
      aria-labelledby={titleId}
      // React przepuszcza `close` z okna profilu (dziecko w drzewie) – zamykamy tylko na własne zdarzenie.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <button type="button" className="site-dialog-close" onClick={() => ref.current?.close()} aria-label="Zamknij">
        <Icon name="close" size={18} />
      </button>
      <div className="site-trainer">
        {photo ? (
          <Photo src={photo} className="tall" alt={x.className} />
        ) : (
          <div className="site-photo tall empty" style={{ background: c?.color }} aria-hidden="true">
            <span className="serif">{x.className.charAt(0)}</span>
          </div>
        )}
        <div className="site-trainer-text">
          <p className="site-eyebrow">
            {fmt.dayLong(x.startsAt)}, {fmt.time(x.startsAt)}–{fmt.time(x.endsAt)}
          </p>
          <h3 id={titleId} className="site-trainer-name serif">
            {x.className}
            {isNew && <span className="site-new">{newsLabel(studio)}</span>}
          </h3>
          <p className="site-lead">
            {minutes(x.startsAt, x.endsAt)} min{x.zone ? ` · ${x.zone}` : ''}
            {c?.level ? ` · ${c.level}` : ''}
          </p>
          {paragraphs.map((p, i) => (
            <p key={i} className="site-prose">
              {p}
            </p>
          ))}
          {x.trainer &&
            (trainer ? (
              <button type="button" className="site-host" aria-haspopup="dialog" onClick={() => setShowTrainer(true)}>
                <HostAvatar name={trainer.name} photo={trainerPic} />
                <span className="site-host-text">
                  <span className="site-host-label">Prowadzący</span>
                  <span className="site-host-name">{trainer.name}</span>
                </span>
                <span className="site-host-more">zobacz profil</span>
              </button>
            ) : (
              <div className="site-host">
                <HostAvatar name={x.trainer} photo={null} />
                <span className="site-host-text">
                  <span className="site-host-label">Prowadzący</span>
                  <span className="site-host-name">{x.trainer}</span>
                </span>
              </div>
            ))}
          {!past && (
            <div className="site-session-actions">
              {b(v, 'showSpots') && <span className={`site-spots ${spots.tone}`}>{spots.text}</span>}
              <a className="btn" href={APP_URL}>
                {book}
              </a>
            </div>
          )}
        </div>
      </div>
      {showTrainer && trainer && <TrainerDialog studio={studio} t={trainer} names={trainerClasses} onClose={() => setShowTrainer(false)} />}
    </dialog>
  );
}

/** Okrągłe zdjęcie prowadzącej w oknie zajęć; bez zdjęcia – pierwsza litera imienia. */
function HostAvatar({ name, photo }: { name: string; photo: string | null }) {
  return photo ? (
    <span className="site-host-avatar">
      <MediaEl src={photo} alt="" />
    </span>
  ) : (
    <span className="site-host-avatar empty serif" aria-hidden="true">
      {name.charAt(0)}
    </span>
  );
}

function ClassesSection({ studio, v, attrs, news, subpage }: { studio: PublicStudio; v: Values; attrs: Attrs; news: Set<string>; subpage: boolean }) {
  const zones = [...new Set(studio.classes.map((c) => c.zone))];
  const [zone, setZone] = useState<string | null>(null);
  // Nowości na początku listy – reszta w kolejności sal i nazw.
  const list = studio.classes.filter((c) => !zone || c.zone === zone).sort((a, c) => Number(news.has(c.id)) - Number(news.has(a.id)));
  const trainersOf = (id: string) => studio.trainers.filter((t) => t.classes.includes(id)).map((t) => t.name);
  const label = newsLabel(studio);
  const photos = b(v, 'showPhotos');
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
      {/* Nowa sala = karuzela od początku (key). Karta bez zdjęcia dostaje kolor zajęć z GLAM i inicjał w kursywie. */}
      <Cards key={zone ?? 'all'} subpage={subpage} label={s(v, 'title') || 'Zajęcia'}>
        {list.map((c) => {
          const who = trainersOf(c.id);
          const photo = photos ? classPhoto(studio, c) : null;
          return (
            <article key={c.id} className="site-item">
              {photo ? (
                <Photo src={photo} className="card" />
              ) : (
                <div className="site-photo card empty" style={{ background: c.color }} aria-hidden="true">
                  <span className="serif">{c.name.charAt(0)}</span>
                </div>
              )}
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
      </Cards>
    </section>
  );
}

/**
 * Trenerki jako zakładki: karta (zdjęcie + imię) otwiera pod karuzelą panel z większym zdjęciem, bio, opisem własnym
 * i zajęciami. Ponowne kliknięcie zamyka. Zdjęcie: z edytora strony, a gdy go nie ma – z profilu w GLAM.
 */
function TrainersSection({ studio, v, attrs, subpage }: { studio: PublicStudio; v: Values; attrs: Attrs; subpage: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = studio.trainers.find((t) => t.id === openId) ?? null;
  if (studio.trainers.length === 0) return null;
  const className = (id: string) => studio.classes.find((c) => c.id === id)?.name;
  return (
    <section {...attrs}>
      <Head v={v} />
      <Cards subpage={subpage} label="Trenerki" className="site-people">
        {studio.trainers.map((t) => {
          const names = [...new Set(t.classes.map(className).filter(Boolean))];
          const photo = trainerPhoto(studio, t);
          return (
            <button key={t.id} type="button" aria-haspopup="dialog" className="site-person" onClick={() => setOpenId(t.id)}>
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
              {(t.bio || t.about) && <span className="site-person-more">poznaj</span>}
            </button>
          );
        })}
      </Cards>
      {open && <TrainerDialog key={open.id} studio={studio} t={open} names={[...new Set(open.classes.map(className).filter(Boolean))] as string[]} onClose={() => setOpenId(null)} />}
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

/**
 * Okno trenerki (natywny <dialog> w trybie modalnym): przeglądarka sama trzyma w nim fokus, zamyka na Esc
 * i oddaje fokus karcie, z której przyszłyśmy. Zamyka też krzyżyk i kliknięcie w tło. Na telefonie wysuwa się od dołu.
 */
function TrainerDialog({ studio, t, names, onClose }: { studio: PublicStudio; t: PublicTrainer; names: string[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const photo = trainerPhoto(studio, t);
  const paragraphs = (t.about ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const titleId = `trainer-${t.id}-name`;
  return (
    <dialog
      ref={ref}
      className="site-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      // Kliknięcie w samo tło (poza treścią okna) trafia w element <dialog> – wtedy zamykamy.
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <button type="button" className="site-dialog-close" onClick={() => ref.current?.close()} aria-label="Zamknij">
        <Icon name="close" size={18} />
      </button>
      <div className="site-trainer">
      {photo ? (
        <Photo src={photo} className="tall" alt={t.name} />
      ) : (
        <div className="site-photo tall empty" aria-hidden="true">
          <span className="serif">{t.name.charAt(0)}</span>
        </div>
      )}
      <div className="site-trainer-text">
        <h3 id={titleId} className="site-trainer-name serif">{t.name}</h3>
        {t.bio && <p className="site-lead">{t.bio}</p>}
        {paragraphs.map((p, i) => (
          <p key={i} className="site-prose">
            {p}
          </p>
        ))}
        {names.length > 0 && <p className="site-quiet">prowadzi {names.join(' · ')}</p>}
        <a className="btn" href={APP_URL}>
          Zapisz się na zajęcia
        </a>
      </div>
      </div>
    </dialog>
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
  const ids = Array.isArray(v.images) ? (v.images as string[]) : [];
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
        <PhotoGallery ids={ids} layout={layout} label={s(v, 'title') || 'Galeria'} />
      )}
    </section>
  );
}

/**
 * Zdjęcia w siatce / mozaice / pasku; kliknięcie otwiera podgląd na cały ekran ze strzałkami (← → na klawiaturze).
 * Filmy grają w kadrze jak ruchome zdjęcia.
 */
function PhotoGallery({ ids, layout, label }: { ids: string[]; layout: string; label: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className={`site-gallery ${layout}`}>
        {ids.map((id, i) => (
          <button key={id} type="button" className="site-photo site-gallery-item" style={{ '--i': i } as CSSProperties} onClick={() => setOpen(i)} aria-label={`${label}: ${i + 1} z ${ids.length}, powiększ`}>
            <MediaEl src={siteImageUrl(id)} />
          </button>
        ))}
      </div>
      {open !== null && <Lightbox ids={ids} start={open} label={label} onClose={() => setOpen(null)} />}
    </>
  );
}

function Lightbox({ ids, start, label, onClose }: { ids: string[]; start: number; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState(start);
  const go = (d: number) => setI((x) => (x + d + ids.length) % ids.length);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="site-lightbox"
      aria-label={label}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(1);
        if (e.key === 'ArrowLeft') go(-1);
      }}
    >
      <figure key={ids[i]}>
        <MediaEl src={siteImageUrl(ids[i])} />
        <figcaption className="site-quiet">
          {i + 1} / {ids.length}
        </figcaption>
      </figure>
      <button type="button" className="site-dialog-close" onClick={() => ref.current?.close()} aria-label="Zamknij">
        <Icon name="close" size={18} />
      </button>
      {ids.length > 1 && (
        <>
          <button type="button" className="site-lightbox-nav prev" onClick={() => go(-1)} aria-label="Poprzednie zdjęcie">
            <span aria-hidden="true">←</span>
          </button>
          <button type="button" className="site-lightbox-nav next" onClick={() => go(1)} aria-label="Następne zdjęcie">
            <span aria-hidden="true">→</span>
          </button>
        </>
      )}
    </dialog>
  );
}

/**
 * Menu baru: pozycje z edytora strony, pogrupowane w kategorie. Przy kilku kategoriach – zakładki nad listą.
 * Wiersz jak w karcie kawiarni: nazwa, kropki prowadzące wzrok do ceny, pod spodem opis drobnym drukiem.
 */
function MenuSection({ v, attrs, subpage }: { v: Values; attrs: Attrs; subpage: boolean }) {
  const items = menuItems(v);
  const [cat, setCat] = useState<string | null>(null);
  // Na stronie głównej pusta sekcja znika; na własnej zakładce mówi, że menu dopiero się pojawi.
  if (items.length === 0 && !IN_EDITOR && !subpage) return null;
  const groups = new Map<string, MenuItem[]>();
  for (const x of items) groups.set(x.category.trim(), [...(groups.get(x.category.trim()) ?? []), x]);
  const cats = [...groups.keys()];
  const tabs = b(v, 'showTabs') && cats.length > 1;
  const shown = tabs && cat !== null && groups.has(cat) ? [[cat, groups.get(cat)!] as const] : [...groups.entries()];
  const photo = img(v, 'image');
  const photos = b(v, 'showPhotos');

  const list = (
    <div className="site-bar-body">
      {s(v, 'text') && <p className="site-lead site-bar-lead">{s(v, 'text')}</p>}
      {tabs && (
        <div className="site-filter" role="group" aria-label="Kategoria menu">
          <button aria-pressed={cat === null} onClick={() => setCat(null)}>
            Wszystko
          </button>
          {cats.map((c) => (
            <button key={c} aria-pressed={cat === c} onClick={() => setCat(c)}>
              {c || 'Inne'}
            </button>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <p className="site-empty serif">{IN_EDITOR ? 'Dodaj pozycje menu w panelu po prawej' : 'Menu wkrótce – zajrzyj do baru po zajęciach'}</p>
      ) : (
        <div key={cat ?? 'all'}>
          {shown.map(([c, list]) => (
            <div key={c} className="site-bar-group">
              {c && (!tabs || cat === null) && <h3 className="site-bar-cat serif">{c}</h3>}
              <ul className="site-bar-list">
                {list.map((x, i) => (
                  <li key={x.id} className={photos && x.image ? 'with-photo' : undefined} style={{ '--i': i } as CSSProperties}>
                    {photos && x.image && (
                      <span className="site-bar-thumb">
                        <img src={siteImageUrl(x.image)} alt="" loading="lazy" decoding="async" />
                      </span>
                    )}
                    <span className="site-bar-line">
                      <span className="site-bar-name">
                        {x.name}
                        {x.tag && <span className="site-new">{x.tag}</span>}
                      </span>
                      <span className="site-bar-dots" aria-hidden="true" />
                      {x.price && <span className="site-bar-price">{x.price}</span>}
                    </span>
                    {x.text && <span className="site-bar-desc">{x.text}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {/* Menu baru to oferta na miejscu – w odróżnieniu od sklepu, który wysyła do domu. */}
      {items.length > 0 && <p className="site-quiet site-bar-onsite">Tylko na miejscu, w barze studia.</p>}
      {s(v, 'note') && <p className="site-bar-note serif">{s(v, 'note')}</p>}
    </div>
  );

  return (
    <section {...attrs}>
      <Head v={v} />
      {photo ? (
        <div className="site-bar-split">
          {list}
          <Photo src={photo} className="tall" />
        </div>
      ) : (
        list
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
    const dayLong = new Intl.DateTimeFormat('pl-PL', { timeZone, weekday: 'long', day: 'numeric', month: 'long' });
    const key = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return {
      time: (iso: string) => time.format(new Date(iso)),
      dayShort: (iso: string) => dayShort.format(new Date(iso)),
      dayLong: (iso: string) => dayLong.format(new Date(iso)),
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
