// Ruch na stronie studia (docs/strona-studia-spec.md, rozdz. 2–3). Bez biblioteki: IntersectionObserver + CSS,
// bo strona otwiera się głównie na telefonie z linku na Instagramie i ma być lekka.
// Zasada: stan „przed wejściem” (ukryty) dostaje tylko element, który na pewno zostanie odsłonięty.
// Bez ruchu (ograniczenie ruchu w systemie, podgląd w edytorze, brak IntersectionObserver) wszystko widać od razu.
import { useEffect, useRef, useState, type RefObject } from 'react';

/** Te same krzywe co w specyfikacji – dla stylów w JS (w CSS: --ease-out, --ease-in-out w site.css). */
export const ease = {
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
} as const;

/** Czasy w sekundach. */
export const dur = { fast: 0.3, base: 0.6, slow: 1.0, hero: 1.2 } as const;

/** Odstępy między elementami w grupie (sekundy). */
export const stagger = { word: 0.06, letter: 0.05, item: 0.08 } as const;

const params = new URLSearchParams(location.search);
// Edytor pokazuje stronę w ramce i zaznacza sekcje kliknięciem – tam treść ma być widoczna od razu.
const inEditor = params.has('podglad') && params.has('edytor') && window.self !== window.top;

/** Czy animujemy. Liczone raz przy starcie strony. */
export const MOTION = !inEditor && typeof IntersectionObserver !== 'undefined' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * true, gdy element wszedł w ekran (raz – potem już zostaje). Bez ruchu od razu true.
 * `amount` = jaka część elementu musi być widoczna.
 */
export function useInView<T extends Element>(amount = 0.3): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(!MOTION);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      // Dolny margines: element odsłania się chwilę po wejściu, nie na samej krawędzi ekranu.
      { threshold: amount, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [amount, inView]);
  return [ref, inView];
}

/**
 * Postęp przewinięcia elementu jako zmienna CSS (0 = góra elementu przy górze ekranu, 1 = element cały przewinięty).
 * Pisze prosto do stylu elementu w requestAnimationFrame – bez przerysowywania Reacta przy każdym ruchu.
 */
export function useScrollVar<T extends HTMLElement>(ref: RefObject<T | null>, name: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !MOTION) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
      el.style.setProperty(name, p.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ref, name]);
}
