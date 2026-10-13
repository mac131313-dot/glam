// Grafik – dodatki (4.1, 4.11, M5): zajęcia specjalne i tematyczne poza szablonem, nieobecności trenerek
// z propozycją zastępstwa (kwalifikacje, brak kolizji), moje ustawienia trenerki (osobiste życzenia urodzinowe).
import { useState } from 'react';
import { can, type Role } from '@glam/core';
import { api, fmtLongDay, fmtTime, localDate, useApi } from '../api.ts';
import { Empty, Field, Spinner, Tabs, Toggle, useAction } from '../ui.tsx';

type Absence = { id: string; trainer_name: string; date_from: string; date_to: string; note: string | null; sessions: { id: string; starts_at: string; class_name: string; suggestions: { id: string; name: string }[] }[] };

export default function ScheduleExtras({ roles }: { roles: Role[] }) {
  const options: ['absences' | 'special' | 'me', string][] = [
    ['absences', 'Nieobecności i zastępstwa'],
    ...(can(roles, 'schedule.edit') ? ([['special', 'Zajęcia specjalne i tematyczne']] as ['special', string][]) : []),
    ...(roles.includes('trainer') ? ([['me', 'Moje ustawienia']] as ['me', string][]) : []),
  ];
  const [tab, setTab] = useState(options[0][0]);
  return (
    <div className="stack-lg">
      <h1>Zastępstwa i zajęcia specjalne</h1>
      <Tabs label="Grafik" value={tab} onChange={setTab} options={options} />
      {tab === 'absences' && <Absences roles={roles} />}
      {tab === 'special' && <Special />}
      {tab === 'me' && <TrainerSettings />}
    </div>
  );
}

