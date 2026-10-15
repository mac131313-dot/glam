// Sesja oddechu / medytacji prowadzona przez aplikację: tempo wyznacza wiatr na łące (bez napisów na ekranie),
// haptyka na początku każdej fazy i spokojny szum – oba do włączenia i wyłączenia w trakcie.
import { useEffect, useRef, useState } from 'react';
import { WIND_CALM, breathAt, patternById, promptAt, sessionById, windAt } from '@glam/core';
import { Icon } from '../icons.tsx';
import { api } from '../api.ts';
import { useLayer } from '../back.ts';
import { MeadowScene } from './MeadowScene.tsx';
import { CalmNoise, hapticPhase, hapticsSupported, loadSenses, saveSenses, type SenseSettings } from './senses.ts';

export type BreathRequest = { sessionId?: string; patternId?: string; minutes?: number };

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function BreathPlayer({ request, onClose }: { request: BreathRequest; onClose: () => void }) {
  const session = request.sessionId ? sessionById(request.sessionId) : undefined;
  const pattern = patternById(session?.pattern ?? request.patternId ?? 'calm');
  const totalSec = (session?.minutes ?? request.minutes ?? 3) * 60;
  const title = session?.title ?? pattern.label;

  const [senses, setSenses] = useState<SenseSettings>(loadSenses);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const [view, setView] = useState({ index: 0, elapsed: 0 });

  // Siła wiatru dla scenki – zapisywana w pętli, czytana przez MeadowScene co klatkę.
  const wind = useRef(WIND_CALM);
  const noise = useRef(new CalmNoise());
  const sensesRef = useRef(senses);
  const pausedRef = useRef(false);
  const clock = useRef({ start: performance.now(), pausedTotal: 0, pausedAt: 0 });
  const lastIndex = useRef(-1);

  // Zapamiętujemy wybór klientki (per urządzenie).
  useEffect(() => {
    sensesRef.current = senses;
    saveSenses(senses);
  }, [senses]);

  // Szum startuje razem z sesją (otwarcie nastąpiło z kliknięcia, więc przeglądarka pozwala grać).
  useEffect(() => {
    const n = noise.current;
    if (sensesRef.current.noise) n.start(sensesRef.current.volume);
    return () => n.stop();
  }, []);

  // Pętla rytmu – wiatr trafia do scenki przez ref, React odświeża tylko pasek postępu.
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (pausedRef.current) {
        wind.current = WIND_CALM / 2; // w pauzie łąka się uspokaja, ale nie zamiera
        return;
      }
      const elapsedMs = now - clock.current.start - clock.current.pausedTotal;
      if (elapsedMs >= totalSec * 1000) {
        cancelAnimationFrame(raf);
        noise.current.stop();
        if (sensesRef.current.haptics) hapticPhase('out');
        setDone(true);
        // Ukończona sesja liczy się do celu tygodnia i KPI „medytacje tygodniowo” (decyzja 9, sekcja 12).
        api('/mindful', { method: 'POST', body: { kind: session ? 'meditation' : 'breath', ref: session?.id ?? pattern.id, minutes: totalSec / 60 } })
          .then(() => window.dispatchEvent(new Event('glam:passes-changed')))
          .catch(() => {});
        return;
      }
      const st = breathAt(pattern, elapsedMs);
      wind.current = windAt(pattern, elapsedMs);
      noise.current.breathe(st.level);
      // Nowa faza (także ta sama faza w kolejnym cyklu) → jeden sygnał haptyczny.
      const phaseKey = st.cycle * pattern.phases.length + st.index;
      if (phaseKey !== lastIndex.current) {
        lastIndex.current = phaseKey;
        if (sensesRef.current.haptics) hapticPhase(st.phase.kind);
      }
      const elapsed = Math.floor(elapsedMs / 1000);
      setView((v) => (v.index === st.index && v.elapsed === elapsed ? v : { index: st.index, elapsed }));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pattern, totalSec]);

  useLayer(onClose);

  const togglePause = () => {
    const now = performance.now();
    if (pausedRef.current) {
      clock.current.pausedTotal += now - clock.current.pausedAt;
      if (senses.noise) noise.current.start(senses.volume);
    } else {
      clock.current.pausedAt = now;
      noise.current.stop();
      noise.current = new CalmNoise();
    }
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  const toggleNoise = () => {
    const next = !senses.noise;
    if (next && !paused) noise.current.start(senses.volume);
    if (!next) {
      noise.current.stop();
      noise.current = new CalmNoise();
    }
    setSenses({ ...senses, noise: next });
  };

  const phase = pattern.phases[view.index];
  const prompt = session ? promptAt(session, view.elapsed) : undefined;
  const remaining = Math.max(0, totalSec - view.elapsed);

  if (done) {
    return (
      <div className="player" role="dialog" aria-modal="true" aria-label="Sesja zakończona">
        <div className="player-stage">
          <div className="stack center" style={{ gap: 10 }}>
            <div className="eyebrow">Gotowe</div>
            <div className="serif" style={{ fontSize: '2.6rem', lineHeight: 1.1 }}>
              Dziękuję
              <br />
              za tę chwilę
            </div>
            <p className="muted">{Math.round(totalSec / 60)} min tylko dla Ciebie</p>
          </div>
        </div>
        <button className="btn block" onClick={onClose}>
          Zamknij
        </button>
      </div>
    );
  }

  return (
    <div className="player" role="dialog" aria-modal="true" aria-label={title}>
      {/* Sama scenka na cały ekran, bez napisów – fazę i podpowiedź słyszą tylko czytniki ekranu. */}
      <MeadowScene className="player-bg" wind={() => wind.current} />
      <header className="row between">
        <div>
          <div className="eyebrow" style={{ marginBottom: 2 }}>
            {session?.category ?? pattern.hint}
          </div>
          <div className="card-title">{title}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Zakończ sesję">
          <Icon name="close" />
        </button>
      </header>

      <div className="player-stage" />
      <p className="sr-only" aria-live="polite">
        {paused ? 'pauza' : phase.label}
        {prompt ? `. ${prompt.text}` : ''}
      </p>

      <footer className="stack player-controls" style={{ gap: 18 }}>
        <div className="progress" aria-hidden>
          <span style={{ width: `${(view.elapsed / totalSec) * 100}%`, transition: 'width 1s linear' }} />
        </div>
        <div className="row between">
          <button
            className="icon-btn"
            aria-pressed={senses.haptics}
            aria-label={senses.haptics ? 'Wyłącz haptykę' : 'Włącz haptykę'}
            title={hapticsSupported() ? 'Haptyka' : 'Haptyka zadziała w aplikacji mobilnej'}
            onClick={() => setSenses({ ...senses, haptics: !senses.haptics })}
          >
            <Icon name="vibrate" />
          </button>
          <div className="stack center" style={{ gap: 4 }}>
            <button className="btn" style={{ minWidth: 150 }} onClick={togglePause}>
              <Icon name={paused ? 'play' : 'pause'} size={18} /> {paused ? 'Wznów' : 'Pauza'}
            </button>
            <span className="code tiny muted">{fmt(remaining)}</span>
          </div>
          <button className="icon-btn" aria-pressed={senses.noise} aria-label={senses.noise ? 'Wyłącz szum' : 'Włącz szum'} title="Spokojny szum" onClick={toggleNoise}>
            <Icon name="wave" />
          </button>
        </div>
        {senses.noise && (
          <label className="row small muted" style={{ justifyContent: 'center' }}>
            <span>Głośność szumu</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={senses.volume}
              onChange={(e) => {
                const volume = Number(e.target.value);
                noise.current.setVolume(volume);
                setSenses({ ...senses, volume });
              }}
              style={{ accentColor: 'var(--ink)', width: 160 }}
            />
          </label>
        )}
      </footer>
    </div>
  );
}
