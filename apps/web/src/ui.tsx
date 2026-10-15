import { useAuthedUrl } from './api.ts';
import { useLayer } from './back.ts';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Toast = { text: string; kind: 'ok' | 'error' } | null;
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ text, kind });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

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

export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useLayer(onClose);
  const ref = useDialogFocus();
  return (
    <div className="overlay" onClick={onClose}>
      <div ref={ref} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  );
}

export const Spinner = () => <div className="spinner" role="progressbar" aria-label="Ładowanie" />;

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
export function Page({ title, onBack, children, actions }: { title: ReactNode; onBack: () => void; children: ReactNode; actions?: ReactNode }) {
  useLayer(onBack);
  const ref = useDialogFocus();
  const titleId = useId();
  return (
    <div ref={ref} tabIndex={-1} className="page" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="page-bar">
        <button className="icon-btn" style={{ width: 42, height: 42 }} onClick={onBack} aria-label="Wróć">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
            <path d="m15 6-6 6 6 6" />
          </svg>
        </button>
        <h2 id={titleId} style={{ margin: 0, flex: 1, fontSize: '1.15rem' }}>{title}</h2>
        {actions}
      </header>
      <div className="page-body">{children}</div>
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
  return (
    <div className="chips" role="tablist" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} role="tab" className="chip" aria-pressed={value === v} aria-selected={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
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
      {cells.flatMap((row, r) => row.map((d, c) => (d ? <rect key={`${r}-${c}`} x={c + 4} y={r + 4} width={1} height={1} fill="#1b1715" /> : null)))}
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
