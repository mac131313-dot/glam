// Powłoka edytora strony (układ w stylu Shopify): nie wie, którą stronę się edytuje.
// Dostarcza trzy hooki (historia, most podglądu, autozapis) i widok z trzema kolumnami:
// drzewko · podgląd w <iframe> · panel ustawień. Konkretny edytor (SiteEditor) podaje treść kolumn.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CHANNEL, isEnvelope, type FromSite, type ToSite } from '../../site/protocol.ts';
import './editor.css';

// ——— Historia: cofnij / ponów ———

const GROUP_MS = 900;
const MAX_STEPS = 80;

type HistoryState<T> = { list: T[]; i: number; group: string | null; at: number };

/**
 * Lista stanów i wskaźnik w jednym useState – dwie zmiany w jednym ticku widzą poprawnego poprzednika.
 * Zmiany tej samej grupy w odstępie < 900 ms sklejają się w jeden krok (pisanie słowa = jedno cofnięcie).
 */
export function useHistory<T>(initial: T) {
  const [h, setH] = useState<HistoryState<T>>({ list: [initial], i: 0, group: null, at: 0 });

  const change = useCallback((fn: (prev: T) => T, group?: string) => {
    setH((s) => {
      const prev = s.list[s.i];
      const next = fn(prev);
      if (next === prev) return s;
      const now = Date.now();
      const merge = !!group && group === s.group && now - s.at < GROUP_MS && s.i > 0;
      const base = s.list.slice(0, merge ? s.i : s.i + 1);
      const list = [...base, next].slice(-MAX_STEPS);
      return { list, i: list.length - 1, group: group ?? null, at: now };
    });
  }, []);
  const undo = useCallback(() => setH((s) => (s.i > 0 ? { ...s, i: s.i - 1, group: null } : s)), []);
  const redo = useCallback(() => setH((s) => (s.i < s.list.length - 1 ? { ...s, i: s.i + 1, group: null } : s)), []);
  /** Nowy stan bez historii (wczytanie z serwera, odrzucenie szkicu). */
  const reset = useCallback((value: T) => setH({ list: [value], i: 0, group: null, at: 0 }), []);

  return { state: h.list[h.i], change, undo, redo, reset, canUndo: h.i > 0, canRedo: h.i < h.list.length - 1 };
}

// ——— Most do podglądu w ramce ———

/**
 * Rozmowa z ramką przez postMessage z jawnym originem (nigdy '*'). Odbieramy tylko wiadomości
 * z naszej ramki, z naszego originu i z właściwego kanału.
 */
export function usePreviewBridge({ src, onMessage }: { src: string; onMessage: (m: FromSite) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const origin = new URL(src, location.href).origin;

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow || !isEnvelope(e.data)) return;
      const m = e.data as unknown as FromSite;
      if (m.rodzaj === 'gotowy') setReady(true);
      handler.current(m);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [origin]);

  const send = useCallback(
    (m: ToSite) => {
      frame.current?.contentWindow?.postMessage({ ...m, kanal: CHANNEL }, origin);
    },
    [origin],
  );

  /** Most działa → ramka pobiera dane sama (bez utraty scrolla); jeszcze nie wstała → nowa ramka. */
  const refresh = useCallback(() => {
    if (ready) send({ rodzaj: 'odswiez' });
    else {
      setReady(false);
      setVersion((v) => v + 1);
    }
  }, [ready, send]);

  return { frame, ready, version, send, refresh };
}

// ——— Autozapis ———

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';
const DEBOUNCE_MS = 1100;

/**
 * „Brudny” nie jest flagą – liczymy go z różnicy JSON-ów (dokument vs wersja, o której wiadomo, że jest w bazie).
 * Zapis 1100 ms po ostatniej zmianie; gdy zapis trwa, następny czeka w kolejce – dwa zapisy nigdy nie lecą naraz.
 */
