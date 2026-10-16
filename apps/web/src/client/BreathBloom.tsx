// Piwonia oddechu – narysowana w kodzie (SVG), płatek po płatku, wzorem zdjęcia: pudrowo-różowy kielich,
// gęste, ciemniejsze płatki w środku, dwa opadające płatki na dole i cienka łodyga.
// Żeby ruch był żywy, a nie „rysunkowy”: warstwy płatków podążają za oddechem z różnym opóźnieniem
// (kwiat otwiera się falą od środka), każdy płatek lekko drży we własnym rytmie, płatki mają żyłki i połysk,
// a dalsze warstwy są delikatnie rozmyte jak w zdjęciu z małą głębią ostrości.
// Wokół: płynąca zorza, rozmyte światła (bokeh), poświata i płatki, które odrywają się i koziołkują w powietrzu.
// Bez `level` kwiat oddycha sam, powoli (karta w zakładce, ekran podziękowania).
// `full` – tło całego ekranu sesji; `card` – kadr w zaokrąglonej ramce.
import { useEffect, useId, useRef } from 'react';

/** Płatek o podstawie w (0,0), skierowany w górę (-y); lekko pofalowany brzeg na czubku. */
function petalPath(len: number, w: number, ruffle = 0.12): string {
  const h = len, r = h * ruffle;
  return `M0 0 C ${-w * 0.95} ${-h * 0.25}, ${-w * 1.05} ${-h * 0.8}, ${-w * 0.45} ${-h * 0.97}
    Q ${-w * 0.22} ${-h - r}, 0 ${-h + r * 0.4} Q ${w * 0.22} ${-h - r}, ${w * 0.45} ${-h * 0.97}
    C ${w * 1.05} ${-h * 0.8}, ${w * 0.95} ${-h * 0.25}, 0 0 Z`;
}

/** Trzy delikatne żyłki od podstawy ku brzegowi. */
function veinPath(len: number, w: number): string {
  const h = len * 0.82;
  return `M0 -2 Q ${-w * 0.1} ${-h * 0.5}, 0 ${-h} M0 -2 Q ${-w * 0.55} ${-h * 0.45}, ${-w * 0.42} ${-h * 0.88} M0 -2 Q ${w * 0.55} ${-h * 0.45}, ${w * 0.42} ${-h * 0.88}`;
}

type Petal = { x: number; y: number; a: number; len: number; w: number; open: number; fill: string; ruffle?: number };

