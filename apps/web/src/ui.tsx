import { SURFACE, useAuthedUrl } from './api.ts';
import { useLayer } from './back.ts';
import { Component, createContext, lazy, Suspense, useCallback, type ComponentType, type LazyExoticComponent, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type AnimationEvent, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CHECKIN_STEP_MS, checkinStep, liveCheckinCode, type LiveCheckin } from '@glam/core';

type Toast = { text: string; kind: 'ok' | 'error' } | null;
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {});

const ThanksCtx = createContext<() => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  const [thanks, setThanks] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ text, kind });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);
  // Licznik zamiast true/false: druga opinia pod rząd montuje ekran od nowa i animacja serca rusza ponownie.
  const showThanks = useCallback(() => setThanks((n) => n + 1), []);
  const hideThanks = useCallback(() => setThanks(0), []);
  return (
    <ToastCtx.Provider value={show}>
      <ThanksCtx.Provider value={showThanks}>
        {children}
        {thanks > 0 && <ThanksScreen key={thanks} onClose={hideThanks} />}
      </ThanksCtx.Provider>
      {toast && (
        <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Pełnoekranowe podziękowanie po opinii (NPS, ocena zajęć, opinia o kursie). Żyje w providerze, więc przeżywa zamknięcie ekranu z formularzem. */
export const useThanks = () => useContext(ThanksCtx);

function ThanksScreen({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onClose, 3200);
    return () => window.clearTimeout(t);
  }, [onClose]);
  return (
    <div className="thanks" role="status" aria-live="polite" onClick={onClose}>
      <svg className="thanks-heart" viewBox="0 0 64 64" width="112" height="112" aria-hidden>
        <circle className="halo" cx="32" cy="33" r="30" />
        <path className="heart" pathLength={1} d="M32 54C29 51.4 9 37.8 9 23.6 9 16 14.8 10.5 21.8 10.5c4.6 0 8 2.5 10.2 6 2.2-3.5 5.6-6 10.2-6C49.2 10.5 55 16 55 23.6 55 37.8 35 51.4 32 54z" />
      </svg>
      <p className="thanks-title">Twoja opinia ma dla nas duże znaczenie</p>
      <p className="thanks-sub">Dziękujemy</p>
    </div>
  );
}

/**
 * Fokus w oknie: po otwarciu przechodzi do okna (czytnik ekranu zaczyna od jego treści, nie od tła),
 * po zamknięciu wraca do elementu, który okno otworzył.
 */
function useDialogFocus() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}

/** Czy klientka (system albo ustawienia aplikacji) wyłączyła animacje – wtedy przewijamy bez płynnego przejazdu. */
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('a11y-reduce');

/**
 * Zwijana sekcja: cienka linia, nagłówek z krótką informacją po prawej i strzałką. Treść rozwija się płynnie
 * (wysokość przez grid 0fr → 1fr), a gdy nagłówek jest nisko na ekranie – strona delikatnie podjeżdża do sekcji.
 * lazy: treść powstaje dopiero przy pierwszym rozwinięciu – długie listy kafelków ze zdjęciami nie spowalniają ekranu.
 */
export function Fold({ title, meta, defaultOpen = false, lazy = false, children }: { title: ReactNode; meta?: ReactNode; defaultOpen?: boolean; lazy?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const [opened, setOpened] = useState(defaultOpen);
  if (open && !opened) setOpened(true);
  const ref = useRef<HTMLElement>(null);
  const bodyId = useId();
  const toggle = () => {
    setOpen(!open);
    if (open) return;
    const head = ref.current;
    if (head && head.getBoundingClientRect().top > window.innerHeight * 0.55) {
      requestAnimationFrame(() => head.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }));
    }
  };
  return (
    <section ref={ref} className={open ? 'fold is-open' : 'fold'}>
      <h2 className="fold-h">
        <button type="button" className="fold-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <span className="fold-title">{title}</span>
          {meta != null && meta !== '' && <span className="fold-meta">{meta}</span>}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h2>
      <div className="fold-body" id={bodyId} inert={!open}>
        <div className="fold-inner">{!lazy || opened ? children : null}</div>
      </div>
    </section>
  );
}

/** Ile trwa wyjście okna – zgodnie z `sheet-down` / `sheet-out` / `scrim-out` w styles.css. */
const SHEET_EXIT_MS = 200;