export function useAutosave<T>({ doc, initial, save }: { doc: T; initial: T; save: (doc: T, auto: boolean) => Promise<T> }) {
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<{ auto: boolean } | null>(null);
  const latest = useRef(doc);
  latest.current = doc;
  const saveRef = useRef(save);
  saveRef.current = save;

  const json = JSON.stringify(doc);
  const dirty = json !== savedJson;

  const run = useCallback(async (auto: boolean): Promise<boolean> => {
    if (inFlight.current) {
      queued.current = { auto: auto && (queued.current?.auto ?? true) };
      return true;
    }
    inFlight.current = true;
    setSaving(true);
    let ok = true;
    try {
      const sent = latest.current;
      const stored = await saveRef.current(sent, auto);
      // Serwer zwraca dokument po parserze – to on jest teraz „w bazie” (o ile w międzyczasie nic się nie zmieniło).
      setSavedJson(JSON.stringify(sent) === JSON.stringify(latest.current) ? JSON.stringify(stored) : JSON.stringify(sent));
      setSavedAt(new Date());
      setError(false);
    } catch {
      setError(true);
      ok = false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
    const q = queued.current;
    queued.current = null;
    if (q) return run(q.auto);
    return ok;
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void run(true), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [json, dirty, run]);

  /** Po wczytaniu nowej wersji z serwera (publikacja, odrzucenie szkicu) – ona jest punktem odniesienia. */
  const markSaved = useCallback((value: T) => setSavedJson(JSON.stringify(value)), []);

  const status: SaveStatus = error ? 'error' : saving ? 'saving' : dirty ? 'dirty' : 'saved';
  return { status, dirty, savedAt, saveNow: () => run(false), markSaved };
}

export function statusText(status: SaveStatus, savedAt: Date | null) {
  if (status === 'saving') return 'Zapisuję…';
  if (status === 'dirty') return 'Niezapisane zmiany';
  if (status === 'error') return 'Błąd zapisu';
  return savedAt ? `Zapisano ${savedAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : 'Wszystko zapisane';
}

// ——— Widok ———

export type Device = 'desktop' | 'tablet' | 'phone';
const DEVICE_WIDTH: Record<Exclude<Device, 'desktop'>, number> = { tablet: 834, phone: 390 };

export function EditorShell(props: {
  title: string;
  pill?: { label: string; on: boolean };
  tabs: ReactNode;
  tree: ReactNode;
  panel: ReactNode | null;
  preview: { src: string; frame: React.RefObject<HTMLIFrameElement | null>; version: number };
  history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
  save: { status: SaveStatus; savedAt: Date | null; dirty: boolean; onSave: () => void };
  onPublish: () => void;
  publishLabel: string;
  publishDisabled?: boolean;
  backHref: string;
  extra?: ReactNode;
}) {
  const [device, setDevice] = useState<Device>('desktop');
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Tablet i telefon mają stałą szerokość – skalujemy je do kolumny, jeśli się nie mieszczą.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { undo, redo } = props.history;
  const onSave = props.save.onSave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        onSave();
        return;
      }
      // W polach tekstowych zostawiamy natywne cofanie liter.
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]')) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, onSave]);

  // Niezapisane zmiany przy zamykaniu karty.
  const dirty = props.save.dirty || props.save.status === 'saving';
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  const width = device === 'desktop' ? undefined : DEVICE_WIDTH[device];
  const scale = width && box.w ? Math.min(1, (box.w - 32) / width) : 1;
  const frameStyle = width ? { width, height: Math.max(200, (box.h - 32) / scale), transform: `scale(${scale})` } : undefined;
  return (
    <div className="se" data-panel={props.panel ? '' : undefined}>
      <header className="se-pasek">
        <a className="se-ikona" href={props.backHref} aria-label="Wróć do panelu" title="Wróć do panelu">
          <Glyph name="back" />
        </a>
        <div className="se-zakladki">{props.tabs}</div>
        <div className="se-tytul">
          <strong>{props.title}</strong>
          {props.pill && (
            <span className="se-pill" data-on={props.pill.on ? '' : undefined}>
              {props.pill.label}
            </span>
          )}
        </div>
        <div className="se-urzadzenia" role="group" aria-label="Szerokość podglądu">
          {(
            [
              ['desktop', 'Komputer'],
              ['tablet', 'Tablet'],
              ['phone', 'Telefon'],
            ] as const
          ).map(([d, label]) => (
            <button key={d} className="se-ikona" aria-pressed={device === d} onClick={() => setDevice(d)} aria-label={label} title={label}>
              <Glyph name={d} />
            </button>
          ))}
        </div>
        <div className="se-akcje">
          <button className="se-ikona" onClick={undo} disabled={!props.history.canUndo} aria-label="Cofnij" title="Cofnij (⌘Z)">
            <Glyph name="undo" />
          </button>
          <button className="se-ikona" onClick={redo} disabled={!props.history.canRedo} aria-label="Ponów" title="Ponów (⇧⌘Z)">
            <Glyph name="redo" />
          </button>
          <span className="se-stan-zapisu" data-stan={props.save.status === 'dirty' ? 'brudny' : props.save.status === 'error' ? 'blad' : undefined} role="status">
            {statusText(props.save.status, props.save.savedAt)}
          </span>
          {props.extra}
          <button className="se-przycisk se-zapisz" data-brudny={props.save.dirty ? '' : undefined} onClick={onSave} disabled={!props.save.dirty && props.save.status !== 'error'}>
            Zapisz
          </button>
          <button className="se-przycisk se-publikuj" onClick={props.onPublish} disabled={props.publishDisabled}>
            {props.publishLabel}
          </button>
        </div>
      </header>
      <div className="se-cialo">
        <aside className="se-drzewo">{props.tree}</aside>
        <div className="se-scena" ref={stage} data-urzadzenie={device}>
          <div className="se-kadr" style={frameStyle}>
            <iframe key={props.preview.version} ref={props.preview.frame} className="se-ramka" src={props.preview.src} title="Podgląd strony" />
          </div>
        </div>
        {props.panel && <aside className="se-panel">{props.panel}</aside>}
      </div>
    </div>
  );
}

// ——— Klocki paneli ———

export function PanelHeader({ title, onClose, actions }: { title: string; onClose: () => void; actions?: ReactNode }) {
  return (
    <div className="se-panel-naglowek">
      <strong className="grow">{title}</strong>
      {actions}
      <button className="se-ikona" onClick={onClose} aria-label="Zamknij panel">
        <Glyph name="close" />
      </button>
    </div>
  );
}

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="se-grupa">
      <h3>{label}</h3>
      {children}
    </section>
  );
}

export function FieldRow({ label, hint, children, inline }: { label: string; hint?: string; children: ReactNode; inline?: boolean }) {
  return (
    <label className={`se-pole${inline ? ' inline' : ''}`}>
      <span className="se-pole-etykieta">{label}</span>
      {children}
      {hint && <span className="se-pole-podpowiedz">{hint}</span>}
    </label>
  );
}

/** Ikony edytora (linie 1.6 px, jak reszta panelu). */
export function Glyph({ name }: { name: 'back' | 'desktop' | 'tablet' | 'phone' | 'undo' | 'redo' | 'close' | 'eye' | 'eyeOff' | 'trash' | 'copy' | 'drag' | 'plus' | 'section' | 'top' | 'bottom' | 'text' | 'external' | 'image' }) {
  const d: Record<typeof name, ReactNode> = {
    back: <path d="M15 18l-6-6 6-6" />,
    desktop: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
    tablet: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M11 18h2" />
      </>
    ),
    phone: (
      <>
        <rect x="7" y="3" width="10" height="18" rx="2" />
        <path d="M11 18h2" />
      </>
    ),
    undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
    redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />,
    close: <path d="M6 6l12 12M18 6L6 18" />,
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: <path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.8 9.8 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2" />,
    trash: <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
      </>
    ),
    drag: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth="3" />,
    plus: <path d="M12 5v14M5 12h14" />,
    section: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M4 10h16" />
      </>
    ),
    top: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 9h16" />
      </>
    ),
    bottom: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 15h16" />
      </>
    ),
    text: <path d="M5 7h14M5 12h14M5 17h9" />,
    external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />,
    image: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="M21 16l-5-5-8 8" />
      </>
    ),
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d[name]}
    </svg>
  );
}
