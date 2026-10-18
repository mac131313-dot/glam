// Karta zajęć ze zdjęciem w tle (zdjęcie typu zajęć wgrane przez studio). Nagłówek w lewym dolnym rogu,
// status w prawym górnym. Bez gradientów koloru: czytelność daje płaskie przyciemnienie całego zdjęcia,
// opcjonalnie z rozmyciem zanikającym ku górze (--photo-blur, ustawiane w Wyglądzie studia).
import type { CSSProperties, MouseEvent, ReactNode } from 'react';

/**
 * Karta przyjmuje proporcje zdjęcia, ale w granicach: od pionu 3:4 (typowe zdjęcie z telefonu) do 16:9.
 * Węższe/szersze zdjęcia są przycinane (object-fit: cover), żeby karta nie była wyższa od ekranu ani za niska na nazwę.
 */
const RATIO_MIN = 0.75;
const RATIO_MAX = 16 / 9;

export function ClassCover({
  photoUrl,
  photoRatio,
  eyebrow,
  title,
  meta,
  corner,
  aside,
  footer,
  onClick,
  dimmed,
  bleed,
  compact,
  backdrop,
}: {
  photoUrl: string | null;
  /** szerokość/wysokość wgranego zdjęcia (z serwera) – karta ma jego proporcje i właściwą wysokość, zanim zdjęcie się wczyta */
  photoRatio?: number | null;
  /** mała linia nad tytułem, np. „18:00 · 55 min” */
  eyebrow: ReactNode;
  title: string;
  meta?: ReactNode;
  /** prawy górny róg – status rezerwacji */
  corner?: ReactNode;
  /** prawy dolny róg, na wysokości nagłówka – np. zdjęcie prowadzącej */
  aside?: ReactNode;
  /** ostatnia linia pod meta – np. wolne miejsca */
  footer?: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** zajęcia minione lub odwołane */
  dimmed?: boolean;
  /** szerokość ekranu w „niewidzialnej ramce”, wysokość z proporcji zdjęcia (aplikacja klientki) */
  bleed?: boolean;
  /** mały kwadratowy kafelek do siatki w dwóch kolumnach (Grafik), bez względu na proporcje zdjęcia */
  compact?: boolean;
  /** podgląd w panelu bez wgranego zdjęcia: płaski kolor traktowany jak zdjęcie (biały tekst, przyciemnienie) */
  backdrop?: string;
}) {
  const className = `cover${photoUrl || backdrop ? ' has-photo' : ''}${dimmed ? ' dimmed' : ''}${bleed ? ' bleed' : ''}${compact ? ' compact' : ''}`;
  const style: CSSProperties = {};
  if (backdrop) style.background = backdrop;
  if (photoUrl && photoRatio && !compact) style.aspectRatio = String(Math.min(RATIO_MAX, Math.max(RATIO_MIN, photoRatio)));
  const body = (
    <>
      {photoUrl && <img className="cover-img" src={photoUrl} alt="" loading="lazy" decoding="async" draggable={false} />}
      {(photoUrl || backdrop) && (
        <div className="cover-blur" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      )}
      {corner && <div className="cover-corner">{corner}</div>}
      {aside && <div className="cover-aside">{aside}</div>}
      <div className={`cover-body${aside ? ' with-aside' : ''}`}>
        <div className="cover-eyebrow">{eyebrow}</div>
        <div className="cover-title">{title}</div>
        {meta && <div className="cover-meta">{meta}</div>}
        {footer && <div className="cover-meta cover-footer">{footer}</div>}
      </div>
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} style={style}>
      {body}
    </button>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  );
}
