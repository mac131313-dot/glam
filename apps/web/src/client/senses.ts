// Zmysły sesji oddechowej: haptyka i spokojny szum. Oba do włączenia i wyłączenia.
// W natywnej aplikacji (Capacitor/Expo) haptykę przejmie systemowe API (iOS Taptic Engine, Android),
// w przeglądarce działa Vibration API – dostępne na Androidzie, niedostępne w Safari na iOS.
import { useEffect } from 'react';
import { BREATH_LENGTHS, PATTERNS, type PhaseKind } from '@glam/core';

export type SenseSettings = { haptics: boolean; noise: boolean; volume: number };
const KEY = 'glam.mindful';
const DEFAULTS: SenseSettings = { haptics: true, noise: true, volume: 0.5 };

export function loadSenses(): SenseSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export function saveSenses(s: SenseSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export type BreathChoice = { patternId: string; minutes: number };
const CHOICE_KEY = 'glam.breath.choice';

/** Ostatnio wybrany rytm i czas – żeby przy powrocie wystarczyło „Zacznij”. Tylko wygoda na tym urządzeniu. */
export function loadBreathChoice(): BreathChoice {
  const fallback = { patternId: 'calm', minutes: 3 };
  try {
    const v = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as Partial<BreathChoice> | null;
    const patternOk = PATTERNS.some((p) => p.id === v?.patternId);
    const minutesOk = BREATH_LENGTHS.some((l) => l.minutes === v?.minutes);
    return { patternId: patternOk ? v!.patternId! : fallback.patternId, minutes: minutesOk ? v!.minutes! : fallback.minutes };
  } catch {
    return fallback;
  }
}

export function saveBreathChoice(c: BreathChoice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(c));
  } catch {}
}

/** Najcichszy moment szumu (po pełnym wydechu) względem szczytu wdechu – nie zero, żeby dźwięk nie znikał. */
const BREATH_FLOOR = 0.15;

export const hapticsSupported = () => typeof navigator !== 'undefined' && 'vibrate' in navigator;

/** Delikatny sygnał na początku fazy: wdech – dwa lekkie stuknięcia, wydech – jedno dłuższe, zatrzymanie – ledwo wyczuwalne. */
export function hapticPhase(kind: PhaseKind) {
  if (!hapticsSupported()) return;
  const pattern = kind === 'in' ? [18, 90, 18] : kind === 'out' ? [45] : [10];
  try {
    navigator.vibrate(pattern);
  } catch {}
}

/**
 * Spokojny szum generowany na żywo (bez plików audio): biały szum przepuszczony przez łagodny filtr,
 * więc brzmi miękko, jak odległy wiatr. Szum „oddycha” razem z sesją: narasta na wdechu, cichnie na wydechu.
 */
export class CalmNoise {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  /** Osobny stopień tylko dla oddechu – `gain` zostaje dla głośności i wyciszania, więc rampy się nie nadpisują. */
  private breathGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private volume = 0.5;

  /** Wołać z gestu użytkownika (kliknięcie) – inaczej przeglądarka nie pozwoli zagrać. */
  start(volume: number) {
    this.volume = volume;
    if (this.ctx) return this.fadeTo(this.target());
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 80;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 0.4;
    const breathGain = ctx.createGain();
    breathGain.gain.value = BREATH_FLOOR;
    const gain = ctx.createGain();
    gain.gain.value = 0;

    src.connect(highpass).connect(filter).connect(breathGain).connect(gain).connect(ctx.destination);
    src.start();
    Object.assign(this, { ctx, src, filter, breathGain, gain });
    this.fadeTo(this.target(), 2);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.fadeTo(this.target(), 0.3);
  }

  /** level 0..1 z koła – na wdechu szum narasta i jaśnieje, na wydechu cichnie i ciemnieje, w zatrzymaniu trwa. */
  breathe(level: number) {
    if (!this.ctx || !this.filter || !this.breathGain) return;
    const now = this.ctx.currentTime;
    // Głośność odbieramy logarytmicznie – kwadrat poziomu daje równe w odczuciu narastanie.
    this.breathGain.gain.setTargetAtTime(BREATH_FLOOR + (1 - BREATH_FLOOR) * level * level, now, 0.08);
    this.filter.frequency.setTargetAtTime(500 + level * 900, now, 0.15);
  }

  stop() {
    if (!this.ctx) return;
    // Węzły chwytamy lokalnie: start() tuż po stop() (StrictMode, wznowienie) podmienia pola instancji
    // i opóźnione zamknięcie trafiłoby w nowe źródło, a stary kontekst grałby dalej.
    const { ctx, src } = this;
    this.fadeTo(0, 1.2);
    this.ctx = this.src = this.gain = this.breathGain = this.filter = null;
    setTimeout(() => {
      try {
        src?.stop();
      } catch {}
      ctx.close().catch(() => {});
    }, 1400);
  }

  private target() {
    return 0.04 + this.volume * 0.22;
  }

  private fadeTo(value: number, seconds = 1) {
    if (!this.ctx || !this.gain) return;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(value, now + seconds);
  }
}

/**
 * Ekran nie gaśnie w trakcie sesji (telefon zwykle blokuje się po 30 s – 2 min, a sesje trwają do 15 min).
 * System zwalnia blokadę, gdy karta znika z ekranu, więc po powrocie bierzemy ją ponownie.
 * Bez Screen Wake Lock API (starsze przeglądarki) po prostu nic nie robimy.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (alive) lock = l;
          else l.release().catch(() => {});
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', acquire);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
