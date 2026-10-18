// Kwadrat oddechu („Skup się”): po cienkim kwadracie wędruje jedna kropka, każdy bok to jedna faza rytmu pudełkowego.
// Za kropką zostaje ślad bieżącego boku, w środku stoi słowo fazy. Bez cyfr – upływ fazy widać po drodze kropki.
// Pozycję liczy squarePoint (@glam/core) co klatkę z tego samego zegara co sesja; React odświeża tylko słowo.
import { useEffect, useRef } from 'react';
import { squarePoint, type BreathPattern } from '@glam/core';

// viewBox 200×200: kwadrat od LO do HI, z zapasem na kropkę i jej poświatę.
const LO = 24;
const SIZE = 152;
const at = (u: number) => LO + u * SIZE;

export function BreathSquare({ pattern, index, progress, children }: { pattern: BreathPattern; index: () => number; progress: () => number; children: React.ReactNode }) {
  const dot = useRef<SVGGElement>(null);
  const trail = useRef<SVGLineElement>(null);
  const read = useRef({ index, progress });
  read.current = { index, progress };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = squarePoint(pattern, read.current.index(), read.current.progress());
      const x = at(p.x).toFixed(2);
      const y = at(p.y).toFixed(2);
      dot.current?.setAttribute('transform', `translate(${x} ${y})`);
      trail.current?.setAttribute('x1', at(p.fromX).toFixed(2));
      trail.current?.setAttribute('y1', at(p.fromY).toFixed(2));
      trail.current?.setAttribute('x2', x);
      trail.current?.setAttribute('y2', y);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pattern]);

  const square = pattern.phases.length === 4;
  return (
    <div className="breath-square">
      <svg viewBox="0 0 200 200" aria-hidden>
        {square ? <rect className="sq-path" x={LO} y={LO} width={SIZE} height={SIZE} rx="3" /> : <line className="sq-path" x1="100" y1={LO} x2="100" y2={LO + SIZE} />}
        <line ref={trail} className="sq-trail" />
        <g ref={dot}>
          <circle className="sq-glow" r="9" />
          <circle className="sq-dot" r="3.4" />
        </g>
      </svg>
      <div className="breath-square-word">{children}</div>
    </div>
  );
}
