// Strona sprzedażowa kursu w panelu (/s/:slug/kurs/:id): treści marketingowe, edycje z datami sprzedaży i dostępu,
// pakiety do tabeli porównawczej, prowadzące i eksperci, kto prowadzi którą lekcję. Puste pola = sekcja na stronie się chowa.
import { useState } from 'react';
import type { CoursePage } from '@glam/core';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Field, readFile, Spinner, Toggle, useAction } from '../ui.tsx';

type Edition = { id: string; name: string; theme: string | null; salesFrom: string | null; salesUntil: string | null; startsAt: string | null; accessUntil: string | null; news: { title: string; body: string }[]; state: 'upcoming' | 'on_sale' | 'closed'; enrollments: number };
type Tier = { id: string; name: string; priceGrosze: number; features: string[]; highlight: boolean; seatLimit: number | null; active: boolean; sold: number };
type Person = { id: string; userId: string | null; name: string; role: 'author' | 'trainer' | 'expert'; title: string | null; bio: string | null; photoUrl: string | null };
type Editor = {
  slug: string;
  sitePublished: boolean;
  status: string;
  page: CoursePage;
  editions: Edition[];
  tiers: Tier[];
  people: Person[];
  lessons: { id: string; module: string; title: string; personId: string | null }[];
  staff: { id: string; name: string }[];
};

const STATE_LABEL: Record<Edition['state'], string> = { upcoming: 'zapowiedź', on_sale: 'w sprzedaży', closed: 'sprzedaż zakończona' };
const ROLE_LABEL: Record<Person['role'], string> = { author: 'Autorka', trainer: 'Trenerka', expert: 'Ekspertka' };

/** ISO → wartość pola datetime-local (czas lokalny przeglądarki) i z powrotem. */
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

export default function CoursePageEditor({ courseId }: { courseId: string }) {
  const r = useApi<Editor>(`/creator/courses/${courseId}/page`);
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!r.data) return <Spinner />;
  const d = r.data;
  const url = `/s/${encodeURIComponent(d.slug)}/kurs/${encodeURIComponent(courseId)}`;
  const live = d.sitePublished && d.status === 'published';
  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <span className="small muted">{live ? `${location.host}${url}` : !d.sitePublished ? 'Strona studia nie jest jeszcze opublikowana – kurs pokaże się po jej publikacji.' : 'Strona kursu będzie widoczna po publikacji kursu.'}</span>
        {live && (
          <a className="btn ghost sm" href={url} target="_blank" rel="noopener">
            Zobacz stronę
          </a>
        )}
      </div>
      <PageTexts courseId={courseId} page={d.page} />
      <Editions courseId={courseId} editions={d.editions} reload={r.reload} />
      <Tiers courseId={courseId} tiers={d.tiers} reload={r.reload} />
      <People courseId={courseId} data={d} reload={r.reload} />
    </div>
  );
}

