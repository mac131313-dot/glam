// Lekki śnieg dla motywu świątecznego (efekt 'snow'). Jeden canvas pod paskami aplikacji, bez klikalności.
// Płatki rysowane w rAF – przeglądarka sama wstrzymuje animację, gdy karta jest w tle.
import { useEffect, useRef } from 'react';

type Flake = { x: number; y: number; r: number; speed: number; drift: number; phase: number; alpha: number };

/** Ile płatków na danej powierzchni – „lekki” śnieg, nie zamieć. */
const DENSITY = 1 / 9000; // płatek na ~9000 px² (telefon 390×844 ≈ 36 płatków)
const MAX_FLAKES = 70;

function makeFlake(w: number, h: number, anywhere: boolean): Flake {
  const r = 1.5 + Math.random() * 2.6;
  return {
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : -r * 2,
    r,
    // większe płatki są „bliżej”, więc spadają trochę szybciej
    speed: 0.25 + r * 0.18 + Math.random() * 0.2,
    drift: 0.3 + Math.random() * 0.6,
    phase: Math.random() * Math.PI * 2,
    alpha: 0.7 + Math.random() * 0.3,
  };
}

/**
 * Czy śnieg ma w ogóle padać. „Zawsze standard” (themeOptOut) obsługuje już API – motyw wtedy nie przychodzi.
 */
export function shouldSnow(): boolean {
  if (typeof window === 'undefined') return false;
  // Osoby z ograniczeniem ruchu w systemie nie dostają animacji tła.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  return true;
}

export function Snowfall() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let w = 0;
    let h = 0;
    let flakes: Flake[] = [];
    let frame = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(MAX_FLAKES, Math.round(w * h * DENSITY));
      flakes = Array.from({ length: count }, (_, i) => flakes[i] ?? makeFlake(w, h, true));
    };

    const tick = (now: number) => {
      // dt w „klatkach 60 fps” – ta sama prędkość na ekranach 60 i 120 Hz; po powrocie z tła bez skoku
      const dt = Math.min((now - last) / 16.7, 3);
      last = now;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        f.y += f.speed * dt;
        f.phase += 0.012 * dt;
        f.x += Math.sin(f.phase) * f.drift * 0.35 * dt;
        if (f.y > h + f.r * 2 || f.x < -10 || f.x > w + 10) {
          flakes[i] = makeFlake(w, h, false);
          continue;
        }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${f.alpha})`;
        ctx.shadowColor = 'rgba(28, 38, 32, 0.32)'; // delikatny cień, żeby biel była widoczna na kremowym tle
        ctx.shadowBlur = 4;
        ctx.fill();
      }
      frame = requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="snowfall" aria-hidden="true" />;
}
