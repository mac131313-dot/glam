// Creator Studio (5.4, K4–K6): kursy trenerek – szkic → beta dla testerek → akceptacja → publikacja,
// lekcje (wideo, link, tekst, live, zadanie, spotkanie stacjonarne) z dripem, pytania pod lekcjami, raport wypłat.
// Właścicielka: akceptacja, udział trenerki (domyślnie 70%), promocja zbiorcza.
import { useState } from 'react';
import { can, COURSE_KIND_LABEL, COURSE_STATUS_LABEL, COURSE_TRANSITIONS, type CourseKind, type CourseStatus, type Role } from '@glam/core';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Field, Page, readFile, Spinner, Stat, Tabs, Toggle, useAction } from '../ui.tsx';

type Lesson = { id: string; module: string; title: string; kind: string; duration_sec: number; unlock_day: number; free_preview: number; live_at: string | null; media_id: string | null; video_url: string | null };
type Course = {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  kind: CourseKind;
  level: string;
  status: CourseStatus;
  price_grosze: number | null;
  access_days: number | null;
  pass_discount: number;
  promo_pct: number;
  trainer_share: number;
  drip_days: number;
  review_note: string | null;
  author_id: string;
  updated_at: string;
  stats: { buyers: number; completed: number; rating: number | null; reviews: number; revenue: number; topModule: string | null };
  lessons: Lesson[];
};

const LESSON_KINDS: [string, string][] = [
  ['video', 'Wideo'],
  ['text', 'Tekst'],
  ['live', 'Live'],
  ['homework', 'Zadanie'],
  ['stationary', 'Spotkanie w studiu'],
];

export default function CreatorStudio({ roles }: { roles: Role[] }) {
  const owner = can(roles, 'courses.approve');
  const [tab, setTab] = useState<'courses' | 'questions' | 'payouts'>('courses');
  const list = useApi<Course[]>('/creator/courses');
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const { run } = useAction();
  if (list.error?.code === 'feature_off') return <Empty>Kursy nie są włączone w planie studia.</Empty>;
  const course = list.data?.find((c) => c.id === open);
  return (
    <div className="stack-lg">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Kursy</h1>
        <button className="btn" onClick={() => setOpen('new')}>
          + Nowy kurs
        </button>
      </div>
      <Tabs
        label="Kursy"
        value={tab}
        onChange={setTab}
        options={[
          ['courses', owner ? 'Wszystkie kursy' : 'Moje kursy'],
          ['questions', 'Pytania'],
          ['payouts', 'Przychody'],
        ]}
      />
      {tab === 'courses' && (
        <>
          {owner && (
            <div className="row wrap">
              <span className="small muted">Promocja zbiorcza:</span>
              {[0, 15, 25].map((p) => (
                <button key={p} className="chip" onClick={() => run(() => api('/owner/courses/promo', { method: 'POST', body: { pct: p } }).then((r) => (list.reload(), r)))}>
                  {p ? `–${p}%` : 'bez promocji'}
                </button>
              ))}
            </div>
          )}
          {!list.data ? (
            <Spinner />
          ) : list.data.length === 0 ? (
            <Empty>Nie ma jeszcze kursów. Zacznij od szkicu – opublikujesz po akceptacji.</Empty>
          ) : (
            list.data.map((c) => (
              <button key={c.id} className="card flat row between" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(c.id)}>
                <span>
                  <b>{c.title}</b>
                  <span className="small muted" style={{ display: 'block' }}>
                    {COURSE_KIND_LABEL[c.kind]} · {c.lessons.length} lekcji · {c.stats.buyers} uczestniczek {c.stats.rating ? `· ★ ${c.stats.rating}` : ''}
                  </span>
                </span>
                <span className={`badge ${c.status === 'pending' ? 'warn' : ''}`}>{COURSE_STATUS_LABEL[c.status]}</span>
              </button>
            ))
          )}
        </>
      )}
      {tab === 'questions' && <Questions />}
      {tab === 'payouts' && <Payouts />}
      {open === 'new' && (
        <Page title="Nowy kurs" onBack={() => setOpen(null)}>
          <CourseForm onSaved={async (id) => (await list.reload(), setOpen(id))} />
        </Page>
      )}
      {course && (
        <Page title={course.title} onBack={() => setOpen(null)}>
          <CourseDetail course={course} owner={owner} reload={list.reload} />
        </Page>
      )}
    </div>
  );
}

