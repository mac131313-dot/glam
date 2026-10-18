// Pola zdjęć i filmów w edytorze strony: pojedynczy plik, galeria i zdjęcia zajęć / trenerek.
// Zdjęcia są zmniejszane w przeglądarce (dłuższy bok 2000 px, JPEG) – szybciej się wgrywają i mieszczą w limicie 3 MB.
// Filmy idą bez zmian (MP4, MOV, WebM, do 40 MB); na stronie grają w pętli, bez dźwięku – jak ruchome zdjęcie.
import { createContext, useContext, useRef, useState, type DragEvent } from 'react';
import { siteImageUrl } from '@glam/core';
import { api } from '../../api.ts';
import { readFile, useToast } from '../../ui.tsx';
import { Glyph } from './shell.tsx';

const MAX_EDGE = 2000;
const VIDEO_MAX_MB = 40;
const ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp';
const ACCEPT_ALL = `${ACCEPT_IMAGES},video/mp4,video/quicktime,video/webm`;

/** Które pliki dokumentu są filmami (SiteDoc.media) – miniatura filmu to <video>, nie <img>. */
export const MediaKinds = createContext<{ isVideo: (id: string) => boolean; markVideo: (id: string) => void }>({ isVideo: () => false, markVideo: () => {} });

async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.86);
}

/** Długość filmu z metadanych (do statystyk biblioteki); brak po 3 s = bez długości. */
function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const t = setTimeout(() => done(null), 3000);
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      clearTimeout(t);
      done(Number.isFinite(v.duration) ? Math.round(v.duration) : null);
    };
    v.onerror = () => {
      clearTimeout(t);
      done(null);
    };
    v.src = url;
  });
}

export type Uploaded = { id: string; type: 'image' | 'video' };

