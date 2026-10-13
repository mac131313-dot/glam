// Grafik tygodnia (C7): siedem kolumn, klik w zajęcia = edycja, „+” w dniu = nowe zajęcia.
// Zapis od razu uzupełnia sesje na 4 tygodnie – bez osobnego „uzupełnij grafik”.
import { useState } from 'react';
import { WEEKDAY_LONG, WEEKDAY_SHORT, weekdaysLabel } from '@glam/core';
import { api, ApiError } from '../api.ts';
import { Sheet, useToast } from '../ui.tsx';

export type Template = {
  id: string;
  class_type_id: string;
  trainer_id: string;
  weekday: number;
  start_time: string;
  duration_min: number;
  capacity: number;
  class_name: string;
  trainer_name: string;
};
export type BoardConfig = {
  classTypes: { id: string; name: string; color: string }[];
  trainers: { id: string; name: string }[];
  templates: Template[];
};

const DAYS = [1, 2, 3, 4, 5, 6, 7];

type Draft = { classTypeId: string; trainerId: string; weekdays: number[]; startTime: string; durationMin: number; capacity: number };
type Outcome = { created: number; kept: number; cancelled: number };

/** Podpowiedź dla nowego slotu: jak te zajęcia są już ustawione w grafiku (czas, miejsca, trenerka). */
function defaultsFor(config: BoardConfig, classTypeId: string): Pick<Draft, 'durationMin' | 'capacity' | 'trainerId'> {
  const t = config.templates.find((x) => x.class_type_id === classTypeId);
  return { durationMin: t?.duration_min ?? 55, capacity: t?.capacity ?? 10, trainerId: t?.trainer_id ?? config.trainers[0]?.id ?? '' };
}

function outcomeText(o: Outcome, verb: string) {
  const parts = [verb];
  if (o.kept) parts.push(`${o.kept} z zapisami zostają w starym terminie`);
  if (o.cancelled) parts.push(`${o.cancelled} odwołane, klientki dostały zwrot i powiadomienie`);
  return parts.join(' · ');
}

export function WeekBoard({ config, onChange }: { config: BoardConfig; onChange: () => void }) {
  const [open, setOpen] = useState<{ mode: 'new'; day: number } | { mode: 'edit'; slot: Template } | null>(null);
  const color = (ctId: string) => config.classTypes.find((c) => c.id === ctId)?.color ?? 'var(--line)';

  return (
    <section className="card stack">
      <div className="row between wrap">
        <div>
          <h3 style={{ margin: 0 }}>Tydzień w studiu</h3>
          <p className="small muted" style={{ margin: 0 }}>Kliknij zajęcia, żeby je zmienić. Zmiany od razu trafiają do grafiku klientek.</p>
        </div>
        <button className="btn sm" onClick={() => setOpen({ mode: 'new', day: 1 })}>
          + Dodaj zajęcia
        </button>
      </div>

      <div className="week-board">
        {DAYS.map((d) => (
          <div key={d} className="week-day">
            <div className="eyebrow">{WEEKDAY_LONG[d]}</div>
            {config.templates
              .filter((t) => t.weekday === d)
              .map((t) => (
                <button
                  key={t.id}
                  className="week-slot"
                  title={`${t.class_name} · ${t.start_time}, ${t.duration_min} min · ${t.trainer_name} · ${t.capacity} miejsc`}
                  onClick={() => setOpen({ mode: 'edit', slot: t })}
                >
                  <span className="week-dot" style={{ background: color(t.class_type_id) }} />
                  <b>{t.start_time}</b>
                  <span>{t.class_name}</span>
                  <span className="small muted">{t.trainer_name}</span>
                </button>
              ))}
            <button className="week-add" aria-label={`Dodaj zajęcia: ${WEEKDAY_LONG[d]}`} onClick={() => setOpen({ mode: 'new', day: d })}>
              +
            </button>
          </div>
        ))}
      </div>

      {open && (
        <SlotSheet
          config={config}
          slot={open.mode === 'edit' ? open.slot : null}
          day={open.mode === 'new' ? open.day : open.slot.weekday}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            onChange();
          }}
        />
      )}
    </section>
  );
}

