// Grafik tygodnia (C7): siedem kolumn, klik w zajęcia = edycja, „+” w dniu = nowe zajęcia.
// Zapis od razu uzupełnia sesje na 4 tygodnie – bez osobnego „uzupełnij grafik”.
import { Fragment, useState } from 'react';
import { WEEKDAY_LONG, WEEKDAY_SHORT, weekdaysLabel } from '@glam/core';
import { api, ApiError } from '../api.ts';
import { Select, Sheet, useToast } from '../ui.tsx';

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

function endTime(start: string, durationMin: number) {
  const [h, m] = start.split(':').map(Number);
  const end = (h * 60 + m + durationMin) % (24 * 60);
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

function outcomeText(o: Outcome, verb: string) {
  const parts = [verb];
  if (o.kept) parts.push(`${o.kept} z zapisami zostają w starym terminie`);
  if (o.cancelled) parts.push(`${o.cancelled} odwołane, klientki dostały zwrot i powiadomienie`);
  return parts.join(' · ');
}

export function WeekBoard({ config, onChange }: { config: BoardConfig; onChange: () => void }) {
  const [open, setOpen] = useState<{ mode: 'new'; day: number; time?: string } | { mode: 'edit'; slot: Template } | null>(null);
  // Wiersze = godziny rozpoczęcia, kolumny = dni: zajęcia o tej samej porze stoją w jednej linii.
  const times = [...new Set(config.templates.map((t) => t.start_time))].sort();
  const today = new Date().getDay() || 7;
  const at = (day: number, time: string) => config.templates.filter((t) => t.weekday === day && t.start_time === time);
  const count = (day: number) => config.templates.filter((t) => t.weekday === day).length;

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

      <div className="wb-scroll">
        <div className="wb">
          <div />
          {DAYS.map((d) => (
            <div key={d} className={`wb-head${d === today ? ' today' : ''}`}>
              <span className="wb-day">{WEEKDAY_LONG[d]}</span>
              <span className="wb-count">{count(d) ? `${count(d)} zajęć` : 'wolne'}</span>
            </div>
          ))}
          {times.map((time) => (
            <Fragment key={time}>
              <div className="wb-time">{time}</div>
              {DAYS.map((d) => (
                <div key={d} className={`wb-cell${d === today ? ' today' : ''}`}>
                  {at(d, time).map((t) => (
                    <button
                      key={t.id}
                      className="wb-slot"
                      title={`${t.class_name} · ${t.start_time}–${endTime(t.start_time, t.duration_min)} · ${t.trainer_name} · ${t.capacity} miejsc`}
                      onClick={() => setOpen({ mode: 'edit', slot: t })}
                    >
                      <span className="wb-name">{t.class_name}</span>
                      <span className="wb-meta">
                        {t.trainer_name} · {t.duration_min} min
                      </span>
                    </button>
                  ))}
                  <button className="wb-add" aria-label={`Dodaj zajęcia: ${WEEKDAY_LONG[d]} ${time}`} onClick={() => setOpen({ mode: 'new', day: d, time })}>
                    +
                  </button>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>

      {open && (
        <SlotSheet
          config={config}
          slot={open.mode === 'edit' ? open.slot : null}
          day={open.mode === 'new' ? open.day : open.slot.weekday}
          time={open.mode === 'new' ? open.time : undefined}
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

function SlotSheet({ config, slot, day, time, onClose, onSaved }: { config: BoardConfig; slot: Template | null; day: number; time?: string; onClose: () => void; onSaved: () => void }) {
  const firstType = config.classTypes[0]?.id ?? '';
  const [d, setD] = useState<Draft>(() =>
    slot
      ? { classTypeId: slot.class_type_id, trainerId: slot.trainer_id, weekdays: [slot.weekday], startTime: slot.start_time, durationMin: slot.duration_min, capacity: slot.capacity }
      : { classTypeId: firstType, weekdays: [day], startTime: time ?? '18:00', ...defaultsFor(config, firstType) },
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
            <label htmlFor="ss-class">Zajęcia</label>
            <Select
              id="ss-class"
              value={d.classTypeId}
              options={config.classTypes.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => set({ classTypeId: v, ...defaultsFor(config, v) })}
            />
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
          <label htmlFor="ss-trainer">Prowadzi</label>
          <Select id="ss-trainer" value={d.trainerId} options={config.trainers.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => set({ trainerId: v })} />
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