function PageTexts({ courseId, page }: { courseId: string; page: CoursePage }) {
  const [f, setF] = useState({ promise: page.promise, outcomes: page.outcomes.join('\n'), forWhom: page.forWhom.join('\n'), equipment: page.equipment });
  const [faq, setFaq] = useState(page.faq.length ? page.faq : [{ q: '', a: '' }]);
  const { run, busy } = useAction();
  const save = () =>
    run(async () => {
      const r = await api<{ page: CoursePage }>(`/creator/courses/${courseId}/page`, { method: 'PUT', body: { ...f, outcomes: lines(f.outcomes), forWhom: lines(f.forWhom), faq } });
      setFaq(r.page.faq.length ? r.page.faq : [{ q: '', a: '' }]);
    }, 'Treści strony zapisane');
  return (
    <section className="card stack">
      <div className="eyebrow">Treści strony</div>
      <Field label="Obietnica w nagłówku" hint="Jedno zdanie. Bez obietnic medycznych – aplikacja zatrzyma słowa typu „wyleczy”.">
        <input className="input" value={f.promise} onChange={(e) => setF({ ...f, promise: e.target.value })} placeholder="Wszystko, by zbudować zdrową rutynę" />
      </Field>
      <Field label="Co zyskasz" hint="Jeden punkt w linii.">
        <textarea className="input" style={{ minHeight: 90 }} value={f.outcomes} onChange={(e) => setF({ ...f, outcomes: e.target.value })} />
      </Field>
      <Field label="Dla kogo" hint="Jeden punkt w linii.">
        <textarea className="input" style={{ minHeight: 70 }} value={f.forWhom} onChange={(e) => setF({ ...f, forWhom: e.target.value })} />
      </Field>
      <Field label="Sprzęt">
        <input className="input" value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })} placeholder="mata, mała piłka i krzesło" />
      </Field>
      <div className="stack gap-2">
        <span className="field-label">Pytania i odpowiedzi</span>
        {faq.map((x, i) => (
          <div key={i} className="card flat stack gap-2">
            <input className="input" placeholder="Pytanie" value={x.q} onChange={(e) => setFaq(faq.map((y, j) => (j === i ? { ...y, q: e.target.value } : y)))} />
            <textarea className="input" placeholder="Odpowiedź" value={x.a} onChange={(e) => setFaq(faq.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)))} />
            <button className="link tiny" style={{ alignSelf: 'flex-end' }} onClick={() => setFaq(faq.filter((_, j) => j !== i))}>
              usuń pytanie
            </button>
          </div>
        ))}
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setFaq([...faq, { q: '', a: '' }])}>
          Dodaj pytanie
        </button>
      </div>
      <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={save}>
        Zapisz treści
      </button>
    </section>
  );
}

function Editions({ courseId, editions, reload }: { courseId: string; editions: Edition[]; reload: () => Promise<void> }) {
  const [open, setOpen] = useState<string | 'new' | null>(null);
  return (
    <section className="card stack">
      <div className="row between">
        <div className="eyebrow">Edycje</div>
        <button className="btn ghost sm" onClick={() => setOpen('new')}>
          Nowa edycja
        </button>
      </div>
      {!editions.length && open !== 'new' && <p className="small muted">Bez edycji kurs jest w sprzedaży cały czas. Edycja to daty sprzedaży, startu i końca dostępu w jednym miejscu.</p>}
      {editions.map((e) =>
        open === e.id ? (
          <EditionForm key={e.id} courseId={courseId} edition={e} done={() => (setOpen(null), reload())} />
        ) : (
          <button key={e.id} className="card flat row between" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(e.id)}>
            <span>
              <b>{e.name}</b>
              <span className="tiny muted" style={{ display: 'block' }}>
                {e.salesFrom ? `sprzedaż od ${fmtDay(e.salesFrom)}` : 'sprzedaż otwarta'}
                {e.salesUntil ? ` do ${fmtDay(e.salesUntil)}` : ''}
                {e.accessUntil ? ` · dostęp do ${fmtDay(e.accessUntil)}` : ''} · {e.enrollments} uczestniczek
              </span>
            </span>
            <span className="badge">{STATE_LABEL[e.state]}</span>
          </button>
        ),
      )}
      {open === 'new' && <EditionForm courseId={courseId} done={() => (setOpen(null), reload())} />}
    </section>
  );
}

