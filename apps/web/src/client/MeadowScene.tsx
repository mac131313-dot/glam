// Scenka oddechu: skandynawska łąka z widokiem na góry i wodę. Same płaskie płaszczyzny (bez gradientów),
// kolory z tokenów --sc-* w styles.css (jasny dzień / jasna noc). Wysoka trawa kołysze się w rytm
// wiatru, którego siłę podaje `wind()` – przy wdechu lekko, przy wydechu mocniej (windAt w @glam/core).
import { useEffect, useMemo, useRef } from 'react';

type Row = 'back' | 'mid' | 'front';

type Blade = {
  row: Row;
  x: number;
  base: number;
  /** kształt w układzie lokalnym – podstawa w (0,0), czubek w górę */
  d: string;
  head?: { cx: number; cy: number };
  stiffness: number;
  /** własne tempo i przesunięcie fazy – źdźbła nie ruszają się jak jedno */
  rate: number;
  seed: number;
  fill: string;
};

const W = 300;
const H = 375;

/** Największe wygięcie (w stopniach) przy pełnym podmuchu – bliższa trawa rusza się wyraźniej. */
const MAX_BEND: Record<Row, number> = { back: 7, mid: 11, front: 15 };

const COUNTS = { full: { back: 64, mid: 40, front: 20 }, mini: { back: 22, mid: 12, front: 6 } };

/** Powtarzalny „los” – trawa wygląda tak samo przy każdym otwarciu. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bladePath = (w: number, h: number, curl: number) =>
  `M${-w} 0Q${(-w * 0.4 + curl * 0.4).toFixed(1)} ${(-h * 0.55).toFixed(1)} ${curl.toFixed(1)} ${(-h).toFixed(1)}` +
  `Q${(w * 0.4 + curl * 0.4).toFixed(1)} ${(-h * 0.55).toFixed(1)} ${w} 0Z`;

function makeBlades(detail: 'full' | 'mini'): Blade[] {
  const r = rng(7);
  const spec: Record<Row, { base: number; h: [number, number]; w: [number, number]; fills: string[] }> = {
    back: { base: 302, h: [18, 40], w: [0.9, 1.5], fills: ['var(--sc-grass-1)'] },
    mid: { base: 344, h: [44, 96], w: [1, 1.7], fills: ['var(--sc-grass-2)', 'var(--sc-grass-1)'] },
    front: { base: 384, h: [80, 190], w: [1.3, 2.3], fills: ['var(--sc-grass-3)', 'var(--sc-grass-4)', 'var(--sc-grass-3)'] },
  };
  const out: Blade[] = [];
  (['back', 'mid', 'front'] as Row[]).forEach((row) => {
    const s = spec[row];
    const n = COUNTS[detail][row];
    for (let i = 0; i < n; i++) {
      const x = ((i + (r() - 0.5) * 1.8) / n) * (W + 20) - 10;
      const h = s.h[0] + r() ** 1.4 * (s.h[1] - s.h[0]);
      const tall = row !== 'back' && r() < 0.18;
      const w = tall ? s.w[0] * 0.55 : s.w[0] + r() * (s.w[1] - s.w[0]);
      const curl = (r() - 0.3) * h * 0.32;
      out.push({
        row,
        x,
        base: s.base + r() * 6,
        d: bladePath(w, tall ? h * 1.08 : h, curl),
        head: tall ? { cx: curl, cy: -h * 1.08 } : undefined,
        stiffness: 0.75 + r() * 0.5,
        rate: 0.85 + r() * 0.3,
        seed: r() * Math.PI * 2,
        fill: s.fills[i % s.fills.length],
      });
    }
  });
  return out;
}

export function MeadowScene({ wind, detail = 'full', className }: { wind: () => number; detail?: 'full' | 'mini'; className?: string }) {
  const blades = useMemo(() => makeBlades(detail), [detail]);
  const refs = useRef<(SVGGElement | null)[]>([]);
  const windFn = useRef(wind);
  windFn.current = wind;

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const motion = reduced ? 0.35 : 1;
    let raf = 0;
    let last = performance.now();
    let gust = windFn.current();
    let phase = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // Po powrocie do karty nie nadrabiamy zaległych sekund – ruch płynie dalej bez skoku.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Lekkie opóźnienie wiatru względem oddechu: trawa „dogania” podmuch, nie skacze za nim.
      gust += (windFn.current() - gust) * (1 - Math.exp(-dt / 0.3));
      // Fazę całkujemy (a nie liczymy sin(ω·t)), więc zmiana tempa wiatru nigdy nie przeskakuje.
      phase += dt * (1.1 + 1.8 * gust) * (reduced ? 0.6 : 1);
      for (let i = 0; i < blades.length; i++) {
        const b = blades[i];
        const el = refs.current[i];
        if (!el) continue;
        // Fala biegnie przez łąkę z lewej na prawą; trawa pochyla się z wiatrem i lekko wraca.
        const wave = Math.sin(phase * b.rate - b.x * 0.018 + b.seed);
        const bend = MAX_BEND[b.row] * b.stiffness * gust * (0.55 + 0.45 * wave) * motion;
        el.setAttribute('transform', `translate(${b.x.toFixed(1)} ${b.base.toFixed(1)}) skewX(${(-bend).toFixed(2)})`);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [blades]);

  const row = (r: Row) =>
    blades.map((b, i) =>
      b.row !== r ? null : (
        <g key={i} ref={(el) => void (refs.current[i] = el)} transform={`translate(${b.x} ${b.base})`} fill={b.fill}>
          <path d={b.d} />
          {b.head && <ellipse cx={b.head.cx} cy={b.head.cy} rx={1.7} ry={6.5} />}
        </g>
      ),
    );

  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" aria-hidden focusable="false">
      <rect width={W} height={H} fill="var(--sc-sky)" />
      <circle cx={212} cy={112} r={17} fill="var(--sc-sun)" />
      {/* Odległe góry i bliższy grzbiet – miękkie, zaokrąglone szczyty */}
      <path d="M0 214 Q38 168 70 182 Q104 140 142 176 Q176 150 214 170 Q252 132 300 172 V250 H0Z" fill="var(--sc-far)" />
      <path d="M0 232 Q54 196 104 218 Q150 198 196 222 Q246 204 300 214 V250 H0Z" fill="var(--sc-near)" />
      <rect y={236} width={W} height={14} fill="var(--sc-water)" />
      {/* Łąka: dalszy i bliższy plan */}
      <path d="M0 250 Q80 244 150 249 Q226 254 300 247 V375 H0Z" fill="var(--sc-field-far)" />
      {row('back')}
      <path d="M0 296 Q90 286 170 294 Q240 300 300 290 V375 H0Z" fill="var(--sc-field)" />
      {row('mid')}
      {row('front')}
    </svg>
  );
}
