// Pola zdjęć w edytorze strony: pojedyncze zdjęcie, galeria i zdjęcia zajęć / trenerek.
// Zdjęcia są zmniejszane w przeglądarce (dłuższy bok 2000 px, JPEG) – szybciej się wgrywają i mieszczą w limicie 3 MB.
import { useRef, useState, type DragEvent } from 'react';
import { siteImageUrl } from '@glam/core';
import { api } from '../../api.ts';
import { useToast } from '../../ui.tsx';
import { Glyph } from './shell.tsx';

const MAX_EDGE = 2000;

async function downscale(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Wybierz zdjęcie JPG, PNG albo WebP.');
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.86);
}

export async function uploadSiteImage(file: File): Promise<string> {
  const dataUrl = await downscale(file);
  const res = await api<{ id: string }>('/site/images', { method: 'POST', body: { dataUrl } });
  return res.id;
}

function useUpload() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (files: File[], onDone: (ids: string[]) => void) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const f of files) ids.push(await uploadSiteImage(f));
      onDone(ids);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Jedno zdjęcie: podgląd, „Wgraj / Zmień”, „Usuń”. Fallback = zdjęcie z panelu (np. zajęć), pokazywane wyblakłe. */
export function ImageField({ value, onChange, fallbackUrl, compact, label }: { value: string; onChange: (id: string) => void; fallbackUrl?: string | null; compact?: boolean; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useUpload();
  const url = value ? siteImageUrl(value) : fallbackUrl ?? null;
  const pick = () => input.current?.click();
  return (
    <div className={`se-zdjecie${compact ? ' compact' : ''}`}>
      <button type="button" className="se-zdjecie-kadr" onClick={pick} disabled={busy} aria-label={value ? `Zmień zdjęcie${label ? `: ${label}` : ''}` : `Wgraj zdjęcie${label ? `: ${label}` : ''}`}>
        {url ? <img src={url} alt="" data-zastepcze={value ? undefined : ''} /> : <Glyph name="image" />}
        {busy && <span className="se-zdjecie-stan">Wgrywam…</span>}
      </button>
      <div className="se-zdjecie-akcje">
        {label && <span className="se-zdjecie-nazwa">{label}</span>}
        <span className="row" style={{ gap: 6 }}>
          <button type="button" className="se-przycisk maly" onClick={pick} disabled={busy}>
            {value ? 'Zmień' : 'Wgraj'}
          </button>
          {value && (
            <button type="button" className="se-ikona" onClick={() => onChange('')} aria-label="Usuń zdjęcie" title="Usuń zdjęcie">
              <Glyph name="trash" />
            </button>
          )}
        </span>
        {!value && fallbackUrl && <span className="se-pole-podpowiedz">Zdjęcie z panelu</span>}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => run([...(e.target.files ?? [])].slice(0, 1), ([id]) => onChange(id))} />
    </div>
  );
}

/** Galeria: siatka miniatur, dodawanie wielu plików, usuwanie, przeciąganie kolejności. */
export function ImagesField({ value, max, onChange }: { value: string[]; max: number; onChange: (ids: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useUpload();
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
          <img src={siteImageUrl(id)} alt="" />
          <button type="button" className="se-galeria-usun" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Usuń zdjęcie ${i + 1}`}>
            <Glyph name="close" />
          </button>
        </div>
      ))}
      {left > 0 && (
        <button type="button" className="se-galeria-dodaj" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Wgrywam…' : (
            <>
              <Glyph name="plus" />
              Dodaj
            </>
          )}
        </button>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => run([...(e.target.files ?? [])].slice(0, left), (ids) => onChange([...value, ...ids])) } />
    </div>
  );
}

/** Zdjęcia zajęć albo trenerek tylko na stronie – bez zdjęcia własnego obowiązuje zdjęcie z panelu. */
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