function Absences({ roles }: { roles: Role[] }) {
  const list = useApi<Absence[]>('/staff/absences');
  const [from, setFrom] = useState(localDate());
  const [to, setTo] = useState(localDate());
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="eyebrow">Zgłoś nieobecność</div>
        <div className="row">
          <Field label="Od">
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Do">
            <input className="input" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <input className="input" placeholder="Notatka (opcjonalnie)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn" disabled={busy} onClick={() => run(() => api('/staff/absences', { method: 'POST', body: { from, to, note } }).then(list.reload), 'Zgłoszone – recepcja dostała propozycje zastępstw')}>
          Zgłoś
        </button>
      </section>
      {!list.data ? (
        <Spinner />
      ) : list.data.length === 0 ? (
        <Empty>Brak zgłoszonych nieobecności.</Empty>
      ) : (
        list.data.map((a) => (
          <section key={a.id} className="card stack">
            <div className="row between">
              <b>
                {a.trainer_name}: {a.date_from} – {a.date_to}
              </b>
              <button className="btn ghost sm" onClick={() => run(() => api(`/staff/absences/${a.id}`, { method: 'DELETE' }).then(list.reload))}>
                Usuń
              </button>
            </div>
            {a.note && <span className="small muted">{a.note}</span>}
            {a.sessions.length === 0 && <span className="small muted">Brak zajęć do obsadzenia.</span>}
            {a.sessions.map((s) => (
              <div key={s.id} className="row between small" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <span>
                  {fmtLongDay(s.starts_at)} {fmtTime(s.starts_at)} · {s.class_name}
                </span>
                {can(roles, 'schedule.edit') ? (
                  s.suggestions.length ? (
                    <span className="row" style={{ gap: 6 }}>
                      {s.suggestions.map((t) => (
                        <button key={t.id} className="btn sm" onClick={() => run(() => api(`/staff/sessions/${s.id}/trainer`, { method: 'POST', body: { trainerId: t.id } }).then(list.reload))}>
                          Zastępstwo: {t.name}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <span className="muted">brak wolnej trenerki – rozważ odwołanie</span>
                  )
                ) : (
                  <span className="muted">{s.suggestions.length ? `możliwe zastępstwo: ${s.suggestions.map((t) => t.name).join(', ')}` : 'czeka na decyzję'}</span>
                )}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function Special() {
  const cfg = useApi<{ classTypes: { id: string; name: string }[]; trainers: { id: string; name: string }[] }>('/owner/config');
  const themes = useApi<{ id: string; name: string }[]>('/owner/themes');
  const [f, setF] = useState({ classTypeId: '', trainerId: '', date: localDate(), time: '18:00', durationMin: 55, capacity: 10, title: '', kind: 'themed', themeId: '', public: true });
  const { run, busy } = useAction();
  if (!cfg.data) return <Spinner />;
  return (
    <section className="card stack" style={{ maxWidth: 620 }}>
      <p className="small muted" style={{ margin: 0 }}>Jednorazowe zajęcia poza szablonem – np. „Halloween Flow”, warsztat oddechowy, live do kursu. Zapisy i karnety działają jak zwykle.</p>
      <Field label="Nazwa (opcjonalnie – zamiast nazwy typu)">
        <input className="input" placeholder="Halloween Flow" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <div className="row">
        <select className="input" value={f.classTypeId} onChange={(e) => setF({ ...f, classTypeId: e.target.value })} aria-label="Typ zajęć">
          <option value="">Typ zajęć</option>
          {cfg.data.classTypes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input" value={f.trainerId} onChange={(e) => setF({ ...f, trainerId: e.target.value })} aria-label="Prowadząca">
          <option value="">Prowadząca</option>
          {cfg.data.trainers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Data" />
        <input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} aria-label="Godzina" />
        <input className="input" type="number" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} aria-label="Minuty" />
        <input className="input" type="number" value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} aria-label="Miejsca" />
      </div>
      <div className="chips">
        {[
          ['themed', 'Tematyczne (motyw)'],
          ['special', 'Specjalne'],
          ['live', 'Live (kurs)'],
        ].map(([v, l]) => (
          <button key={v} className="chip" aria-pressed={f.kind === v} onClick={() => setF({ ...f, kind: v })}>
            {l}
          </button>
        ))}
      </div>
      {f.kind === 'themed' && (
        <select className="input" value={f.themeId} onChange={(e) => setF({ ...f, themeId: e.target.value })} aria-label="Motyw">
          <option value="">Motyw (opcjonalnie)</option>
          {themes.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <Toggle label="Widoczne w grafiku klientek" checked={f.public} onChange={(v) => setF({ ...f, public: v })} />
      <button className="btn" disabled={!f.classTypeId || !f.trainerId || busy} onClick={() => run(() => api('/staff/sessions', { method: 'POST', body: { ...f, themeId: f.themeId || null } }), 'Zajęcia dodane do grafiku')}>
        Dodaj zajęcia
      </button>
    </section>
  );
}

function TrainerSettings() {
  const me = useApi<{ prefs: { birthdayWishes?: boolean }; bio: string | null }>('/staff/me');
  const [bio, setBio] = useState<string | null>(null);
  const { run } = useAction();
  if (!me.data) return <Spinner />;
  return (
    <section className="card stack" style={{ maxWidth: 560 }}>
      <Toggle
        label="Osobiste życzenia urodzinowe"
        hint="W dniu urodzin Twoich klientek wyślemy życzenia podpisane Twoim imieniem (szablon z sekcji 8.1). Zawsze możesz wyłączyć."
        checked={!!me.data.prefs.birthdayWishes}
        onChange={(v) => run(() => api('/staff/me', { method: 'PUT', body: { birthdayWishes: v } }).then(me.reload), 'Zapisane')}
      />
      <Field label="O mnie (widoczne dla klientek przy wyborze trenerki)">
        <textarea className="input" value={bio ?? me.data.bio ?? ''} onChange={(e) => setBio(e.target.value)} />
      </Field>
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={bio === null} onClick={() => run(() => api('/staff/me', { method: 'PUT', body: { bio } }).then(me.reload), 'Zapisane')}>
        Zapisz
      </button>
    </section>
  );
}
