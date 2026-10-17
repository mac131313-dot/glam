// Kursy (5.3): katalog z filtrami, podgląd (zwiastun = darmowa lekcja, program, opinie), dostęp w karnecie lub zakup,
// odtwarzacz z tempem 0,75×/1×/1,25×, napisami, zapisem postępu i wznawianiem, pobranie offline, pytania pod lekcją,
// opinie po 30% kursu, certyfikat po ukończeniu.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PLAYBACK_RATES } from '@glam/core';
import { api, fmtDay, fmtLongDay, fmtTime, useApi } from '../api.ts';
import { Empty, PAYMENT_LABELS, Progress, Sheet, Spinner, STARS, Toggle, useAction, useThanks } from '../ui.tsx';
import { CastButton } from './CastButton.tsx';
import { useClient } from './ClientApp.tsx';
import { openAuthed } from './PassPages.tsx';
import type { RouteProps } from './router.tsx';

type Card = {
  id: string;
  title: string;
  subtitle: string | null;
  kindLabel: string;
  level: string;
  goal: string | null;
  dayPart: string | null;
  author: string;
  minutes: number;
  lessons: number;
  modules: string[];
  coverUrl: string | null;
  access: string | null;
  enrolled: boolean;
  progress: number;
  price: { full: string; final: string; discountPct: number } | null;
  paidSales: boolean;
  rating: number | null;
  reviews: number;
  recommended: boolean;
  contraindications: string | null;
  accessDays: number | null;
  seatsLeft: number | null;
};

export default function CoursePages({ route, arg }: RouteProps) {
  return route === 'course' && arg ? <CourseDetail id={arg} /> : <Catalog />;
}

function Catalog() {
  const { open } = useClient();
  const list = useApi<Card[]>('/courses');
  const [level, setLevel] = useState('');
  const [author, setAuthor] = useState('');
  const [goal, setGoal] = useState('');
  const [time, setTime] = useState('');
  const [part, setPart] = useState('');
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean))] as string[];
  const items = useMemo(
    () =>
      (list.data ?? []).filter(
        (c) => (!level || c.level === level) && (!author || c.author === author) && (!goal || c.goal === goal) && (!part || c.dayPart === part) && (!time || (time === 'short' ? c.minutes <= 60 : c.minutes > 60)),
      ),
    [list.data, level, author, goal, time, part],
  );
  if (list.error?.code === 'feature_off') return <Empty>Studio nie prowadzi jeszcze kursów online.</Empty>;
  if (!list.data) return <Spinner />;
  const Filter = ({ value, set, options, label }: { value: string; set: (v: string) => void; options: string[]; label: string }) =>
    options.length > 1 ? (
      <select className="input" style={{ minHeight: 40, padding: '6px 14px' }} value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    ) : null;
  return (
    <div className="stack-lg">
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        <Filter value={level} set={setLevel} options={uniq(list.data.map((c) => c.level))} label="Poziom" />
        <Filter value={author} set={setAuthor} options={uniq(list.data.map((c) => c.author))} label="Trenerka" />
        <Filter value={goal} set={setGoal} options={uniq(list.data.map((c) => c.goal))} label="Cel" />
        <Filter value={part} set={setPart} options={uniq(list.data.map((c) => c.dayPart))} label="Pora dnia" />
        <select className="input" style={{ minHeight: 40, padding: '6px 14px' }} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Czas">
          <option value="">Czas</option>
          <option value="short">do godziny</option>
          <option value="long">dłuższe</option>
        </select>
      </div>
      {items.length === 0 && <Empty>Nic nie pasuje do filtrów.</Empty>}
      {items.map((c) => (
        <button key={c.id} className="card stack" style={{ textAlign: 'left', cursor: 'pointer', gap: 8 }} onClick={() => open(`course/${c.id}`)}>
          {c.coverUrl && <img src={c.coverUrl} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 16 }} />}
          <div className="row between">
            <span className="eyebrow" style={{ margin: 0 }}>{c.kindLabel}</span>
            {c.recommended && <span className="badge accent">dla Ciebie</span>}
          </div>
          <div className="card-title">{c.title}</div>
          {c.subtitle && <div className="small muted">{c.subtitle}</div>}
          <div className="tiny muted">
            {c.author} · {c.level} · {c.lessons} lekcji · {c.minutes} min {c.rating ? `· ${STARS(c.rating)} (${c.reviews})` : ''}
          </div>
          {c.enrolled || c.access ? (
            <Progress value={c.progress} max={100} label="Postęp kursu" />
          ) : c.price && c.paidSales ? (
            <div className="small">
              {c.price.discountPct ? (
                <>
                  <s className="muted">{c.price.full}</s> <b>{c.price.final}</b> (–{c.price.discountPct}%)
                </>
              ) : (
                <b>{c.price.final}</b>
              )}
            </div>
          ) : (
            <span className="badge">w karnecie studia</span>
          )}
        </button>
      ))}
    </div>
  );
}

