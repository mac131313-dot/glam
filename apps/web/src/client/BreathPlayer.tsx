// Sesja oddechu / medytacji prowadzona przez aplikację: tempo wyznacza piwonia, która rozkwita na wdechu
// i mięknie na wydechu. Bez licznika i paska postępu – długość klientka wybrała na początku, w trakcie liczy się
// tylko oddech. Haptyka na początku każdej fazy i spokojny szum – oba do włączenia i wyłączenia w trakcie.
// Na końcu podziękowanie, rytuał tygodnia i myśl na dziś – zaproszenie, żeby wrócić jutro.
import { useEffect, useRef, useState } from 'react';
import { breathAt, patternById, promptAt, sessionById, type BreathRitual } from '@glam/core';
import { Icon } from '../icons.tsx';
import { api } from '../api.ts';
import { useLayer } from '../back.ts';
import { BreathBloom, MiniBloom } from './BreathBloom.tsx';
import { useClient } from './ClientApp.tsx';
import { CalmNoise, hapticPhase, hapticsSupported, loadSenses, saveSenses, useWakeLock, type SenseSettings } from './senses.ts';

export type BreathRequest = { sessionId?: string; patternId?: string; minutes?: number };

type Ritual = BreathRitual & { affirmation: string };

const PHASE_WORD = { in: 'wdech', hold: 'zatrzymaj', out: 'wydech' } as const;
const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

export function BreathPlayer({ request, onClose }: { request: BreathRequest; onClose: () => void }) {
  const session = request.sessionId ? sessionById(request.sessionId) : undefined;
  const pattern = patternById(session?.pattern ?? request.patternId ?? 'calm');
  const totalSec = (session?.minutes ?? request.minutes ?? 3) * 60;
  const title = session?.title ?? pattern.label;

  const [senses, setSenses] = useState<SenseSettings>(loadSenses);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const [ritual, setRitual] = useState<Ritual | null>(null);
  const [view, setView] = useState({ index: 0, elapsed: 0 });
  const [round, setRound] = useState(0);

  // Poziom kwiatu 0..1 – zapisywany w pętli, czytany przez BreathBloom co klatkę.
  const level = useRef(0);
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
    if (done) return;
    const n = noise.current;
    if (sensesRef.current.noise) n.start(sensesRef.current.volume);
    return () => n.stop();
  }, [done, round]);

  // Pętla rytmu – poziom trafia do kwiatu przez ref, React odświeża tylko fazę i podpowiedź.
  useEffect(() => {
    if (done) return;
    clock.current = { start: performance.now(), pausedTotal: 0, pausedAt: 0 };
    lastIndex.current = -1;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (pausedRef.current) return; // w pauzie kwiat zatrzymuje się tam, gdzie był
      const elapsedMs = now - clock.current.start - clock.current.pausedTotal;
      if (elapsedMs >= totalSec * 1000) {
        cancelAnimationFrame(raf);
        noise.current.stop();
        noise.current = new CalmNoise();
        if (sensesRef.current.haptics) hapticPhase('out');
        setDone(true);
        // Ukończona sesja liczy się do celu tygodnia i KPI „medytacje tygodniowo” (decyzja 9, sekcja 12).
        api('/mindful', { method: 'POST', body: { kind: session ? 'meditation' : 'breath', ref: session?.id ?? pattern.id, minutes: totalSec / 60 } })
          .then(() => window.dispatchEvent(new Event('glam:passes-changed')))
          .catch(() => {})
          .then(() => api<Ritual>('/my/breath-ritual'))
          .then(setRitual)
          .catch(() => {});
        return;
      }
      const st = breathAt(pattern, elapsedMs);
      level.current = st.level;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, totalSec, done, round]);

  useLayer(onClose);
  useWakeLock(!done && !paused);

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

  const again = () => {
    level.current = 0;
    setRitual(null);
    setView({ index: 0, elapsed: 0 });
    setRound((r) => r + 1);
    setDone(false);
  };

  if (done) return <Thanks ritual={ritual} onAgain={again} onClose={onClose} />;

  const phase = pattern.phases[view.index];
  const prompt = session ? promptAt(session, view.elapsed) : undefined;

  return (
    <div className="player player-photo" role="dialog" aria-modal="true" aria-label={title}>
      {/* Tryb oddechu jest minimalny: piwonia na całym ekranie, słowo fazy i trzy szklane ikony – nic więcej nie rozprasza. */}
      <BreathBloom variant="full" level={() => level.current} hold={!paused && phase.kind === 'hold'} className={paused ? 'is-paused' : ''} />
      <header className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="icon-btn glass-icon" onClick={onClose} aria-label="Zakończ sesję">
          <Icon name="close" />
        </button>
      </header>

      <div className="player-stage breath-stage">
        <p key={prompt?.at ?? 'none'} className="breath-prompt serif">
          {prompt?.text ?? ''}
        </p>
        <div key={paused ? 'p' : view.index} className="breath-word serif" aria-live="polite">
          {paused ? 'pauza' : PHASE_WORD[phase.kind]}
        </div>
      </div>

      <footer className="player-controls glass">
        <div className="row" style={{ gap: 14 }}>
          <button
            className="icon-btn glass-icon"
            aria-pressed={senses.haptics}
            aria-label={senses.haptics ? 'Wyłącz haptykę' : 'Włącz haptykę'}
            title={hapticsSupported() ? 'Haptyka' : 'Haptyka zadziała w aplikacji mobilnej'}
            onClick={() => setSenses({ ...senses, haptics: !senses.haptics })}
          >
            <Icon name="vibrate" />
          </button>
          <button className="icon-btn glass-icon glass-main" onClick={togglePause} aria-label={paused ? 'Wznów' : 'Pauza'}>
            <Icon name={paused ? 'play' : 'pause'} size={20} />
          </button>
          <button className="icon-btn glass-icon" aria-pressed={senses.noise} aria-label={senses.noise ? 'Wyłącz szum' : 'Włącz szum'} title="Spokojny szum" onClick={toggleNoise}>
            <Icon name="wave" />
          </button>
        </div>
      </footer>
    </div>
  );
}

