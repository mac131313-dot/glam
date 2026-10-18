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
  // Bez sieci fetch rzuca TypeError („Failed to fetch”) – zamieniamy go na zwykły błąd z polskim komunikatem.
  const res = await fetch(`/api${path}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }).catch(() => {
    throw new ApiError(0, 'network', 'Brak internetu – sprawdź połączenie.');
  });
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
/** Części daty do plakietki w kalendarzowym stylu: { day: '17', month: 'paź', weekday: 'sob.' }. */
export const fmtDateParts = (iso: string) => {
  const parts = new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: get('day'), month: get('month').replace('.', ''), weekday: get('weekday') };
};
export const fmtLongDay =(iso: string) => new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
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

// ——— Wgrywanie dużych filmów (pełne treningi 0,5–2 GB) ———
// Kawałkami po ~8 MB: pasek postępu, ponawianie po zerwanym połączeniu, a po odświeżeniu strony
// ten sam plik wznawia się od miejsca, w którym przerwał (id wgrywania w localStorage).

export type UploadProgress = { sent: number; total: number };

const uploadKey = (f: File) => `glam.upload.${session.studioId}.${f.name}.${f.size}.${f.lastModified}`;

function putChunk(id: string, offset: number, chunk: Blob, onSent: (n: number) => void, signal?: AbortSignal) {
  return new Promise<{ offset: number; done: boolean; media?: { id: string } }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/creator/uploads/${id}`);
    if (session.token) xhr.setRequestHeader('authorization', `Bearer ${session.token}`);
    if (session.studioId) xhr.setRequestHeader('x-studio-id', session.studioId);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('upload-offset', String(offset));
    xhr.upload.onprogress = (e) => onSent(e.loaded);
    xhr.onload = () => {
      const data = (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return {};
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error ?? 'error', data.message ?? 'Nie udało się wgrać fragmentu filmu.', data.details));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Brak połączenia.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.onabort = () => reject(new DOMException('Przerwano', 'AbortError'));
    xhr.send(chunk);
  });
}

/** Wgrywa film lekcji i zwraca id pliku do POST /creator/courses/:id/lessons { videoId }. */
export async function uploadVideo(file: File, durationSec: number, onProgress: (p: UploadProgress) => void, signal?: AbortSignal): Promise<string> {
  const key = uploadKey(file);
  let up: { id: string; offset: number; chunkSize: number } | null = null;
  const saved = store.get(key);
  if (saved) up = await api(`/creator/uploads/${saved}`).catch(() => null);
  if (!up) {
    up = await api(`/creator/uploads`, { method: 'POST', body: { mime: file.type || 'video/mp4', size: file.size, durationSec } });
    store.set(key, up!.id);
  }
  const { id, chunkSize } = up!;
  let offset = up!.offset;
  let failures = 0;
  onProgress({ sent: offset, total: file.size });
  while (offset < file.size) {
    try {
      const r = await putChunk(id, offset, file.slice(offset, offset + chunkSize), (n) => onProgress({ sent: offset + n, total: file.size }), signal);
      offset = r.offset;
      failures = 0;
      if (r.done) break;
    } catch (e) {
      if (signal?.aborted) throw e;
      const err = e as ApiError;
      // 409: serwer ma inny stan (np. kawałek doszedł, ale odpowiedź nie) – wznawiamy od jego offsetu.
      if (err.status === 409 && typeof err.details?.offset === 'number') offset = err.details.offset;
      else if (err.status && err.status !== 409 && err.status < 500) {
        store.set(key, null);
        throw err;
      } else if (++failures > 6) throw new ApiError(0, 'network', 'Połączenie zrywa się – spróbuj ponownie, wgrywanie wznowi się od miejsca przerwania.');
      else await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** failures)));
      if (err.status !== 409) offset = (await api<{ offset: number }>(`/creator/uploads/${id}`).catch(() => ({ offset })))!.offset;
    }
    onProgress({ sent: offset, total: file.size });
  }
  store.set(key, null);
  return id;
}

/**
 * Studio ze Stripe: płatność kończy się na stronie Checkout (Apple Pay, Google Pay, BLIK…),
 * a po powrocie /app?checkout=… ClientApp sprawdza wynik. Zwraca true, gdy przekierowuje.
 */
export function goToCheckout(res: { checkoutUrl?: string } | null | undefined) {
  if (!res?.checkoutUrl) return false;
  location.assign(res.checkoutUrl);
  return true;
}

export const cancelVideoUpload = (file: File) => {
  const id = store.get(uploadKey(file));
  store.set(uploadKey(file), null);
  return id ? api(`/creator/uploads/${id}`, { method: 'DELETE' }).catch(() => {}) : Promise.resolve();
};