function SlotSheet({ config, slot, day, onClose, onSaved }: { config: BoardConfig; slot: Template | null; day: number; onClose: () => void; onSaved: () => void }) {
  const firstType = config.classTypes[0]?.id ?? '';
  const [d, setD] = useState<Draft>(() =>
    slot
      ? { classTypeId: slot.class_type_id, trainerId: slot.trainer_id, weekdays: [slot.weekday], startTime: slot.start_time, durationMin: slot.duration_min, capacity: slot.capacity }
      : { classTypeId: firstType, weekdays: [day], startTime: '18:00', ...defaultsFor(config, firstType) },
  );
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const toggleDay = (n: number) =>
    slot ? set({ weekdays: [n] }) : set({ weekdays: d.weekdays.includes(n) ? d.weekdays.filter((x) => x !== n) : [...d.weekdays, n].sort((a, b) => a - b) });
  const className = config.classTypes.find((c) => c.id === d.classTypeId)?.name ?? '';

  const run = async (fn: () => Promise<Outcome>, verb: string) => {
    setBusy(true);
    try {
      toast(outcomeText(await fn(), verb));
      onSaved();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    slot
      ? run(
          () =>
            api(`/owner/templates/${slot.id}`, {
              method: 'PUT',
              body: { trainerId: d.trainerId, weekday: d.weekdays[0], startTime: d.startTime, durationMin: d.durationMin, capacity: d.capacity },
            }),
          'Zmiany zapisane',
        )
      : run(() => api('/owner/templates', { method: 'POST', body: d }), `${className} w grafiku`);

  const remove = () => {
    if (!slot || !confirm(`Zdjąć ${slot.class_name} (${WEEKDAY_SHORT[slot.weekday]} ${slot.start_time}) z grafiku od dziś?`)) return;
    run(() => api(`/owner/templates/${slot.id}`, { method: 'DELETE' }), 'Zajęcia zdjęte z grafiku');
  };

  return (
    <Sheet onClose={onClose} label={slot ? 'Zmiana zajęć' : 'Nowe zajęcia'}>
      <div className="stack">
        <h2>{slot ? slot.class_name : 'Nowe zajęcia'}</h2>

        {!slot && (
          <div className="field">
            <label>Zajęcia</label>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {config.classTypes.map((c) => (
                <button key={c.id} className="chip" aria-pressed={d.classTypeId === c.id} onClick={() => set({ classTypeId: c.id, ...defaultsFor(config, c.id) })}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label>{slot ? 'Dzień' : 'Dni (możesz wybrać kilka)'}</label>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {DAYS.map((n) => (
              <button key={n} className="chip" aria-pressed={d.weekdays.includes(n)} onClick={() => toggleDay(n)}>
                {WEEKDAY_SHORT[n]}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <div className="field grow">
            <label htmlFor="ss-time">Godzina</label>
            <input id="ss-time" type="time" step={300} className="input" value={d.startTime} onChange={(e) => set({ startTime: e.target.value })} />
          </div>
          <div className="field grow">
            <label htmlFor="ss-dur">Czas (min)</label>
            <input id="ss-dur" type="number" min={10} step={5} className="input" value={d.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })} />
          </div>
          <div className="field grow">
            <label htmlFor="ss-cap">Miejsca</label>
            <input id="ss-cap" type="number" min={1} className="input" value={d.capacity} onChange={(e) => set({ capacity: Number(e.target.value) })} />
          </div>
        </div>

        <div className="field">
          <label>Prowadzi</label>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {config.trainers.map((t) => (
              <button key={t.id} className="chip" aria-pressed={d.trainerId === t.id} onClick={() => set({ trainerId: t.id })}>
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <p className="small muted" style={{ margin: 0 }}>
          {d.weekdays.length ? `${className} · ${weekdaysLabel(d.weekdays)} ${d.startTime}` : 'Wybierz dzień'} · od dziś, co tydzień.
          {slot && ' Sesje bez zapisów przesuną się od razu.'}
        </p>

        <button className="btn block" disabled={busy || !d.weekdays.length || !d.trainerId} onClick={save}>
          {slot ? 'Zapisz zmiany' : 'Dodaj do grafiku'}
        </button>
        {slot && (
          <button className="btn danger block" disabled={busy} onClick={remove}>
            Zdejmij z grafiku
          </button>
        )}
      </div>
    </Sheet>
  );
}