function Thanks({ ritual, onAgain, onClose }: { ritual: Ritual | null; onAgain: () => void; onClose: () => void }) {
  const { me, studio } = useClient();
  const name = me.user.name;
  return (
    <div className="player player-soft" role="dialog" aria-modal="true" aria-label="Sesja zakończona">
      <div className="player-stage thanks">
        <BreathBloom style={{ width: 132, height: 172 }} />
        <div className="stack center" style={{ gap: 6 }}>
          <div className="eyebrow">Twój rytuał</div>
          <div className="serif" style={{ fontSize: '2.4rem', lineHeight: 1.05 }}>
            Dziękuję{name ? `, ${name}` : ''}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            za tę chwilę tylko dla siebie
          </p>
        </div>

        {ritual && (
          <>
            <RitualWeek ritual={ritual} />
            <p className="small center" style={{ margin: 0 }}>
              {streakLine(ritual.streak)}
            </p>
            <div className="affirmation">
              <div className="eyebrow">Myśl na dziś</div>
              <div className="serif" style={{ fontSize: '1.45rem', lineHeight: 1.2 }}>
                „{ritual.affirmation}”
              </div>
              <div className="tiny muted">z czułością, {studio.name}</div>
            </div>
          </>
        )}
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <button className="btn block" onClick={onClose}>
          Do jutra
        </button>
        <button className="btn ghost block" onClick={onAgain}>
          Jeszcze chwilę
        </button>
      </div>
    </div>
  );
}

/** Tydzień jako siedem kwiatków – rozkwitnięty to dzień z oddechem. */
export function RitualWeek({ ritual }: { ritual: BreathRitual }) {
  const todayIdx = (new Date().getDay() + 6) % 7;
  return (
    <div className="ritual-week" role="list" aria-label="Twój tydzień oddechu">
      {ritual.week.map((on, i) => (
        <div key={i} role="listitem" className={`ritual-day ${on ? 'on' : ''} ${i === todayIdx ? 'today' : ''}`} aria-label={`${WEEKDAYS[i]}: ${on ? 'była chwila oddechu' : 'jeszcze nie'}`}>
          <MiniBloom />
          <span className="tiny">{WEEKDAYS[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function streakLine(streak: number): string {
  if (streak <= 0) return 'Pierwszy kwiatek Twojego rytuału. Wróć jutro, a zakwitnie kolejny.';
  if (streak === 1) return 'Pierwszy kwiatek rytuału. Jutro kolejny?';
  return `${streak} dni z rzędu oddychasz dla siebie. Pięknie.`;
}