type Lesson = {
  id: string;
  module: string;
  title: string;
  kind: string;
  durationSec: number;
  freePreview: boolean;
  liveAt: string | null;
  unlocked: boolean;
  unlocksAt: string | null;
  body: string | null;
  videoUrl: string | null;
  captions: string | null;
  attachmentUrl: string | null;
  position: number;
  completed: boolean;
  questions: { id: string; body: string; answer: string | null; name: string; answered_by_name: string | null; mine: boolean }[];
};
type Detail = Card & {
  description: string | null;
  lessonsList: Lesson[];
  reviewsList: { rating: number; body: string | null; name: string; created_at: string }[];
  myReview: { rating: number; body: string | null } | null;
  canReview: boolean;
  certificate: { no: string; url: string } | null;
  bundle: { id: string; title: string }[];
};

function CourseDetail({ id }: { id: string }) {
  const { openShop } = useClient();
  const { data, reload } = useApi<Detail>(`/courses/${id}`);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [buy, setBuy] = useState(false);
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');
  const { run, busy } = useAction();
  const thanks = useThanks();
  if (!data) return <Spinner />;
  if (lesson) return <LessonView lesson={lesson} onBack={() => (setLesson(null), reload())} />;
  const hasAccess = !!data.access;
  const modules = [...new Set(data.lessonsList.map((l) => l.module))];
  return (
    <div className="stack-lg">
      {data.coverUrl && <img src={data.coverUrl} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 20 }} />}
      <div>
        <div className="eyebrow">{data.kindLabel} · {data.level}</div>
        <h1 style={{ fontSize: '1.8rem' }}>{data.title}</h1>
        <p className="muted">prowadzi {data.author} · {data.minutes} min · {data.rating ? `${STARS(data.rating)} (${data.reviews})` : 'nowy kurs'}</p>
        {data.description && <p>{data.description}</p>}
        {data.contraindications && <p className="small" style={{ color: 'var(--danger)' }}>Uwaga: {data.contraindications}</p>}
      </div>
      {!hasAccess && (
        <section className="card soft stack">
          {data.price && data.paidSales ? (
            <>
              <div className="row between">
                <span>{data.accessDays ? `Dostęp na ${data.accessDays} dni` : 'Dostęp bez limitu czasu'}</span>
                <b>{data.price.final}</b>
              </div>
              {data.seatsLeft !== null && <span className="tiny muted">Zostało miejsc: {data.seatsLeft}</span>}
              <button className="btn" onClick={() => setBuy(true)}>
                Kup kurs
              </button>
            </>
          ) : (
            <>
              <p style={{ margin: 0 }}>Ten kurs jest częścią karnetu studia.</p>
              <button className="btn" onClick={() => openShop('Kursy online są w karnecie studia.')}>
                Zobacz karnety
              </button>
            </>
          )}
          <p className="tiny muted" style={{ margin: 0 }}>Pierwszą lekcję obejrzysz za darmo.</p>
        </section>
      )}
      {hasAccess && !data.enrolled && (
        <button className="btn" disabled={busy} onClick={() => run(() => api(`/courses/${id}/enroll`, { method: 'POST', body: {} }).then((r) => (reload(), r)))}>
          Zaczynam kurs
        </button>
      )}
      {(data.enrolled || hasAccess) && <Progress value={data.progress} max={100} label="Postęp kursu" />}
      {data.certificate && (
        <a className="btn ghost" href={data.certificate.url} onClick={(e) => openAuthed(e, data.certificate!.url)}>
          Certyfikat ukończenia · {data.certificate.no}
        </a>
      )}
      {data.bundle.length > 0 && <p className="small">W pakiecie: {data.bundle.map((b) => b.title).join(', ')}</p>}
      <section className="stack">
        <div className="eyebrow">Program</div>
        {modules.map((m) => (
          <div key={m} className="stack" style={{ gap: 0 }}>
            <div className="small" style={{ fontWeight: 600, margin: '8px 0 4px' }}>{m}</div>
            {data.lessonsList
              .filter((l) => l.module === m)
              .map((l) => (
                <button key={l.id} className="list-row" disabled={!l.unlocked} onClick={() => setLesson(l)} style={{ opacity: l.unlocked ? 1 : 0.5 }}>
                  <span className="grow" style={{ textAlign: 'left' }}>
                    <span style={{ display: 'block' }}>
                      {l.completed ? '✓ ' : ''}
                      {l.title} {l.freePreview && !hasAccess && <span className="badge">za darmo</span>}
                    </span>
                    <span className="tiny muted">
                      {Math.round(l.durationSec / 60)} min
                      {l.liveAt && ` · live ${fmtLongDay(l.liveAt)} ${fmtTime(l.liveAt)}`}
                      {!l.unlocked && l.unlocksAt && ` · odblokuje się ${fmtDay(l.unlocksAt)}`}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        ))}
      </section>
      {data.canReview && (
        <section className="card stack">
          <div className="eyebrow">{data.myReview ? 'Twoja opinia' : 'Oceń kurs'}</div>
          <div className="rate-stars" role="radiogroup" aria-label="Ocena">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} z 5`} className={n <= rating ? 'is-on' : ''} onClick={() => setRating(n)} style={{ fontSize: 30, lineHeight: 1 }}>
                ★
              </button>
            ))}
          </div>
          <textarea className="input" placeholder={data.myReview?.body ?? 'Co Ci się podobało?'} value={review} onChange={(e) => setReview(e.target.value)} />
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => run(() => api(`/courses/${id}/review`, { method: 'PUT', body: { rating, body: review } }).then(() => (reload(), thanks())))}>
            Zapisz opinię
          </button>
        </section>
      )}
      {data.reviewsList.length > 0 && (
        <section className="stack">
          <div className="eyebrow">Opinie</div>
          {data.reviewsList.map((r, i) => (
            <div key={i} className="small">
              <b>{r.name}</b> {STARS(r.rating)}
              {r.body && <p style={{ margin: '2px 0 0' }}>{r.body}</p>}
            </div>
          ))}
        </section>
      )}
      {buy && <BuyCourse course={data} onClose={() => setBuy(false)} onDone={reload} />}
    </div>
  );
}

function BuyCourse({ course, onClose, onDone }: { course: Detail; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('blik');
  const [waive, setWaive] = useState(false);
  const [code, setCode] = useState('');
  const { run, busy } = useAction();
  return (
    <Sheet onClose={onClose} label="Kup kurs">
      <div className="stack">
        <h2>{course.title}</h2>
        <input className="input" placeholder="Kod rabatowy (opcjonalnie)" value={code} onChange={(e) => setCode(e.target.value)} />
        <div className="pill-row">
          {['blik', 'apple_pay', 'google_pay', 'p24', 'card'].map((m) => (
            <button key={m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>
        <Toggle label="Chcę dostęp od razu" hint="Rozumiem, że po rozpoczęciu dostępu do treści cyfrowych tracę prawo odstąpienia od umowy." checked={waive} onChange={setWaive} />
        <button
          className="btn block"
          disabled={!waive || busy}
          onClick={() => run(() => api(`/courses/${course.id}/enroll`, { method: 'POST', body: { method, waiveWithdrawal: waive, couponCode: code || undefined } }).then((r) => (onDone(), onClose(), r)))}
        >
          Zapłać {course.price?.final}
        </button>
      </div>
    </Sheet>
  );
}

function LessonView({ lesson, onBack }: { lesson: Lesson; onBack: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [rate, setRate] = useState(1);
  const [q, setQ] = useState('');
  const [offline, setOffline] = useState(false);
  const { run, busy } = useAction();
  const last = useRef(0);
  const captionsUrl = useMemo(() => (lesson.captions ? URL.createObjectURL(new Blob([lesson.captions], { type: 'text/vtt' })) : null), [lesson.captions]);
  // Podpis w query zmienia się co wydanie linku – offline trzymamy film pod samą ścieżką (tak szuka go sw.js).
  const offlineKey = (lesson.videoUrl ?? '').split('?')[0];
  const save = (completed = false) => api(`/lessons/${lesson.id}/progress`, { method: 'POST', body: { position: video.current?.currentTime ?? 0, completed } }).catch(() => {});
  useEffect(() => {
    if (video.current && lesson.position) video.current.currentTime = lesson.position;
    caches.open('glam-offline-media').then((c) => c.match(offlineKey)).then((hit) => setOffline(!!hit)).catch(() => {});
  }, [lesson]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = rate;
  }, [rate]);
  const isFile = lesson.videoUrl?.startsWith('/api/stream/');
  return (
    <div className="stack-lg">
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => (save(), onBack())}>
        ← Program kursu
      </button>
      <h2>{lesson.title}</h2>
      {lesson.videoUrl &&
        (isFile ? (
          <>
            <video
              ref={video}
              className="lesson-video"
              src={lesson.videoUrl}
              controls
              playsInline
              preload="metadata"
              x-webkit-airplay="allow"
              onTimeUpdate={() => {
                const t = video.current?.currentTime ?? 0;
                if (Math.abs(t - last.current) > 15) {
                  last.current = t;
                  save();
                }
              }}
              onEnded={() => save(true)}
            >
              {captionsUrl && <track kind="captions" srcLang="pl" label="Polski" src={captionsUrl} default />}
            </video>
            <div className="row between wrap">
              <div className="segmented" role="group" aria-label="Tempo">
                {PLAYBACK_RATES.map((r) => (
                  <button key={r} aria-pressed={rate === r} onClick={() => setRate(r)}>
                    {String(r).replace('.', ',')}×
                  </button>
                ))}
              </div>
              <button
                className="btn ghost sm"
                onClick={async () => {
                  const c = await caches.open('glam-offline-media');
                  if (offline) {
                    await c.delete(offlineKey);
                    setOffline(false);
                  } else {
                    const res = await fetch(lesson.videoUrl!);
                    if (res.ok) await c.put(offlineKey, res);
                    setOffline(res.ok);
                  }
                }}
              >
                {offline ? 'Usuń z urządzenia' : 'Pobierz offline'}
              </button>
              <CastButton videoRef={video} />
            </div>
          </>
        ) : (
          <a className="btn" href={lesson.videoUrl} target="_blank" rel="noreferrer">
            {lesson.kind === 'live' ? 'Dołącz do transmisji' : 'Otwórz wideo'}
          </a>
        ))}
      {lesson.liveAt && <p className="small">Live: {fmtLongDay(lesson.liveAt)}, {fmtTime(lesson.liveAt)} – nagranie pojawi się po transmisji.</p>}
      {lesson.body && <p style={{ whiteSpace: 'pre-wrap' }}>{lesson.body}</p>}
      {lesson.attachmentUrl && (
        <a className="btn ghost" href={lesson.attachmentUrl} onClick={(e) => openAuthed(e, lesson.attachmentUrl!)}>
          Materiały do pobrania
        </a>
      )}
      {!lesson.completed && (
        <button className="btn" onClick={() => run(() => save(true).then(onBack), 'Lekcja zaliczona ✓')}>
          Oznacz jako ukończoną
        </button>
      )}
      <section className="stack">
        <div className="eyebrow">Pytania pod lekcją</div>
        {lesson.questions.length === 0 && <p className="small muted" style={{ margin: 0 }}>Masz pytanie? Trenerka odpowie tutaj.</p>}
        {lesson.questions.map((x) => (
          <div key={x.id} className="card flat small stack" style={{ gap: 4 }}>
            <div>
              <b>{x.name}:</b> {x.body}
            </div>
            {x.answer && (
              <div style={{ paddingLeft: 12, borderLeft: '2px solid var(--brand)' }}>
                <b>{x.answered_by_name}:</b> {x.answer}
              </div>
            )}
          </div>
        ))}
        <div className="row">
          <input className="input" placeholder="Zadaj pytanie…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm" disabled={!q.trim() || busy} onClick={() => run(() => api(`/lessons/${lesson.id}/questions`, { method: 'POST', body: { body: q } }).then(() => setQ('')), 'Pytanie wysłane')}>
            Wyślij
          </button>
        </div>
      </section>
      <p className="tiny muted">Ćwicz w swoim zakresie. Treści ogólne – nie zastępują konsultacji lekarskiej.</p>
    </div>
  );
}