export async function uploadSiteMedia(file: File, allowVideo: boolean): Promise<Uploaded> {
  const isVideo = /^video\/(mp4|quicktime|webm)$/.test(file.type);
  if (isVideo && !allowVideo) throw new Error('Tu pasuje tylko zdjęcie.');
  if (!isVideo && !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(allowVideo ? 'Wybierz zdjęcie (JPG, PNG, WebP) albo film (MP4, MOV, WebM).' : 'Wybierz zdjęcie JPG, PNG albo WebP.');
  if (isVideo && file.size > VIDEO_MAX_MB * 1_000_000) throw new Error(`Film jest za duży – maksymalnie ${VIDEO_MAX_MB} MB. Skróć go albo zapisz w niższej jakości.`);
  const body = isVideo ? { dataUrl: await readFile(file), durationSec: await videoDuration(file) } : { dataUrl: await downscale(file) };
  const res = await api<Uploaded>('/site/media', { method: 'POST', body });
  return { id: res.id, type: res.type };
}

function useUpload(allowVideo: boolean) {
  const toast = useToast();
  const { markVideo } = useContext(MediaKinds);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (files: File[], onDone: (ids: string[]) => void) => {
    if (files.length === 0) return;
    setBusy(files.some((f) => f.type.startsWith('video/')) ? 'Wgrywam film…' : 'Wgrywam…');
    try {
      const ids: string[] = [];
      for (const f of files) {
        const up = await uploadSiteMedia(f, allowVideo);
        if (up.type === 'video') markVideo(up.id);
        ids.push(up.id);
      }
      onDone(ids);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** Miniatura w edytorze: film jako pierwsza klatka (bez autoodtwarzania), zdjęcie jako <img>. */
function Thumb({ id, url, faded }: { id: string | null; url: string; faded?: boolean }) {
  const { isVideo } = useContext(MediaKinds);
  if (id && isVideo(id))
    return (
      <>
        <video src={`${url}#t=0.1`} muted playsInline preload="metadata" />
        <span className="se-film-znak" aria-label="Film">
          <Glyph name="play" />
        </span>
      </>
    );
  return <img src={url} alt="" data-zastepcze={faded ? '' : undefined} />;
}

/** Jeden plik: podgląd, „Wgraj / Zmień”, „Usuń”. Fallback = zdjęcie z panelu (np. zajęć), pokazywane wyblakłe. */
export function ImageField({
  value,
  onChange,
  fallbackUrl,
  compact,
  label,
  allowVideo = true,
}: {
  value: string;
  onChange: (id: string) => void;
  fallbackUrl?: string | null;
  compact?: boolean;
  label?: string;
  allowVideo?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useUpload(allowVideo);
  const url = value ? siteImageUrl(value) : fallbackUrl ?? null;
  const pick = () => input.current?.click();
  const what = allowVideo ? 'zdjęcie lub film' : 'zdjęcie';
  return (
    <div className={`se-zdjecie${compact ? ' compact' : ''}`}>
      <button type="button" className="se-zdjecie-kadr" onClick={pick} disabled={!!busy} aria-label={`${value ? 'Zmień' : 'Wgraj'} ${what}${label ? `: ${label}` : ''}`}>
        {url ? <Thumb id={value || null} url={url} faded={!value} /> : <Glyph name="image" />}
        {busy && <span className="se-zdjecie-stan">{busy}</span>}
      </button>
      <div className="se-zdjecie-akcje">
        {label && <span className="se-zdjecie-nazwa">{label}</span>}
        <span className="row gap-2">
          <button type="button" className="se-przycisk maly" onClick={pick} disabled={!!busy}>
            {value ? 'Zmień' : 'Wgraj'}
          </button>
          {value && (
            <button type="button" className="se-ikona" onClick={() => onChange('')} aria-label={`Usuń ${what}`} title="Usuń">
              <Glyph name="trash" />
            </button>
          )}
        </span>
        {!value && fallbackUrl && <span className="se-pole-podpowiedz">Zdjęcie z panelu</span>}
        {!compact && allowVideo && !value && <span className="se-pole-podpowiedz">Zdjęcie albo film do {VIDEO_MAX_MB} MB.</span>}
      </div>
      <input ref={input} type="file" accept={allowVideo ? ACCEPT_ALL : ACCEPT_IMAGES} hidden onChange={(e) => run([...(e.target.files ?? [])].slice(0, 1), ([id]) => onChange(id))} />
    </div>
  );
}

/** Galeria: siatka miniatur, dodawanie wielu plików (zdjęcia i filmy), usuwanie, przeciąganie kolejności. */
export function ImagesField({ value, max, onChange }: { value: string[]; max: number; onChange: (ids: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useUpload(true);
  const from = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const left = max - value.length;
  const drop = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    if (from.current === null || from.current === i) return setOver(null);
    const next = [...value];
    const [item] = next.splice(from.current, 1);
    next.splice(i, 0, item);
    from.current = null;
    setOver(null);
    onChange(next);
  };
  return (
    <div className="se-galeria">
      {value.map((id, i) => (
        <div
          key={id}
          className="se-galeria-el"
          data-cel={over === i ? '' : undefined}
          draggable
          onDragStart={() => (from.current = i)}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(i);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={drop(i)}
        >
          <Thumb id={id} url={siteImageUrl(id)} />
          <button type="button" className="se-galeria-usun" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Usuń plik ${i + 1}`}>
            <Glyph name="close" />
          </button>
        </div>
      ))}
      {left > 0 && (
        <button type="button" className="se-galeria-dodaj" onClick={() => input.current?.click()} disabled={!!busy}>
          {busy ?? (
            <>
              <Glyph name="plus" />
              Dodaj
            </>
          )}
        </button>
      )}
      <input ref={input} type="file" accept={ACCEPT_ALL} multiple hidden onChange={(e) => run([...(e.target.files ?? [])].slice(0, left), (ids) => onChange([...value, ...ids]))} />
    </div>
  );
}

/** Zdjęcia (lub filmy) zajęć albo trenerek tylko na stronie – bez własnego obowiązuje zdjęcie z panelu. */
export function PhotoList({ items, photos, onChange }: { items: { id: string; name: string; photoUrl: string | null }[]; photos: Record<string, string>; onChange: (id: string, mediaId: string) => void }) {
  if (items.length === 0) return <p className="se-tekst">Brak pozycji.</p>;
  return (
    <div className="se-lista-zdjec">
      {items.map((it) => (
        <ImageField key={it.id} compact label={it.name} value={photos[it.id] ?? ''} fallbackUrl={it.photoUrl} onChange={(m) => onChange(it.id, m)} />
      ))}
    </div>
  );
}
