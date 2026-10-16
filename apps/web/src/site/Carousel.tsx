// Karuzela strony studia: poziomy pasek kart z przewijaniem natywnym (palec, gładzik, klawiatura) i przyciągnięciem
// do karty, a pod nim cienka linia postępu i strzałki ← →. Bez biblioteki: przewija przeglądarka, my tylko sterujemy.
// Gdy wszystkie karty mieszczą się na ekranie, linia i strzałki znikają.
import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';

type Props = {
  /** nazwa dla czytnika ekranu, np. „Zajęcia” */
  label: string;
  children: ReactNode;
  /** dodatkowa klasa paska (np. site-people dla zaznaczania trenerki) */
  className?: string;
  /** atrybuty paska, np. role="tablist" w trenerkach */
  trackProps?: HTMLAttributes<HTMLDivElement>;
};

export function Carousel({ label, children, className, trackProps }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ overflow: false, atStart: true, atEnd: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const p = max > 0 ? el.scrollLeft / max : 0;
    el.parentElement?.style.setProperty('--car-p', p.toFixed(4));
    // Szerokość widocznej części jako ułamek całości = długość „suwaka” na linii postępu.
    el.parentElement?.style.setProperty('--car-view', (el.clientWidth / Math.max(1, el.scrollWidth)).toFixed(4));
    const next = { overflow: max > 4, atStart: el.scrollLeft <= 4, atEnd: el.scrollLeft >= max - 4 };
    setState((s) => (s.overflow === next.overflow && s.atStart === next.atStart && s.atEnd === next.atEnd ? s : next));
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), measure()));
    };
    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    // Zdjęcia doładowują się później i zmieniają szerokość – mierzymy ponownie.
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [measure]);

  /** Strzałka przewija o tyle pełnych kart, ile widać na ekranie (co najmniej jedną). */
  const step = (dir: 1 | -1) => {
    const el = track.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const cardW = card.offsetWidth + gap;
    const perView = Math.max(1, Math.floor((el.clientWidth + gap) / cardW));
    el.scrollBy({ left: dir * perView * cardW, behavior: 'smooth' });
  };

  return (
    <div className="site-carousel">
      <div ref={track} className={`site-car-track${className ? ` ${className}` : ''}`} tabIndex={0} role="region" aria-roledescription="karuzela" aria-label={label} {...trackProps}>
        {children}
      </div>
      {state.overflow && (
        <div className="site-car-bar">
          <div className="site-car-line" aria-hidden="true">
            <span />
          </div>
          <button type="button" className="site-car-btn" onClick={() => step(-1)} disabled={state.atStart} aria-label="Poprzednie">
            ←
          </button>
          <button type="button" className="site-car-btn" onClick={() => step(1)} disabled={state.atEnd} aria-label="Następne">
            →
          </button>
        </div>
      )}
    </div>
  );
}