/** Gdzie zatrzymałby się rzut przy danej prędkości (px/s) – to samo wygaszanie co przewijanie w iOS. */
const project = (velocity: number, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);

/** Miękki opór za krawędzią: im dalej, tym mniej okno idzie za palcem. */
const rubberband = (over: number, size: number, c = 0.55) => (over * size * c) / (size + c * Math.abs(over));

/**
 * Okno od dołu, które zamyka się gestem: palec ciągnie je 1:1 w dół (tylko gdy treść jest przewinięta na samą
 * górę), w górę stawia miękki opór. Po puszczeniu liczy się, gdzie okno by dojechało z rozpędu, a nie gdzie
 * jest teraz – krótki szybki ruch zamyka tak samo jak długi powolny. Złapane w trakcie powrotu rusza z miejsca,
 * w którym akurat jest. Na szerokim ekranie w panelu okno stoi na środku i gestu nie ma (uchwyt jest ukryty).
 */
function useSheetDrag(sheetRef: RefObject<HTMLDivElement | null>, overlayRef: RefObject<HTMLDivElement | null>, onThrow: () => void, onClose: () => void) {
  const throwRef = useRef(onThrow);
  const closeRef = useRef(onClose);
  throwRef.current = onThrow;
  closeRef.current = onClose;
  useEffect(() => {
    const sheet = sheetRef.current;
    const overlay = overlayRef.current;
    if (!sheet || !overlay) return;
    let startY = 0;
    let base = 0;
    let dy = 0;
    let dragging = false;
    let tracking = false;
    let justDragged = false;
    let samples: { y: number; t: number }[] = [];

    const set = (y: number, animate: boolean) => {
      const ease = animate ? `${reducedMotion() ? 0 : 380}ms var(--ease-spring)` : '0s';
      sheet.style.transition = `transform ${ease}`;
      overlay.style.transition = `background-color ${ease}`;
      sheet.style.transform = y ? `translateY(${y}px)` : '';
      // Rozjaśnia się tylko tło pod oknem – opacity na nakładce prześwietliłaby też samo okno.
      const scrim = Math.round(30 * Math.max(0, 1 - y / sheet.offsetHeight));
      overlay.style.backgroundColor = y > 0 ? `color-mix(in srgb, var(--ink) ${scrim}%, transparent)` : '';
    };
    // Wartość „na ekranie”, nie docelowa – żeby złapanie w trakcie powrotu nie dawało skoku.
    const current = () => new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;

    const start = (y: number, target: EventTarget | null) => {
      if (getComputedStyle(sheet.querySelector('.sheet-handle') ?? sheet).display === 'none') return;
      if ((target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable], .scroll-row')) return;
      tracking = true;
      dragging = false;
      startY = y;
      base = current();
      samples = [{ y, t: performance.now() }];
    };
    const move = (y: number, e: Event) => {
      if (!tracking) return;
      if (!dragging) {
        // Próg ~8 px w dół i treść na samej górze – inaczej to zwykłe przewijanie albo stuknięcie.
        if (Math.abs(y - startY) < 8) return;
        if (y < startY || sheet.scrollTop > 0) { tracking = false; return; }
        dragging = true;
        startY = y;
        // Złapane w trakcie wjazdu: animacja CSS przykryłaby palec, więc ją zdejmujemy i ruszamy z bieżącej pozycji.
        base = current();
        sheet.getAnimations().forEach((a) => a.cancel());
      }
      if (e.cancelable) e.preventDefault();
      const d = y - startY + base;
      dy = d < 0 ? -rubberband(-d, sheet.offsetHeight) : d;
      set(dy, false);
      samples.push({ y, t: performance.now() });
      if (samples.length > 5) samples.shift();
    };
    const end = () => {
      if (!tracking) return;
      tracking = false;
      if (!dragging) return;
      dragging = false;
      justDragged = true;
      window.setTimeout(() => { justDragged = false; }, 0);
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.t - first.t;
      const velocity = dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
      const landing = dy + project(velocity);
      if (velocity > -50 && landing > sheet.offsetHeight * 0.5) {
        if (reducedMotion()) { closeRef.current(); return; }
        // Odjazd w dół z prędkością palca: im szybszy rzut, tym krócej (granice, żeby nie mignęło ani nie wlekło).
        const rest = sheet.offsetHeight - dy;
        const ms = Math.min(320, Math.max(160, velocity > 0 ? (rest / velocity) * 1000 * 2 : 280));
        sheet.classList.add('is-thrown');
        sheet.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.6, 0.35, 1)`;
        sheet.style.transform = `translateY(${sheet.offsetHeight}px)`;
        throwRef.current();
      } else {
        set(0, true);
      }
    };

    const onTouchStart = (e: TouchEvent) => start(e.touches[0].clientY, e.target);
    const onTouchMove = (e: TouchEvent) => move(e.touches[0].clientY, e);
    const onMouseDown = (e: MouseEvent) => { if (e.button === 0) start(e.clientY, e.target); };
    const onMouseMove = (e: MouseEvent) => move(e.clientY, e);
    // Kliknięcie kończące przeciąganie myszą nie może zamknąć okna przez tło ani nacisnąć przycisku pod kursorem.
    const onClickCapture = (e: MouseEvent) => { if (justDragged) e.stopPropagation(); };
    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchmove', onTouchMove, { passive: false });
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
    sheet.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', end);
    overlay.addEventListener('click', onClickCapture, true);
    return () => {
      sheet.removeEventListener('touchstart', onTouchStart);
      sheet.removeEventListener('touchmove', onTouchMove);
      sheet.removeEventListener('touchend', end);
      sheet.removeEventListener('touchcancel', end);
      sheet.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', end);
      overlay.removeEventListener('click', onClickCapture, true);
    };
  }, [sheetRef, overlayRef]);
}

export function Sheet({ onClose, children, label, className }: { onClose: () => void; children: ReactNode; label: string; className?: string }) {
  // Okno odchodzi tą samą drogą, którą przyszło, i dopiero wtedy znika z drzewa. Tło przestaje łapać
  // kliknięcia od razu, więc nie trzeba czekać na koniec animacji.
  const [closing, setClosing] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = reducedMotion() ? onClose : () => setClosing(true);
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => closeRef.current(), SHEET_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [closing]);
  useLayer(close);
  const ref = useDialogFocus();
  const overlayRef = useRef<HTMLDivElement>(null);
  useSheetDrag(ref, overlayRef, () => setClosing(true), onClose);
  return (
    <div ref={overlayRef} className={closing ? 'overlay is-closing' : 'overlay'} onClick={close}>
      <div ref={ref} tabIndex={-1} className={className ? `sheet ${className}` : 'sheet'} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  );
}

export const Spinner = () => <div className="spinner" role="progressbar" aria-label="Ładowanie" />;

/**
 * Część aplikacji ładowana na żądanie (lazy). Bez sieci import się nie uda – zamiast białego ekranu całej aplikacji
 * pokazujemy komunikat i „Spróbuj ponownie” (ponowny render zaczyna import od nowa).
 */
export function Lazy({ children }: { children: ReactNode }) {
  return (
    <LoadBoundary>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </LoadBoundary>
  );
}

/**
 * React.lazy, które po nieudanym imporcie (brak sieci) nie zapamiętuje błędu na zawsze: następny render
 * – po „Spróbuj ponownie” w <Lazy> – próbuje pobrać kod jeszcze raz.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): T {
  const make = (): LazyExoticComponent<T> =>
    lazy(() =>
      load().catch((e: unknown) => {
        current = make();
        throw e;
      }),
    );
  let current = make();
  const Retry = (props: object) => {
    const C = current as unknown as ComponentType<object>;
    return <C {...props} />;
  };
  return Retry as unknown as T;
}

class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="empty" role="alert">
          Nie udało się otworzyć – sprawdź internet.{' '}
          <button className="link" onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}>
            Spróbuj ponownie
          </button>
        </div>
      );
    return <div key={this.state.attempt} style={{ display: 'contents' }}>{this.props.children}</div>;
  }
}

/** Dane jeszcze nie przyszły: spinner, a gdy wczytanie się nie udało – powód i „Spróbuj ponownie” zamiast kręcenia bez końca. */
export function Pending({ error, reload }: { error?: Error; reload: () => unknown }) {
  if (!error) return <Spinner />;
  return (
    <div className="empty" role="alert">
      {error.message || 'Nie udało się wczytać.'}{' '}
      <button className="link" onClick={() => reload()}>
        Spróbuj ponownie
      </button>
    </div>
  );
}

// Minimalizm: pusty stan to jedno spokojne zdanie, bez ilustracji.
export function Empty({ children }: { icon?: string; children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Kółko ze zdjęciem profilowym; bez zdjęcia – pierwsza litera imienia. */
export function Avatar({ name, url, size }: { name?: string | null; url?: string | null; size?: 'sm' }) {
  return <div className={`avatar ${size ?? ''}`}>{url ? <img src={url} alt="" /> : (name ?? '?').slice(0, 1).toLowerCase()}</div>;
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min(100, Math.round((value / Math.max(max, 1)) * 100));
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {hint && <span className="muted small" style={{ display: 'block' }}>{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/**
 * Portfele pokazujemy tylko tam, gdzie zadziałają: Apple Pay w Safari na iPhonie i Macu,
 * Google Pay w Chrome (Android, komputer). Inaczej klientka wybrałaby metodę, której Checkout jej nie da.
 */
export function availableMethods(methods: string[]): string[] {
  const w = window as unknown as { ApplePaySession?: { canMakePayments(): boolean } };
  let apple = false;
  try {
    apple = !!w.ApplePaySession?.canMakePayments();
  } catch {}
  // Chrome na iPhonie przedstawia się jako CriOS i Google Pay tam nie działa – stąd sam „Chrome”.
  const google = !apple && 'PaymentRequest' in window && /Android|Chrome\//.test(navigator.userAgent);
  return methods.filter((m) => (m === 'apple_pay' ? apple : m === 'google_pay' ? google : true));
}

export const PAYMENT_LABELS: Record<string, string> = {
  blik: 'BLIK',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  p24: 'Przelewy24',
  card: 'Karta',
  cash: 'Gotówka',
  terminal: 'Terminal',
};

// ——— Klocki podstron (v2.11) ———

/** Podstrona na pełny ekran z przyciskiem „Wróć” – w aplikacji klientki i w panelu. */
/** Skąd otwarto stronę (prostokąt klikniętego elementu) – żeby mogła z niego „wyrosnąć” i do niego wrócić. */
let lastOrigin: DOMRect | null = null;
export const rememberOrigin = (el: Element) => (lastOrigin = el.getBoundingClientRect());
export const takeOrigin = () => {
  const r = lastOrigin;
  lastOrigin = null;
  return r;
};

export function Page({ title, onBack, children, actions, bodyClass, className, style, onAnimationEnd }: { title: ReactNode; onBack: () => void; children: ReactNode; actions?: ReactNode; bodyClass?: string; className?: string; style?: CSSProperties; onAnimationEnd?: (e: AnimationEvent<HTMLDivElement>) => void }) {
  useLayer(onBack);
  const ref = useDialogFocus();
  const titleId = useId();
  return (
    <div ref={ref} tabIndex={-1} className={`page ${className ?? ''}`} style={style} onAnimationEnd={onAnimationEnd} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="page-bar">
        <button className="icon-btn" style={{ width: 42, height: 42 }} onClick={onBack} aria-label="Wróć">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
            <path d="m15 6-6 6 6 6" />
          </svg>
        </button>
        <h2 id={titleId} style={{ margin: 0, flex: 1, fontSize: '1.15rem' }}>{title}</h2>
        {actions}
      </header>
      <div className={`page-body ${bodyClass ?? ''}`}>{children}</div>
    </div>
  );
}

/** Wiersz menu (Profil, ustawienia): tytuł, podpowiedź, znacznik, strzałka. */
export function ListRow({ title, hint, badge, onClick, icon }: { title: ReactNode; hint?: ReactNode; badge?: ReactNode; onClick: () => void; icon?: ReactNode }) {
  return (
    <button className="list-row" onClick={onClick}>
      {icon && <span className="list-row-icon">{icon}</span>}
      <span className="grow" style={{ textAlign: 'left' }}>
        <span className="card-title" style={{ display: 'block', fontSize: '1rem' }}>{title}</span>
        {hint && <span className="small muted">{hint}</span>}
      </span>
      {badge}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
        <path d="m9 6 6 6-6 6" />
      </svg>
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  const ref = useScrollRow<HTMLDivElement>();
  // Wybrana zakładka zawsze w widoku (np. „Zaproś znajomą” na końcu paska).
  useEffect(() => {
    const row = ref.current;
    const tab = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !tab) return;
    const left = tab.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + tab.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: left - 16, behavior: 'smooth' });
  }, [value, ref]);
  return (
    <div ref={ref} className="chips scroll-row" role="tablist" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} role="tab" className="chip" aria-pressed={value === v} aria-selected={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * Pasek pigułek przewijany w bok: palcem (natywnie), myszką przeciągając, kółkiem myszy.
 * Klik po przeciągnięciu nie wybiera pigułki. Krawędź z ukrytymi pigułkami miękko gaśnie (data-more).
 */
export function useScrollRow<E extends HTMLElement>() {
  const ref = useRef<E>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startLeft = 0;
    let dragging = false;
    let moved = false;
    const edges = () => {
      const more = el.scrollWidth - el.clientWidth > 2;
      const atStart = el.scrollLeft <= 2;
      const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 2;
      el.dataset.more = !more ? '' : atStart ? 'end' : atEnd ? 'start' : 'both';
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) {
        moved = true;
        el.classList.add('is-dragging');
      }
      if (moved) el.scrollLeft = startLeft - dx;
    };
    const up = () => {
      dragging = false;
      el.classList.remove('is-dragging');
    };
    const click = (e: MouseEvent) => {
      if (!moved) return;
      e.preventDefault();
      e.stopPropagation();
      moved = false;
    };
    // Kółko myszy przewija pasek w bok – ale tylko dopóki jest dokąd; potem przewija się strona.
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0 || (e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    edges();
    const ro = new ResizeObserver(edges);
    ro.observe(el);
    el.addEventListener('scroll', edges, { passive: true });
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('click', click, true);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', edges);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('click', click, true);
      el.removeEventListener('wheel', wheel);
    };
  }, []);
  return ref;
}

/** Lista rozwijana w stylu aplikacji (zamiast systemowego <select>). Jak systemowa – otwiera się nad treścią
 *  (warstwa w portalu, więc arkusz z przewijaniem jej nie ucina), a gdy brak miejsca pod polem – do góry. */
export type SelectOption = { value: string; label: string; group?: string };

export function Select({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0]; // jak systemowa: bez dopasowania widać pierwszą pozycję

  useLayoutEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const place = () => {
      const r = ref.current!.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const up = below < 220 && r.top > below;
      const maxHeight = Math.min(300, (up ? r.top : below + 12) - 18);
      // transformOrigin – w panelu lista rośnie od pola, które ją otworzyło (w dół albo w górę).
      setPos({ left: r.left, minWidth: r.width, maxWidth: window.innerWidth - r.left - 12, maxHeight, transformOrigin: up ? 'bottom' : 'top', ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    const onScroll = (e: Event) => !listRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.nativeEvent.stopPropagation(); // zamyka listę, nie cały arkusz
      setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      pick(options[active].value);
    }
  };

  return (
    <div className={`select ${className ?? ''}`} ref={ref} onKeyDown={onKey}>
      <button type="button" id={id} className="input select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{current?.label ?? 'Wybierz'}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
        <ul ref={listRef} className={SURFACE === 'panel' ? 'select-list from-trigger' : 'select-list'} role="listbox" aria-label={ariaLabel} style={pos}>
          {options.map((o, i) => [
            o.group && o.group !== options[i - 1]?.group && (
              <li key={`g:${o.group}`} role="presentation" className="select-group">
                {o.group}
              </li>
            ),
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? 'active' : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              {o.label}
              {o.value === value && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
                  <path d="m5 12 5 5 9-10" />
                </svg>
              )}
            </li>,
          ])}
        </ul>,
          document.body,
        )}
    </div>
  );
}

/** Skala 1–5 ze słowami (nastrój, energia, sen): słowo wybranego poziomu nad cienkim suwakiem ze stopniami – przeciąganie, stuknięcie albo strzałki. */
export function LevelPicker({ label, value, onChange, words }: { label: string; value: number; onChange: (v: number) => void; words: string[] }) {
  return (
    <div className="level">
      <div className="level-head">
        <span className="field-label">{label}</span>
        <span className="level-word" aria-live="polite">
          {words[value]}
        </span>
      </div>
      <div className="level-slider" style={{ '--p': `${(value - 1) * 25}%` } as CSSProperties}>
        <div className="level-rail" aria-hidden>
          <span className="level-fill" />
          {[1, 2, 3, 4, 5].map((n) => (
            <i key={n} className={n <= value ? 'is-on' : undefined} style={{ left: `${(n - 1) * 25}%` }} />
          ))}
        </div>
        <input type="range" min={1} max={5} step={1} value={value} aria-label={label} aria-valuetext={words[value]} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
      <div className="level-ends tiny muted" aria-hidden>
        <span>{words[1]}</span>
        <span>{words[5]}</span>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="tiny muted">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="eyebrow">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

/** Akcja z obsługą błędu i komunikatem – żeby nie powtarzać try/catch w każdym przycisku. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string | undefined)): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        const msg = typeof ok === 'function' ? ok(r) : (ok ?? (r as { message?: string } | undefined)?.message);
        if (msg) toast(msg);
        return r;
      } catch (e) {
        toast((e as Error).message, 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

/** Kod QR jako SVG (wejściówka, check-in, zaproszenie na wydarzenie). */
export function QrCode({ text, size = 200, label }: { text: string; size?: number; label: string }) {
  const [cells, setCells] = useState<boolean[][] | null>(null);
  useEffect(() => {
    let alive = true;
    import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      if (alive) setCells(Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c))));
    });
    return () => {
      alive = false;
    };
  }, [text]);
  if (!cells) return <div style={{ width: size, height: size }} className="qr" />;
  const n = cells.length + 8;
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      {/* Jedna ścieżka zamiast setek prostokątów – lżej się rysuje, także w trakcie animacji. */}
      <path d={cells.map((row, r) => row.map((d, c) => (d ? `M${c + 4} ${r + 4}h1v1h-1z` : '')).join('')).join('')} fill="#1b1715" />
    </svg>
  );
}

/**
 * Kod wejścia na żywo: QR liczony w telefonie co 30 s z dziennego sekretu (działa też offline), pod nim kreska
 * odliczająca do zmiany i zegar z sekundami. Przeglądarka nie pozwala zablokować zrzutu ekranu – zrzut za to szybko
 * wygasa, a recepcja od razu widzi, czy ekran żyje (ważne przy kodzie z liter, który zostaje dzienny).
 */
export function LiveCheckinQr({ checkin, size, label }: { checkin: LiveCheckin; size: number; label: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    // Tykamy równo z pełną sekundą – zegar nie odstaje od zegarka na ręce, a kod zmienia się dokładnie na granicy okna.
    let t = 0;
    const tick = () => {
      setNow(Date.now());
      t = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    t = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => clearTimeout(t);
  }, []);
  const step = checkinStep(now);
  const { user, date, seed } = checkin;
  const code = useMemo(() => liveCheckinCode({ user, date, seed }, step), [user, date, seed, step]);
  return (
    <div className="live-qr" title="Kod zmienia się co 30 sekund">
      <QrCode text={code} size={size} label={label} />
      {/* key={step}: nowa kreska w każdym oknie, więc powrót do pełnej długości nie animuje się wstecz. */}
      <span className="live-qr-bar" aria-hidden="true">
        <i key={step} style={{ transform: `scaleX(${1 - (now % CHECKIN_STEP_MS) / CHECKIN_STEP_MS})` }} />
      </span>
      <span className="live-qr-clock" aria-hidden="true">
        <i />
        {new Date(now).toLocaleTimeString('pl-PL')}
      </span>
    </div>
  );
}

export const STARS = (n: number) => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));

/** Plik z dysku → data URL (zdjęcia, wideo, PDF). */
export function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Nie udało się odczytać pliku.'));
    r.readAsDataURL(file);
  });
}

/** Obraz / wideo z prywatnych plików studia (z autoryzacją). */
export function AuthImg({ src, ...rest }: { src: string } & React.ImgHTMLAttributes<HTMLImageElement>) {
  const url = useAuthedUrl(src);
  return url ? <img src={url} {...rest} /> : <div style={{ ...(rest.style ?? {}), background: 'var(--soft)' }} className={rest.className} />;
}

export function AuthVideo({ src, videoRef, children, ...rest }: { src: string; videoRef?: React.Ref<HTMLVideoElement>; children?: ReactNode } & React.VideoHTMLAttributes<HTMLVideoElement>) {
  const url = useAuthedUrl(src);
  return url ? (
    <video ref={videoRef} src={url} {...rest}>
      {children}
    </video>
  ) : (
    <Spinner />
  );
}

/**
 * Znak studia w tle (Look.watermark): delikatny, za całą treścią, bez klikania. Kolor z motywu (maska + --ink),
 * więc działa i w trybie ciemnym. Rodzic potrzebuje `isolation: isolate` (klasa .with-watermark), żeby znak był pod treścią.
 */
export function Watermark({ src }: { src: string | null | undefined }) {
  if (!src) return null;
  return <div className="watermark" aria-hidden="true" style={{ '--watermark': `url("${src}")` } as CSSProperties} />;
}