function EditionForm({ courseId, edition, done }: { courseId: string; edition?: Edition; done: () => void }) {
  const [f, setF] = useState({
    name: edition?.name ?? '',
    theme: edition?.theme ?? '',
    salesFrom: toLocal(edition?.salesFrom ?? null),
    salesUntil: toLocal(edition?.salesUntil ?? null),
    startsAt: toLocal(edition?.startsAt ?? null),
    accessUntil: toLocal(edition?.accessUntil ?? null),
  });
  const [news, setNews] = useState(edition?.news.length ? edition.news : [{ title: '', body: '' }]);
  const { run, busy } = useAction();
  const body = { ...f, salesFrom: fromLocal(f.salesFrom), salesUntil: fromLocal(f.salesUntil), startsAt: fromLocal(f.startsAt), accessUntil: fromLocal(f.accessUntil), news };
  const date = (k: 'salesFrom' | 'salesUntil' | 'startsAt' | 'accessUntil', label: string) => (
    <Field label={label}>
      <input className="input" type="datetime-local" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <div className="card soft stack">
      <div className="row">
        <Field label="Nazwa">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Edycja jesienna" />
        </Field>
        <Field label="Temat edycji">
          <input className="input" value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })} placeholder="zdrowa rutyna" />
        </Field>
      </div>
      <div className="row wrap">
        {date('salesFrom', 'Sprzedaż od')}
        {date('salesUntil', 'Sprzedaż do')}
      </div>
      <div className="row wrap">
        {date('startsAt', 'Start kursu')}
        {date('accessUntil', 'Dostęp do')}
      </div>
      <span className="tiny muted">Puste daty sprzedaży = sprzedaż otwarta. Koniec dostępu skraca „dostęp w dniach” z opisu kursu, jeśli wypada wcześniej.</span>
      <div className="stack gap-2">
        <span className="field-label">Nowości w tej edycji</span>
        {news.map((n, i) => (
          <div key={i} className="row">
            <input className="input" placeholder="Tytuł" value={n.title} onChange={(e) => setNews(news.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <input className="input" placeholder="Krótki opis" value={n.body} onChange={(e) => setNews(news.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
          </div>
        ))}
        <button className="link tiny" style={{ alignSelf: 'flex-start' }} onClick={() => setNews([...news, { title: '', body: '' }])}>
          dodaj nowość
        </button>
      </div>
      <div className="row wrap">
        <button
          className="btn sm"
          disabled={!f.name.trim() || busy}
          onClick={() => run(async () => (edition ? await api(`/creator/editions/${edition.id}`, { method: 'PUT', body }) : await api(`/creator/courses/${courseId}/editions`, { method: 'POST', body }), done()), 'Edycja zapisana')}
        >
          Zapisz edycję
        </button>
        <button className="btn ghost sm" onClick={done}>
          Anuluj
        </button>
        {edition && (
          <button
            className="link tiny"
            disabled={busy}
            onClick={() => window.confirm(`Usunąć edycję „${edition.name}”?`) && run(async () => (await api(`/creator/editions/${edition.id}`, { method: 'DELETE' }), done()), 'Edycja usunięta')}
          >
            usuń edycję
          </button>
        )}
      </div>
    </div>
  );
}

function Tiers({ courseId, tiers, reload }: { courseId: string; tiers: Tier[]; reload: () => Promise<void> }) {
  const [open, setOpen] = useState<string | 'new' | null>(null);
  return (
    <section className="card stack">
      <div className="row between">
        <div className="eyebrow">Pakiety</div>
        <button className="btn ghost sm" onClick={() => setOpen('new')}>
          Nowy pakiet
        </button>
      </div>
      {!tiers.length && open !== 'new' && <p className="small muted">Dodaj co najmniej jeden pakiet, żeby kurs dało się kupić na stronie. Cechy pakietów tworzą tabelę porównawczą.</p>}
      {tiers.map((t) =>
        open === t.id ? (
          <TierForm key={t.id} courseId={courseId} tier={t} done={() => (setOpen(null), reload())} />
        ) : (
          <button key={t.id} className="card flat row between" style={{ textAlign: 'left', cursor: 'pointer', opacity: t.active ? 1 : 0.6 }} onClick={() => setOpen(t.id)}>
            <span>
              <b>{t.name}</b> · {(t.priceGrosze / 100).toFixed(2).replace('.', ',')} zł
              <span className="tiny muted" style={{ display: 'block' }}>
                {t.features.length} cech · sprzedanych {t.sold}
                {t.seatLimit ? ` z ${t.seatLimit}` : ''}
              </span>
            </span>
            <span className="row gap-2">
              {t.highlight && <span className="badge">wyróżniony</span>}
              {!t.active && <span className="badge">ukryty</span>}
            </span>
          </button>
        ),
      )}
      {open === 'new' && <TierForm courseId={courseId} done={() => (setOpen(null), reload())} />}
    </section>
  );
}

function TierForm({ courseId, tier, done }: { courseId: string; tier?: Tier; done: () => void }) {
  const [f, setF] = useState({
    name: tier?.name ?? '',
    price: tier ? String(tier.priceGrosze / 100).replace('.', ',') : '',
    features: tier?.features.join('\n') ?? '',
    highlight: tier?.highlight ?? false,
    seatLimit: tier?.seatLimit ? String(tier.seatLimit) : '',
    active: tier?.active ?? true,
  });
  const { run, busy } = useAction();
  const price = Math.round(Number(f.price.replace(',', '.')) * 100);
  const body = { name: f.name, price, features: lines(f.features), highlight: f.highlight, seatLimit: f.seatLimit ? Number(f.seatLimit) : null, active: f.active };
  return (
    <div className="card soft stack">
      <div className="row">
        <Field label="Nazwa">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Standard" />
        </Field>
        <Field label="Cena zł">
          <input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </Field>
        <Field label="Limit miejsc (puste = bez)">
          <input className="input" inputMode="numeric" value={f.seatLimit} onChange={(e) => setF({ ...f, seatLimit: e.target.value })} />
        </Field>
      </div>
      <Field label="Co zawiera" hint="Jedna cecha w linii. Cechy wspólne wszystkich pakietów trafiają na górę tabeli – pisz je tak samo w każdym pakiecie.">
        <textarea className="input" style={{ minHeight: 90 }} value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} />
      </Field>
      <Toggle label="Wyróżniony" hint="Polecany pakiet – zaznaczony na stronie." checked={f.highlight} onChange={(v) => setF({ ...f, highlight: v })} />
      {tier && <Toggle label="Widoczny na stronie" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />}
      <div className="row wrap">
        <button
          className="btn sm"
          disabled={!f.name.trim() || !f.price || !(price >= 0) || busy}
          onClick={() => run(async () => (tier ? await api(`/creator/tiers/${tier.id}`, { method: 'PUT', body }) : await api(`/creator/courses/${courseId}/tiers`, { method: 'POST', body }), done()), 'Pakiet zapisany')}
        >
          Zapisz pakiet
        </button>
        <button className="btn ghost sm" onClick={done}>
          Anuluj
        </button>
        {tier && (
          <button
            className="link tiny"
            disabled={busy}
            onClick={() =>
              window.confirm(tier.sold ? `Pakiet „${tier.name}” ma sprzedaż – zostanie ukryty ze strony, zapisy zostają. Kontynuować?` : `Usunąć pakiet „${tier.name}”?`) &&
              run(async () => {
                const r = await api<{ message: string }>(`/creator/tiers/${tier.id}`, { method: 'DELETE' });
                done();
                return r;
              })
            }
          >
            {tier.sold ? 'ukryj pakiet' : 'usuń pakiet'}
          </button>
        )}
      </div>
    </div>
  );
}

function People({ courseId, data, reload }: { courseId: string; data: Editor; reload: () => Promise<void> }) {
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const { run } = useAction();
  const modules = [...new Set(data.lessons.map((l) => l.module))];
  return (
    <section className="card stack">
      <div className="row between">
        <div className="eyebrow">Prowadzące i ekspertki</div>
        <button className="btn ghost sm" onClick={() => setOpen('new')}>
          Dodaj osobę
        </button>
      </div>
      {data.people.map((p) =>
        open === p.id ? (
          <PersonForm key={p.id} courseId={courseId} person={p} staff={data.staff} done={() => (setOpen(null), reload())} />
        ) : (
          <button key={p.id} className="card flat row" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(p.id)}>
            {p.photoUrl ? <img src={p.photoUrl} alt="" width={40} height={40} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : null}
            <span>
              <b>{p.name}</b>
              <span className="tiny muted" style={{ display: 'block' }}>
                {ROLE_LABEL[p.role]}
                {p.title ? ` · ${p.title}` : ''}
                {p.userId ? ' · konto w studiu' : ''}
              </span>
            </span>
          </button>
        ),
      )}
      {open === 'new' && <PersonForm courseId={courseId} staff={data.staff} done={() => (setOpen(null), reload())} />}
      {data.people.length > 0 && data.lessons.length > 0 && (
        <div className="stack gap-2">
          <span className="field-label">Kto prowadzi lekcje</span>
          {modules.map((m) => (
            <div key={m} className="stack gap-1">
              <div className="tiny muted">{m}</div>
              {data.lessons
                .filter((l) => l.module === m)
                .map((l) => (
                  <div key={l.id} className="row between">
                    <span className="small">{l.title}</span>
                    <select
                      className="input"
                      style={{ maxWidth: 220 }}
                      aria-label={`Prowadząca lekcji ${l.title}`}
                      value={l.personId ?? ''}
                      onChange={(e) => run(() => api(`/creator/lessons/${l.id}/person`, { method: 'PUT', body: { personId: e.target.value || null } }).then(reload))}
                    >
                      <option value="">bez prowadzącej</option>
                      {data.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PersonForm({ courseId, person, staff, done }: { courseId: string; person?: Person; staff: Editor['staff']; done: () => void }) {
  const [f, setF] = useState({ userId: person?.userId ?? '', name: person?.name ?? '', role: person?.role ?? ('trainer' as Person['role']), title: person?.title ?? '', bio: person?.bio ?? '' });
  const [photo, setPhoto] = useState<string | null>(null);
  const { run, busy } = useAction();
  const save = () =>
    run(async () => {
      const body = { ...f, userId: f.userId || null };
      const pid = person ? (await api(`/creator/people/${person.id}`, { method: 'PUT', body }), person.id) : (await api<{ id: string }>(`/creator/courses/${courseId}/people`, { method: 'POST', body })).id;
      if (photo) await api(`/creator/people/${pid}/photo`, { method: 'PUT', body: { dataUrl: photo } });
      done();
    }, 'Zapisane');
  return (
    <div className="card soft stack">
      <Field label="Konto w studiu" hint="Osoba z kontem pokaże zdjęcie z profilu, jeśli nie wgrasz osobnego. Gościnna ekspertka nie potrzebuje konta.">
        <select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value, name: f.name || staff.find((s) => s.id === e.target.value)?.name || '' })}>
          <option value="">bez konta (gość)</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="row">
        <Field label="Imię i nazwisko">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Tytuł">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="fizjoterapeutka" />
        </Field>
      </div>
      <div className="pill-row">
        {(Object.keys(ROLE_LABEL) as Person['role'][]).map((r) => (
          <button key={r} className="chip" aria-pressed={f.role === r} onClick={() => setF({ ...f, role: r })}>
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      <Field label="Bio" hint="Kilka zdań o doświadczeniu. Bez obietnic medycznych.">
        <textarea className="input" style={{ minHeight: 80 }} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
      </Field>
      <label className="btn ghost sm" style={{ alignSelf: 'flex-start' }}>
        {photo ? 'Zdjęcie wybrane' : person?.photoUrl ? 'Zmień zdjęcie' : 'Zdjęcie'}
        <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => e.target.files?.[0] && setPhoto(await readFile(e.target.files[0]))} />
      </label>
      <div className="row wrap">
        <button className="btn sm" disabled={!(f.name.trim() || f.userId) || busy} onClick={save}>
          Zapisz osobę
        </button>
        <button className="btn ghost sm" onClick={done}>
          Anuluj
        </button>
        {person && (
          <button className="link tiny" disabled={busy} onClick={() => window.confirm(`Usunąć ${person.name} z kursu? Lekcje zostaną bez prowadzącej.`) && run(async () => (await api(`/creator/people/${person.id}`, { method: 'DELETE' }), done()), 'Usunięte')}>
            usuń z kursu
          </button>
        )}
      </div>
    </div>
  );
}
