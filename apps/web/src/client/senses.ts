// Zmysły sesji oddechowej: haptyka i spokojny szum. Oba do włączenia i wyłączenia.
// W natywnej aplikacji (Capacitor/Expo) haptykę przejmie systemowe API (iOS Taptic Engine, Android),
// w przeglądarce działa Vibration API – dostępne na Androidzie, niedostępne w Safari na iOS.
import type { PhaseKind } from '@glam/core';

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
 * więc brzmi miękko, jak odległy wiatr. Szum „oddycha” razem z kołem: narasta na wdechu, cichnie na wydechu.
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
    const ctx = this.ctx;
    this.fadeTo(0, 1.2);
    this.ctx = null;
    setTimeout(() => {
      try {
        this.src?.stop();
      } catch {}
      ctx.close();
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
