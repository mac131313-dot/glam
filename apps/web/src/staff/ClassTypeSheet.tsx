// Nowe zajęcia / „Dla kogo” przy istniejących (Grafik i sale → Typy zajęć). Poziom, cel i grupy trafiają
// do karuzeli „Dopasowane do Ciebie” w Grafiku klientek (core/classfit).
import { useState } from 'react';
import { CLASS_LEVELS, FOCUS, FOR_WHOM, FOR_WHOM_CLASS, type ClassAudience } from '@glam/core';
import { api } from '../api.ts';
import { Select, Sheet, useAction } from '../ui.tsx';

export type ClassTypeRow = { id: string; name: string; zone_id: string; description?: string | null; audience: ClassAudience };

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function AudiencePicker({ value, onChange }: { value: ClassAudience; onChange: (a: ClassAudience) => void }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="field">
        <span className="field-label">Poziom</span>
        <div className="chips" style={{ flexWrap: 'wrap' }} role="radiogroup" aria-label="Poziom">
          {CLASS_LEVELS.map(([k, l]) => (
            <button key={k} type="button" className="chip" role="radio" aria-checked={value.level === k} aria-pressed={value.level === k} onClick={() => onChange({ ...value, level: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Co daje (możesz kilka)</span>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {FOCUS.map(([k, l]) => (
            <button key={k} type="button" className="chip" aria-pressed={value.focus.includes(k)} onClick={() => onChange({ ...value, focus: toggle(value.focus, k) })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Szczególnie polecane (opcjonalnie)</span>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {FOR_WHOM.map(([k]) => (
            <button key={k} type="button" className="chip" aria-pressed={value.forWhom.includes(k)} onClick={() => onChange({ ...value, forWhom: toggle(value.forWhom, k) })}>
              {FOR_WHOM_CLASS[k]}
            </button>
          ))}
        </div>
        <span className="tiny muted">Zajęcia oznaczone tylko „w ciąży” albo „po porodzie” podpowiemy wyłącznie tym klientkom.</span>
      </div>
    </div>
  );
}

/** Bez `classType` – tworzy nowe zajęcia; z `classType` – zmienia tylko „Dla kogo”. */
export function ClassTypeSheet({ classType, zones, onClose, onSaved }: { classType?: ClassTypeRow; zones: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(classType?.name ?? '');
  const [zoneId, setZoneId] = useState(classType?.zone_id ?? zones[0]?.id ?? '');
  const [description, setDescription] = useState(classType?.description ?? '');
  const [audience, setAudience] = useState<ClassAudience>(classType?.audience ?? { level: 'all', focus: [], forWhom: [] });
  const { run, busy } = useAction();

  const save = () =>
    run(
      () =>
        classType
          ? api(`/owner/class-types/${classType.id}`, { method: 'PUT', body: { audience } })
          : api('/owner/class-types', { method: 'POST', body: { name: name.trim(), zoneId, description: description.trim(), audience } }),
      classType ? 'Zapisane – klientki zobaczą to w podpowiedziach' : `${name.trim()} w ofercie – dodaj je teraz do grafiku`,
    ).then((r) => r && (onSaved(), onClose()));

  return (
    <Sheet onClose={onClose} label={classType ? `Dla kogo: ${classType.name}` : 'Nowe zajęcia'}>
      <div className="stack">
        <h2>{classType ? classType.name : 'Nowe zajęcia'}</h2>
        {!classType && (
          <>
            <div className="field">
              <label htmlFor="ct-name">Nazwa</label>
              <input id="ct-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Pilates na macie" />
            </div>
            {zones.length > 1 && (
              <div className="field">
                <label htmlFor="ct-zone">Sala</label>
                <Select id="ct-zone" value={zoneId} onChange={setZoneId} options={zones.map((z) => ({ value: z.id, label: z.name }))} />
              </div>
            )}
            <div className="field">
              <label htmlFor="ct-desc">Krótki opis (widzi klientka)</label>
              <input id="ct-desc" className="input" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="np. Spokojne tempo, wystarczy wygodny strój." />
            </div>
          </>
        )}
        <h3 style={{ margin: '6px 0 0' }}>Dla kogo?</h3>
        <AudiencePicker value={audience} onChange={setAudience} />
        <button className="btn block" disabled={busy || (!classType && (name.trim().length < 2 || !zoneId))} onClick={save}>
          {classType ? 'Zapisz' : 'Dodaj zajęcia'}
        </button>
      </div>
    </Sheet>
  );
}