function CourseForm({ course, onSaved }: { course?: Course; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    title: course?.title ?? '',
    subtitle: course?.subtitle ?? '',
    description: course?.description ?? '',
    kind: course?.kind ?? ('video' as CourseKind),
    level: course?.level ?? 'Początkująca',
    price: course?.price_grosze ? String(course.price_grosze / 100) : '',
    accessDays: course?.access_days ? String(course.access_days) : '',
    passDiscount: course?.pass_discount ?? 0,
    dripDays: course?.drip_days ?? 0,
  });
  const { run, busy } = useAction();
  const save = () =>
    run(async () => {
      const body = { ...f, price: f.price ? Math.round(Number(f.price.replace(',', '.')) * 100) : null, accessDays: f.accessDays ? Number(f.accessDays) : null };
      if (course) {
        await api(`/creator/courses/${course.id}`, { method: 'PUT', body });
        onSaved(course.id);
      } else {
        const r = await api<{ id: string }>('/creator/courses', { method: 'POST', body });
        onSaved(r.id);
      }
    }, 'Zapisane');
  return (
    <div className="stack">
      <Field label="Tytuł">
        <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Mocny core w 4 tygodnie" />
      </Field>
      <Field label="Podtytuł">
        <input className="input" value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} />
      </Field>
      <Field label="Opis" hint="Bez obietnic medycznych – aplikacja zatrzyma słowa typu „wyleczy”.">
        <textarea className="input" style={{ minHeight: 90 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <div className="pill-row">
        {(Object.keys(COURSE_KIND_LABEL) as CourseKind[]).map((k) => (
          <button key={k} className="chip" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>
            {COURSE_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="row">
        <Field label="Poziom">
          <input className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} />
        </Field>
        <Field label="Cena zł (puste = w karnecie)">
          <input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </Field>
      </div>
      <div className="row">
        <Field label="Dostęp (dni, puste = bez limitu)">
          <input className="input" inputMode="numeric" value={f.accessDays} onChange={(e) => setF({ ...f, accessDays: e.target.value })} />
        </Field>
        <Field label="Zniżka z karnetem %">
          <input className="input" type="number" value={f.passDiscount} onChange={(e) => setF({ ...f, passDiscount: Number(e.target.value) })} />
        </Field>
        <Field label="Nowa lekcja co (dni)">
          <input className="input" type="number" value={f.dripDays} onChange={(e) => setF({ ...f, dripDays: Number(e.target.value) })} />
        </Field>
      </div>
      <button className="btn" disabled={!f.title || busy} onClick={save}>
        Zapisz kurs
      </button>
    </div>
  );
}

function CourseDetail({ course, owner, reload }: { course: Course; owner: boolean; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<'lessons' | 'edit' | 'stats'>('lessons');
  const [note, setNote] = useState('');
  const [testers, setTesters] = useState('');
  const clients = useApi<{ id: string; name: string }[]>(course.status === 'draft' ? '/staff/clients' : null);
  const { run } = useAction();
  const by = owner ? 'owner' : 'author';
  const moves = COURSE_TRANSITIONS[course.status].filter((t) => t.by === by || owner);
  const go = (to: CourseStatus) =>
    run(
      () =>
        api(`/creator/courses/${course.id}/status`, {
          method: 'POST',
          body: { to, note: note || undefined, testerIds: to === 'beta' ? testers.split(',').map((s) => s.trim()).filter(Boolean) : undefined },
        }).then(reload),
      `Status: ${COURSE_STATUS_LABEL[to]}`,
    );
  return (
    <div className="stack-lg">
      <div className="row wrap">
        <span className="badge">{COURSE_STATUS_LABEL[course.status]}</span>
        {course.review_note && <span className="small muted">Uwagi: {course.review_note}</span>}
      </div>
      <Tabs
        label="Kurs"
        value={tab}
        onChange={setTab}
        options={[
          ['lessons', 'Lekcje'],
          ['edit', 'Opis i cena'],
          ['stats', 'Statystyki'],
        ]}
      />
      {tab === 'lessons' && <Lessons course={course} reload={reload} />}
      {tab === 'edit' && (
        <>
          <CourseForm course={course} onSaved={() => reload()} />
          <label className="btn ghost" style={{ alignSelf: 'flex-start' }}>
            Okładka
            <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files?.[0] && run(async () => api(`/creator/courses/${course.id}/cover`, { method: 'PUT', body: { dataUrl: await readFile(e.target.files![0]) } }), 'Okładka zapisana')} />
          </label>
          {owner && <OwnerTerms course={course} reload={reload} />}
        </>
      )}
      {tab === 'stats' && (
        <div className="kpis">
          <Stat label="Uczestniczki" value={course.stats.buyers} hint={`ukończyło ${course.stats.completed}`} />
          <Stat label="Ocena" value={course.stats.rating ?? '—'} hint={`${course.stats.reviews} opinii`} />
          <Stat label="Przychód" value={`${(course.stats.revenue / 100).toFixed(0)} zł`} />
          <Stat label="Najchętniej oglądany moduł" value={course.stats.topModule ?? '—'} />
        </div>
      )}
      {moves.length > 0 && (
        <section className="card soft stack">
          <div className="eyebrow">Następny krok</div>
          {course.status === 'draft' && (
            <Field label="Testerki bety (id klientek, po przecinku)" hint={clients.data ? `np. ${clients.data.slice(0, 3).map((c) => `${c.name}: ${c.id}`).join(' · ')}` : undefined}>
              <input className="input" value={testers} onChange={(e) => setTesters(e.target.value)} />
            </Field>
          )}
          {owner && course.status === 'pending' && <input className="input" placeholder="Uwagi do poprawki (opcjonalnie)" value={note} onChange={(e) => setNote(e.target.value)} />}
          <div className="row wrap">
            {moves.map((m) => (
              <button key={m.to} className={m.to === 'archived' || m.to === 'suspended' ? 'btn ghost' : 'btn'} onClick={() => go(m.to)}>
                {m.to === 'pending' ? 'Wyślij do akceptacji' : m.to === 'beta' ? 'Beta dla testerek' : m.to === 'published' ? 'Opublikuj' : m.to === 'draft' ? 'Do poprawki' : COURSE_STATUS_LABEL[m.to]}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Lessons({ course, reload }: { course: Course; reload: () => Promise<void> }) {
  const [f, setF] = useState({ module: course.lessons.at(-1)?.module ?? 'Moduł 1', title: '', kind: 'video', body: '', videoUrl: '', unlockDay: 0, freePreview: false, liveAt: '' });
  const [video, setVideo] = useState<{ dataUrl: string; durationSec: number } | null>(null);
  const [attachment, setAttachment] = useState<string | null>(null);
  const { run, busy } = useAction();
  const pickVideo = async (file: File) => {
    const dataUrl = await readFile(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = URL.createObjectURL(file);
    v.onloadedmetadata = () => (setVideo({ dataUrl, durationSec: Math.round(v.duration) }), URL.revokeObjectURL(v.src));
  };
  const modules = [...new Set(course.lessons.map((l) => l.module))];
  return (
    <div className="stack-lg">
      {modules.map((m) => (
        <section key={m} className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">{m}</div>
          {course.lessons
            .filter((l) => l.module === m)
            .map((l) => (
              <div key={l.id} className="card flat row between">
                <span>
                  {l.title}
                  <span className="tiny muted" style={{ display: 'block' }}>
                    {LESSON_KINDS.find((k) => k[0] === l.kind)?.[1]} {l.duration_sec ? `· ${Math.round(l.duration_sec / 60)} min` : ''} {l.unlock_day ? `· dzień ${l.unlock_day}` : ''} {l.free_preview ? '· podgląd za darmo' : ''} {l.live_at ? `· live ${fmtDay(l.live_at)}` : ''}
                  </span>
                </span>
                <button className="link tiny" onClick={() => window.confirm('Usunąć lekcję?') && run(() => api(`/creator/lessons/${l.id}`, { method: 'DELETE' }).then(reload))}>
                  usuń
                </button>
              </div>
            ))}
        </section>
      ))}
      <section className="card stack">
        <div className="eyebrow">Nowa lekcja</div>
        <div className="row">
          <input className="input" placeholder="Moduł" value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })} />
          <input className="input" placeholder="Tytuł lekcji" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <div className="chips">
          {LESSON_KINDS.map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>
              {l}
            </button>
          ))}
        </div>
        {f.kind === 'video' && (
          <>
            <label className="btn ghost">
              {video ? `Wideo wybrane (${video.durationSec} s) ✓` : 'Wgraj wideo'}
              <input type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && pickVideo(e.target.files[0])} />
            </label>
            <input className="input" placeholder="…albo link https:// (Vimeo, YouTube niepubliczny)" value={f.videoUrl} onChange={(e) => setF({ ...f, videoUrl: e.target.value })} />
          </>
        )}
        {f.kind === 'live' && <input className="input" type="datetime-local" value={f.liveAt} onChange={(e) => setF({ ...f, liveAt: e.target.value })} aria-label="Termin live" />}
        {f.kind !== 'video' && <textarea className="input" placeholder="Treść, instrukcja zadania albo miejsce spotkania" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}
        <div className="row">
          <Field label="Odblokuj w dniu (0 = od razu)">
            <input className="input" type="number" value={f.unlockDay} onChange={(e) => setF({ ...f, unlockDay: Number(e.target.value) })} />
          </Field>
          <label className="btn ghost sm" style={{ alignSelf: 'flex-end' }}>
            {attachment ? 'PDF ✓' : 'Materiał PDF'}
            <input type="file" accept="application/pdf,image/*" hidden onChange={async (e) => e.target.files?.[0] && setAttachment(await readFile(e.target.files[0]))} />
          </label>
        </div>
        <Toggle label="Darmowy podgląd" checked={f.freePreview} onChange={(v) => setF({ ...f, freePreview: v })} />
        <button
          className="btn"
          disabled={!f.title || busy}
          onClick={() =>
            run(async () => {
              await api(`/creator/courses/${course.id}/lessons`, {
                method: 'POST',
                body: { ...f, videoUrl: f.videoUrl || undefined, liveAt: f.liveAt ? new Date(f.liveAt).toISOString() : null, video, attachment },
              });
              setF({ ...f, title: '', body: '', videoUrl: '' });
              setVideo(null);
              setAttachment(null);
              await reload();
            }, 'Lekcja dodana')
          }
        >
          Dodaj lekcję
        </button>
      </section>
    </div>
  );
}

function OwnerTerms({ course, reload }: { course: Course; reload: () => Promise<void> }) {
  const [share, setShare] = useState(course.trainer_share);
  const [promo, setPromo] = useState(course.promo_pct);
  const { run } = useAction();
  return (
    <section className="card soft stack">
      <div className="eyebrow">Warunki studia</div>
      <div className="row">
        <Field label="Udział trenerki %">
          <input className="input" type="number" value={share} onChange={(e) => setShare(Number(e.target.value))} />
        </Field>
        <Field label="Promocja %">
          <input className="input" type="number" value={promo} onChange={(e) => setPromo(Number(e.target.value))} />
        </Field>
      </div>
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => run(() => api(`/owner/courses/${course.id}`, { method: 'PUT', body: { trainerShare: share, promoPct: promo } }).then(reload), 'Zapisane')}>
        Zapisz warunki
      </button>
    </section>
  );
}

function Questions() {
  const list = useApi<{ id: string; body: string; answer: string | null; name: string; lesson: string; course: string; created_at: string }[]>('/creator/questions');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { run } = useAction();
  if (!list.data) return <Spinner />;
  if (!list.data.length) return <Empty>Brak pytań od uczestniczek.</Empty>;
  return (
    <div className="stack">
      {list.data.map((q) => (
        <section key={q.id} className="card flat stack" style={{ gap: 6 }}>
          <div className="tiny muted">
            {q.course} · {q.lesson} · {q.name} · {fmtDay(q.created_at)}
          </div>
          <div>{q.body}</div>
          {q.answer ? (
            <div className="small" style={{ borderLeft: '2px solid var(--line)', paddingLeft: 10 }}>
              {q.answer}
            </div>
          ) : (
            <div className="row">
              <input className="input" placeholder="Odpowiedź" value={draft[q.id] ?? ''} onChange={(e) => setDraft({ ...draft, [q.id]: e.target.value })} />
              <button className="btn sm" disabled={!draft[q.id]} onClick={() => run(() => api(`/creator/questions/${q.id}/answer`, { method: 'POST', body: { answer: draft[q.id] } }).then(list.reload), 'Wysłane')}>
                Odpowiedz
              </button>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function Payouts() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const r = useApi<{ month: string; note: string; rows: { course_id: string; title: string; author: string; sales: number; grossLabel: string; trainer: string; studio: string; trainer_share: number }[] }>(`/creator/payouts?month=${month}`);
  return (
    <div className="stack">
      <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 200 }} aria-label="Miesiąc" />
      {!r.data ? (
        <Spinner />
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Kurs</th>
                <th>Autorka</th>
                <th>Sprzedaż</th>
                <th>Brutto</th>
                <th>Trenerka</th>
                <th>Studio</th>
              </tr>
            </thead>
            <tbody>
              {r.data.rows.map((x) => (
                <tr key={x.course_id}>
                  <td>{x.title}</td>
                  <td>{x.author}</td>
                  <td>{x.sales}</td>
                  <td>{x.grossLabel}</td>
                  <td>
                    {x.trainer} <span className="tiny muted">({x.trainer_share}%)</span>
                  </td>
                  <td>{x.studio}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny muted">{r.data.note}</p>
        </>
      )}
    </div>
  );
}