// Warstwy od tyłu do przodu. a – kąt (0 = w górę), open – o ile stopni płatek odchyla się na wdechu.
// lag – który z opóźnionych poziomów oddechu prowadzi warstwę (0 = najszybciej, środek kwiatu).
const spread = (n: number, from: number, to: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
const LAYERS: { cls: string; lag: number; petals: Petal[] }[] = [
  { cls: 'pl-back', lag: 2, petals: spread(7, -78, 78).map((a, i) => ({ x: 100, y: 104, a, len: 66 + (i % 2) * 6, w: 30, open: Math.sign(a) * 12, fill: 'pale' })) },
  { cls: 'pl-droop', lag: 3, petals: [
    { x: 86, y: 136, a: -128, len: 54, w: 28, open: -14, fill: 'pale', ruffle: 0.2 },
    { x: 116, y: 138, a: 136, len: 58, w: 30, open: 16, fill: 'pale', ruffle: 0.2 },
  ] },
  { cls: 'pl-bowl', lag: 1, petals: spread(6, -58, 58).map((a, i) => ({ x: 100, y: 132, a, len: 60 + (i % 2 ? 0 : 5), w: 28, open: Math.sign(a) * 9, fill: 'mid' })) },
  { cls: 'pl-inner', lag: 0, petals: spread(9, -62, 62).map((a, i) => ({ x: 100 + a * 0.12, y: 98 + (i % 3) * 2, a: a * 0.9, len: 34 + (i % 3) * 4, w: 15, open: Math.sign(a) * 8, fill: 'deep', ruffle: 0.25 })) },
  { cls: 'pl-crown', lag: 0, petals: spread(5, -40, 40).map((a, i) => ({ x: 100 + a * 0.15, y: 84 + (i % 2) * 2, a, len: 20 + (i % 2) * 3, w: 10, open: Math.sign(a) * 6, fill: 'deep', ruffle: 0.3 })) },
  { cls: 'pl-front', lag: 1, petals: spread(4, -34, 34).map((a, i) => ({ x: 100, y: 138, a, len: 50 + (i % 2) * 4, w: 26, open: Math.sign(a) * 7, fill: 'front' })) },
];

/** Stałe czasowe (s) opóźnionych poziomów oddechu: środek reaguje od razu, opadające płatki najpóźniej. */
const LAGS = [0.15, 0.45, 0.8, 1.2];

const TAU = 2 * Math.PI;
/**
 * Długi, płynny ruch całego kwiatu: kilka wolnych fal o niewspółmiernych okresach, więc ruch się nie powtarza.
 * Na wdechu kwiat unosi się i przechyla – raz w lewo, raz w prawo, bo kierunek przechyłu sam powoli się zmienia.
 */
function drift(t: number, lv: number) {
  const lean = Math.sin((TAU * t) / 29 + 0.7); // kierunek przechyłu na wdechu: wolno przechodzi z lewej na prawą
  const rot = 3.2 * Math.sin((TAU * t) / 11) + 1.6 * Math.sin((TAU * t) / 17 + 1) + (lv - 0.4) * 6 * lean;
  const x = 7 * Math.sin((TAU * t) / 13 + 0.5) + 4 * Math.sin((TAU * t) / 23) + (lv - 0.4) * 10 * lean;
  const y = -lv * 14 + 2.5 * Math.sin((TAU * t) / 9 + 2);
  return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rot.toFixed(3)}deg)`;
}

// Odlatujące płatki: start w poziomie (% sceny), opóźnienie, czas lotu, wielkość, obrót, rozmycie (głębia).
const FLOATERS = [
  [40, 0, 11, 16, -20, 0], [62, 2.2, 12, 12, 30, 1.2], [50, 4.6, 10.5, 18, 10, 0], [68, 6.1, 13, 11, -40, 2],
  [34, 7.4, 11.5, 13, 50, 0.6], [56, 3.4, 14, 9, -10, 2.4],
];

// Rozmyte światła (bokeh): pozycja (%), opóźnienie, czas, wielkość.
const BOKEH = [
  [14, 20, 0, 14, 22], [80, 14, 3, 17, 34], [22, 70, 6, 15, 18], [76, 62, 1.5, 19, 28], [48, 10, 8, 16, 14],
  [90, 86, 4, 18, 24], [8, 46, 9, 20, 30], [60, 88, 2, 14, 16],
];

export function BreathBloom({ level, hold, variant = 'card', className = '', style, behind }: { level?: () => number; hold?: boolean; variant?: 'full' | 'card'; className?: string; style?: React.CSSProperties; behind?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const swayRef = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');
  // Funkcja poziomu przychodzi nowa przy każdym renderze rodzica (co sekundę) – trzymamy ją w refie,
  // żeby pętla animacji żyła przez całą sesję i nie zaczynała od nowa (to dawało przeskoki kwiatu).
  const levelRef = useRef(level);
  levelRef.current = level;
  const live = !!level;

  // Pętla: poziom oddechu (albo spokojny, samodzielny oddech), cztery opóźnione kopie dla warstw płatków
  // i długi ruch całego kwiatu. Własny zegar zatrzymuje się w pauzie, więc kwiat nie „przeskakuje” po wznowieniu.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let t = 0;
    const smooth = LAGS.map(() => 0.3);
    let visible = true;
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    if (ref.current) io?.observe(ref.current);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!el || !visible || el.classList.contains('is-paused')) return;
      t += dt;
      const lv = levelRef.current ? levelRef.current() : 0.5 - 0.4 * Math.cos((TAU * t) / 9);
      LAGS.forEach((tau, k) => {
        smooth[k] += (lv - smooth[k]) * (1 - Math.exp(-dt / tau));
        el.style.setProperty(`--l${k}`, smooth[k].toFixed(4));
      });
      el.style.setProperty('--lvl', smooth[1].toFixed(4));
      if (swayRef.current) swayRef.current.style.transform = drift(t, smooth[2]);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [live]);

  return (
    <div ref={ref} className={`peony peony-${variant} ${hold ? 'is-hold' : ''} ${className}`} style={style} aria-hidden>
      <span className="peony-aurora a1" />
      <span className="peony-aurora a2" />
      <span className="peony-aurora a3" />
      <span className="peony-bokeh">
        {BOKEH.map(([x, y, d, t, s], i) => (
          <span key={i} style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, animationDelay: `-${d}s`, animationDuration: `${t}s` }} />
        ))}
      </span>
      <div className="peony-stage">
        <span className="peony-glow" />
        {/* Np. koła oddechu – stoją za kwiatem, wyśrodkowane na jego głowie, i nie kołyszą się razem z nim. */}
        {behind}
        <div ref={swayRef} className="peony-sway">
          <svg className="peony-flower" viewBox="0 0 200 260">
            <defs>
              {/* Od podstawy płatka (ciemniej) do brzegu (prawie biało) – jak na zdjęciu. */}
              <linearGradient id={`pale${id}`} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#e88fb0" />
                <stop offset="0.5" stopColor="#f6c2d3" />
                <stop offset="1" stopColor="#fff3f6" />
              </linearGradient>
              <linearGradient id={`mid${id}`} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#d9729a" />
                <stop offset="0.6" stopColor="#f2abc2" />
                <stop offset="1" stopColor="#fde2eb" />
              </linearGradient>
              <linearGradient id={`deep${id}`} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#c9527e" />
                <stop offset="0.7" stopColor="#ea8fae" />
                <stop offset="1" stopColor="#f9cbda" />
              </linearGradient>
              <linearGradient id={`front${id}`} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#e183a6" />
                <stop offset="0.5" stopColor="#f7c8d7" />
                <stop offset="1" stopColor="#fff6f8" />
              </linearGradient>
              {/* Połysk: jaśniejsza plama na wypukłości płatka daje mu objętość. */}
              <radialGradient id={`sheen${id}`} cx="0.42" cy="0.32" r="0.55">
                <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
                <stop offset="0.6" stopColor="#fff" stopOpacity="0.08" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
              {/* Cień u nasady – płatki nachodzą na siebie, a nie leżą płasko. */}
              <radialGradient id={`base${id}`} cx="0.5" cy="1" r="0.6">
                <stop offset="0" stopColor="#8f2d55" stopOpacity="0.28" />
                <stop offset="1" stopColor="#8f2d55" stopOpacity="0" />
              </radialGradient>
              <linearGradient id={`stem${id}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#566f3d" />
                <stop offset="1" stopColor="#87a467" />
              </linearGradient>
            </defs>

            {/* Łodyga i dwa listki – stoją, kołysze się cały kwiat. */}
            <path className="peony-stem" d="M100 140 C 98 175, 104 205, 99 262 S 102 420, 100 760" stroke={`url(#stem${id})`} />
            <path className="peony-leaf leaf-r" d="M100 150 C 112 152, 122 160, 128 172 C 116 170, 106 162, 100 150 Z" fill="#6d8a4f" />
            <path className="peony-leaf leaf-l" d="M99 148 C 90 152, 84 160, 82 168 C 90 165, 97 158, 99 148 Z" fill="#7c9a5c" />

            <g className="peony-head">
              {LAYERS.map((layer) => (
                <g key={layer.cls} className={`peony-layer ${layer.cls}`} style={{ '--lv': `var(--l${layer.lag})` } as React.CSSProperties}>
                  {layer.petals.map((p, i) => {
                    const d = petalPath(p.len, p.w, p.ruffle);
                    return (
                      <g key={i} transform={`translate(${p.x} ${p.y})`}>
                        {/* Własne, nieregularne drżenie każdego płatka. */}
                        <g className="peony-flutter" style={{ animationDuration: `${3.2 + ((i * 7) % 5) * 0.55}s`, animationDelay: `-${(i * 1.37) % 4}s` }}>
                          <g className="peony-petal" style={{ '--a': `${p.a}deg`, '--o': `${p.open}deg` } as React.CSSProperties}>
                            <path d={d} fill={`url(#${p.fill}${id})`} />
                            <path d={d} fill={`url(#base${id})`} />
                            <path d={d} fill={`url(#sheen${id})`} />
                            <path className="peony-vein" d={veinPath(p.len, p.w)} />
                            <path className="peony-edge" d={d} />
                          </g>
                        </g>
                      </g>
                    );
                  })}
                </g>
              ))}
            </g>
          </svg>
        </div>
        <span className="peony-petals">
          {FLOATERS.map(([x, d, t, s, r, b], i) => (
            <span key={i} style={{ left: `${x}%`, width: s, height: s * 1.35, animationDelay: `${d}s`, animationDuration: `${t}s`, opacity: b ? 0.7 : undefined, '--rot': `${r}deg` } as React.CSSProperties} />
          ))}
        </span>
      </div>
    </div>
  );
}

/** Mały kwiatek do tygodnia rytuału: pięć płatków wokół środka. */
export function MiniBloom() {
  return (
    <svg className="mini-bloom" viewBox="0 0 24 24" aria-hidden>
      {[0, 72, 144, 216, 288].map((r) => (
        <ellipse key={r} cx="12" cy="6.6" rx="3.6" ry="5" transform={`rotate(${r} 12 12)`} />
      ))}
      <circle className="mini-bloom-core" cx="12" cy="12" r="2.4" />
    </svg>
  );
}
