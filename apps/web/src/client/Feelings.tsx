// „Twoje odczucia”: krótka ankieta po treningu – nastrój i energia, zapisane w dzienniku samopoczucia.
// Wyskakuje sama jako dyskretna karta nad paskiem zakładek, gdy zajęcia się skończą (raz na zajęcia),
// a z „Dla mnie” można do niej wrócić w każdej chwili.
import { useEffect, useState } from 'react';
import { ENERGY_LABELS, MOOD_LABELS } from '@glam/core';
import { api, useApi } from '../api.ts';
import { useLayer } from '../back.ts';
import { Icon } from '../icons.tsx';
import { LevelPicker, useAction } from '../ui.tsx';

type Entry = { date: string; mood: number; energy: number; sleep: number; gratitude?: string };
type Booking = { id: string; status: string; guest_name: string | null; ends_at: string; class_name: string };

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const SEEN_KEY = 'glam:feelings-seen';
// Po tylu godzinach od końca zajęć pytanie „jak się czujesz po treningu” traci sens.
const WINDOW_MS = 6 * 3600_000;

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const markSeen = (id: string) => {
  try {
    localStorage.setItem(SEEN_KEY, id);
  } catch {
    /* prywatne okno – najwyżej zapytamy jeszcze raz */
  }
};

/** Karta ankiety. `className` z zajęć zmienia nagłówek na „Po zajęciach”. */
export function FeelingsCard({ className, onClose }: { className?: string; onClose: () => void }) {
  useLayer(onClose);
  const { data, error, reload } = useApi<{ entries: Entry[] }>('/me/journal');
  const todayEntry = data?.entries.find((e) => e.date === isoDay(new Date()));
  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const { run, busy } = useAction();
  useEffect(() => {
    if (todayEntry) {
      setMood(todayEntry.mood);
      setEnergy(todayEntry.energy);
    }
  }, [todayEntry]);

  const needsConsent = error?.code === 'consent_required';
  const save = () =>
    run(async () => {
      // Sen i wdzięczność zostają z dzisiejszego wpisu – ankieta pyta tylko o to, co zmienia trening.
      await api(`/me/journal/${isoDay(new Date())}`, { method: 'PUT', global: true, body: { mood, energy, sleep: todayEntry?.sleep ?? 3, gratitude: todayEntry?.gratitude } });
      window.dispatchEvent(new Event('glam:passes-changed'));
      onClose();
    }, 'Zapisane – dziękujemy');

  return (
    <div className="feel" role="dialog" aria-label="Twoje odczucia">
      <div className="feel-head">
        <div>
          <div className="eyebrow">{className ? `Po zajęciach · ${className}` : 'Twoje odczucia'}</div>
          <p className="feel-q serif">Jak się teraz czujesz?</p>
        </div>
        <button className="feel-x" onClick={onClose} aria-label="Zamknij">
          <Icon name="close" size={16} />
        </button>
      </div>
      {needsConsent ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Odczucia zapisujemy w prywatnym, zaszyfrowanym dzienniku. Potrzebujemy na to Twojej zgody.
          </p>
          <button className="btn block" disabled={busy} onClick={() => run(() => api('/me/consents', { method: 'PUT', global: true, body: { kind: 'health', granted: true } }).then(reload))}>
            Wyrażam zgodę
          </button>
        </>
      ) : (
        <>
          <LevelPicker label="Nastrój" value={mood} onChange={setMood} words={MOOD_LABELS} />
          <LevelPicker label="Energia" value={energy} onChange={setEnergy} words={ENERGY_LABELS} />
          <button className="btn block" disabled={busy || !data} onClick={save}>
            Zapisz
          </button>
        </>
      )}
    </div>
  );
}

/** Pilnuje końca zajęć: gdy ostatni trening skończył się niedawno, a klientka jeszcze o nim nie mówiła – pokazuje ankietę. */
export function AfterClassFeelings({ paused }: { paused: boolean }) {
  const { data, reload } = useApi<Booking[]>('/my/bookings');
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState(readSeen);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const onVisible = () => document.visibilityState === 'visible' && (tick(), reload());
    const t = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('glam:passes-changed', reload);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('glam:passes-changed', reload);
    };
  }, [reload]);

  // Najnowsze zakończone zajęcia (lista idzie od najnowszych), na które klientka była zapisana sama.
  const last = (data ?? []).find((b) => (b.status === 'booked' || b.status === 'attended') && !b.guest_name && b.ends_at && new Date(b.ends_at).getTime() <= now);
  const due = last && now - new Date(last.ends_at).getTime() < WINDOW_MS && last.id !== seen;
  if (!due || paused) return null;
  return (
    <FeelingsCard
      className={last.class_name}
      onClose={() => {
        markSeen(last.id);
        setSeen(last.id);
      }}
    />
  );
}
