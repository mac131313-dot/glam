// Czat klientka ↔ recepcja: wspólne pole wiadomości (tekst + załącznik) i podgląd załącznika w dymku.
// Używa go aplikacja klientki (Konto → Czat z recepcją) i panel (Wiadomości → Czat z klientkami).
import { useRef, useState } from 'react';
import { useAuthedUrl } from './api.ts';
import { Icon } from './icons.tsx';
import { AuthImg, AuthVideo, readFile, useAction } from './ui.tsx';

export type ChatAttachment = { url: string; name: string | null; type: 'image' | 'video' | 'pdf' };
export type ChatMessage = { id: string; body: string; from_staff: number; auto: number; created_at: string; author: string | null; attachment: ChatAttachment | null };
export type ChatSend = { body: string; attachment?: string; attachmentName?: string };

/** Te same limity co na serwerze (services/media.ts) – sprawdzamy od razu, zanim plik pójdzie w świat. */
const LIMITS = { image: 3, video: 40, pdf: 10 } as const;
const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,application/pdf';

const kindOf = (f: File): keyof typeof LIMITS | null => (f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type === 'application/pdf' ? 'pdf' : null);

/** Załącznik w dymku: zdjęcie i wideo od razu w rozmowie, PDF jako odnośnik do otwarcia. */
export function AttachmentView({ a }: { a: ChatAttachment }) {
  const url = useAuthedUrl(a.type === 'pdf' ? a.url : null);
  if (a.type === 'image') return <AuthImg src={a.url} alt={a.name ?? 'Zdjęcie'} className="chat-media" />;
  if (a.type === 'video') return <AuthVideo src={a.url} className="chat-media" controls playsInline preload="metadata" />;
  return (
    <a className="chat-file" href={url ?? undefined} target="_blank" rel="noopener" download={a.name ?? 'plik.pdf'} aria-disabled={!url}>
      <Icon name="clip" size={16} />
      <span>{a.name ?? 'Plik PDF'}</span>
    </a>
  );
}

/** Pole wiadomości: tekst, spinacz (zdjęcie, wideo, PDF), podgląd wybranego pliku, „Wyślij”. Enter wysyła. */
/** `variant="bar"` – pasek jak w komunikatorze: zaokrąglone pole i okrągły przycisk wysyłania (czat grupy). */
export function ChatComposer({ placeholder, onSend, variant }: { placeholder: string; onSend: (msg: ChatSend) => Promise<unknown>; variant?: 'bar' }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction();
  const ready = (text.trim() || file) && !busy;

  function pick(f: File | undefined) {
    if (input.current) input.current.value = '';
    if (!f) return;
    const kind = kindOf(f);
    if (!kind) return setError('Możesz dodać zdjęcie (JPG, PNG, WebP), wideo (MP4, MOV, WebM) albo PDF.');
    if (f.size > LIMITS[kind] * 1_000_000) return setError(`Plik jest za duży – ${kind === 'image' ? 'zdjęcie' : kind === 'video' ? 'wideo' : 'PDF'} do ${LIMITS[kind]} MB.`);
    setError(null);
    setFile(f);
  }

  const send = () =>
    ready &&
    run(async () => {
      await onSend({ body: text.trim(), ...(file ? { attachment: await readFile(file), attachmentName: file.name } : {}) });
      setText('');
      setFile(null);
    });

  return (
    <div className={`chat-composer stack ${variant ?? ''}`} style={{ gap: 6 }}>
      {file && (
        <div className="chat-pending">
          <Icon name="clip" size={16} />
          <span className="small">{file.name}</span>
          <button className="link tiny" onClick={() => setFile(null)} aria-label={`Usuń załącznik ${file.name}`}>
            usuń
          </button>
        </div>
      )}
      {error && (
        <p className="tiny" role="alert" style={{ margin: 0, color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <div className="row">
        <button className="btn ghost sm chat-attach" onClick={() => input.current?.click()} aria-label="Dodaj zdjęcie, wideo albo PDF" title="Dodaj zdjęcie, wideo albo PDF" disabled={busy}>
          <Icon name="clip" size={18} />
        </button>
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0])} />
        <input className="input" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        {variant === 'bar' ? (
          <button className="chat-send" disabled={!ready} onClick={send} aria-label={busy ? 'Wysyłam' : 'Wyślij'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        ) : (
          <button className="btn sm" disabled={!ready} onClick={send}>
            {busy && file ? 'Wysyłam…' : 'Wyślij'}
          </button>
        )}
      </div>
    </div>
  );
}
