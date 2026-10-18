import { useAuthedUrl } from './api.ts';
import { useLayer } from './back.ts';
import { Component, createContext, lazy, Suspense, useCallback, type ComponentType, type LazyExoticComponent, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
 */
export function Fold({ title, meta, defaultOpen = false, children }: { title: ReactNode; meta?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
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
        <div className="fold-inner">{children}</div>
      </div>
    </section>
  );
}

export function Sheet({ onClose, children, label, className }: { onClose: () => void; children: ReactNode; label: string; className?: string }) {
  useLayer(onClose);
  const ref = useDialogFocus();
  return (
    <div className="overlay" onClick={onClose}>
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

export function Avatar({ name, size }: { name?: string | null; size?: 'sm' }) {
  return <div className={`avatar ${size ?? ''}`}>{(name ?? '?').slice(0, 1).toLowerCase()}</div>;
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
      setPos({ left: r.left, minWidth: r.width, maxWidth: window.innerWidth - r.left - 12, maxHeight, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
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
        <ul ref={listRef} className="select-list" role="listbox" aria-label={ariaLabel} style={pos}>
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

/** Skala 1–5 ze słowami (nastrój, energia, sen): słowo wybranego poziomu nad ścieżką, kropki rosną z poziomem – bez łamanych etykiet w przyciskach. */
export function LevelPicker({ label, value, onChange, words }: { label: string; value: number; onChange: (v: number) => void; words: string[] }) {
  return (
    <div className="level">
      <div className="level-head">
        <span className="field-label">{label}</span>
        <span className="level-word" aria-live="polite">
          {words[value]}
        </span>
      </div>
      <div className="level-track" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={words[n]} className={n < value ? 'is-below' : undefined} onClick={() => onChange(n)}>
            <i style={{ width: 8 + n * 3, height: 8 + n * 3 }} />
          </button>
        ))}
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
