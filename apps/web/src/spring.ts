/**
 * Sprężyna jak w iOS: dwa parametry zamiast masy, sztywności i tłumienia.
 * damping – 1 bez odbicia (domyślnie), < 1 lekkie przestrzelenie (tylko po geście z rozpędem).
 * response – jak szybko wartość dochodzi do celu, w sekundach (to nie czas trwania; ten wynika z parametrów).
 * Nowy cel w trakcie ruchu startuje z bieżącej wartości i prędkości – ruch da się w każdej chwili złapać i zawrócić.
 */
export type SpringParams = { damping?: number; response?: number };

export const SPRING_SMOOTH: SpringParams = { damping: 1, response: 0.4 };
export const SPRING_SNAPPY: SpringParams = { damping: 1, response: 0.3 };
/** Szuflada / arkusz puszczony z rozpędem. */
export const SPRING_FLICK: SpringParams = { damping: 0.8, response: 0.3 };

export class Spring {
  value: number;
  velocity = 0;
  private target: number;
  private k = 0;
  private c = 0;
  private frame = 0;
  private last = 0;
  private onRest: (() => void) | undefined;

  private onUpdate: (v: number) => void;

  constructor(value: number, onUpdate: (v: number) => void) {
    this.onUpdate = onUpdate;
    this.value = value;
    this.target = value;
  }

  get moving() {
    return this.frame !== 0;
  }

  /** Jedź do celu. velocity (px/s) – prędkość palca w chwili puszczenia; bez niej zostaje bieżąca prędkość sprężyny. */
  to(target: number, { damping = 1, response = 0.4 }: SpringParams = {}, velocity?: number, onRest?: () => void) {
    const w = (2 * Math.PI) / response;
    this.k = w * w;
    this.c = 2 * damping * w;
    this.target = target;
    if (velocity !== undefined) this.velocity = velocity;
    this.onRest = onRest;
    if (!this.frame) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  /** Ustaw wartość od razu (np. palec trzyma element) – zatrzymuje ruch. */
  set(value: number) {
    this.stop();
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.onUpdate(value);
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.onRest = undefined;
  }

  private tick = (now: number) => {
    // Krok stały i drobny – stabilnie także przy klatce 30 Hz albo po chwilowym zacięciu karty.
    let dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    const step = 1 / 240;
    while (dt > 0) {
      const h = Math.min(step, dt);
      const a = -this.k * (this.value - this.target) - this.c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
      dt -= h;
    }
    if (Math.abs(this.value - this.target) < 0.5 && Math.abs(this.velocity) < 5) {
      this.value = this.target;
      this.velocity = 0;
      this.frame = 0;
      this.onUpdate(this.value);
      const done = this.onRest;
      this.onRest = undefined;
      done?.();
      return;
    }
    this.onUpdate(this.value);
    this.frame = requestAnimationFrame(this.tick);
  };
}

/** Gdzie element by się zatrzymał, gdyby jechał dalej siłą rozpędu (jak przewijanie w iOS). */
export const project = (velocity: number, deceleration = 0.998) => ((velocity / 1000) * deceleration) / (1 - deceleration);

/** Miękka granica: im dalej za krawędź, tym mniej element idzie za palcem. */
export const rubberband = (overshoot: number, dimension: number, constant = 0.55) =>
  (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

/** Prędkość palca (px/s) z kilku ostatnich próbek – nie z jednej, bo pojedyncze zdarzenia skaczą. */
export class VelocityTracker {
  private samples: { y: number; t: number }[] = [];
  add(y: number, t = performance.now()) {
    this.samples.push({ y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift();
  }
  get velocity() {
    const s = this.samples;
    if (s.length < 2) return 0;
    const a = s[0];
    const b = s[s.length - 1];
    const dt = b.t - a.t;
    // Palec stanął przed puszczeniem – rozpędu już nie ma.
    if (performance.now() - b.t > 80) return 0;
    return dt > 0 ? ((b.y - a.y) / dt) * 1000 : 0;
  }
  reset() {
    this.samples = [];
  }
}
