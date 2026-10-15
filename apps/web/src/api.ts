import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  status: number;
  code: string;
  details: any;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Pamięć przeglądarki bywa niedostępna (tryb prywatny) – aplikacja działa i bez niej.
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {}
  },
};

/** Tryb demo: bez ekranu logowania – panel i aplikacja logują się same na konta demo. */
export const DEMO_MODE = true;

/** Panel studia i aplikacja mobilna działają pod jednym adresem, ale mają osobne sesje. */
export type Surface = 'panel' | 'app' | 'home';
export const SURFACE: Surface = location.pathname.startsWith('/panel') ? 'panel' : location.pathname.startsWith('/app') ? 'app' : 'home';
const key = (k: string) => `glam.${SURFACE}.${k}`;

export const session = {
  token: store.get(key('token')),
  studioId: store.get(key('studio')),
  persona: store.get(key('persona')),
  setToken(t: string | null) {
    // Wylogowanie albo inne konto: dane zapisane offline (grafik, karnety, pobrane lekcje) należą do poprzedniej sesji.
    if (t !== this.token) clearOfflineData();
    this.token = t;
    store.set(key('token'), t);
  },
  setStudio(id: string | null) {
    this.studioId = id;
    store.set(key('studio'), id);
  },
  setPersona(p: string | null) {
    this.persona = p;
    store.set(key('persona'), p);
  },
};

type Opts = { method?: string; body?: unknown; global?: boolean };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  if (!opts.global && session.studioId) headers['x-studio-id'] = session.studioId;
  const res = await fetch(`/api${path}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      session.setToken(null);
      window.dispatchEvent(new Event('glam:logout'));
    }
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Coś poszło nie tak.', data.details);
  }
  return data as T;
}

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(!!path);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

// Formaty dat w strefie studia (sekcja 10: polskie formaty dat i godzin). Godziny zajęć pokazujemy w czasie studia,
// także gdy klientka ma telefon ustawiony na inną strefę (wyjazd). Strefę ustawia aplikacja po wczytaniu studia.
let TZ = 'Europe/Warsaw';
export function setStudioTimezone(tz: string | null | undefined) {
  if (!tz || tz === TZ) return;
  try {
    new Intl.DateTimeFormat('pl-PL', { timeZone: tz });
    TZ = tz;
  } catch {
    /* nieznana strefa – zostaje domyślna */
  }
}
export const fmtTime = (iso: string) => new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const fmtDay = (iso: string) => new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(iso));
export const fmtLongDay = (iso: string) => new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
export const localDate = (d: Date = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(d);
/** Okres z regulaminu po ludzku: 120 → „2 h”, 90 → „1 h 30 min”, 45 → „45 min”. */
export const fmtMinutes = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);
/** Numer telefonu w grupach: +48500000212 → „+48 500 000 212”. */
export const fmtPhone = (phone: string) => phone.replace(/^(\+\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
export const addDaysStr =(date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
};

/**
 * Prywatne pliki studia (wideo lekcji i powitań, zdjęcia postępów i feedu) wymagają tokenu.
 * <img>/<video> nie wyślą nagłówka, więc pobieramy plik fetch-em i podajemy lokalny adres (bez tokenu w URL).
 */
const blobCache = new Map<string, Promise<string>>();

function clearOfflineData() {
  for (const url of blobCache.values()) url.then(URL.revokeObjectURL, () => {});
  blobCache.clear();
  if (typeof caches === 'undefined') return;
  caches
    .keys()
    .then((names) => Promise.all(names.filter((n) => n.startsWith('glam-')).map((n) => caches.delete(n))))
    .catch(() => {});
}
export function authedObjectUrl(src: string): Promise<string> {
  if (!src.startsWith('/api/media/')) return Promise.resolve(src);
  if (!blobCache.has(src)) {
    blobCache.set(
      src,
      (async () => {
        const offline = await caches?.open('glam-offline-media').then((c) => c.match(src)).catch(() => undefined);
        const res = offline ?? (await fetch(src, { headers: { authorization: `Bearer ${session.token}`, 'x-studio-id': session.studioId ?? '' } }));
        if (!res.ok) throw new Error('Nie udało się wczytać pliku.');
        return URL.createObjectURL(await res.blob());
      })(),
    );
  }
  return blobCache.get(src)!;
}

export function useAuthedUrl(src: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!src) return setUrl(null);
    authedObjectUrl(src).then((u) => alive && setUrl(u)).catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [src]);
  return url;
}
