// Publiczna strona studia: /s/:slug. Wizytówka zasilana danymi z GLAM (wygląd, grafik, zajęcia, trenerki).
// Zapisy i zakupy prowadzą do aplikacji klientki (/app) – strona niczego nie rezerwuje sama.
import { useEffect, useMemo, useState } from 'react';
import type { Look } from '@glam/core';
import { Icon } from '../icons.tsx';
import { applyLook } from '../look.ts';
import { StudioBrand } from '../StudioBrand.tsx';
import { Spinner } from '../ui.tsx';
import './site.css';

type PublicSession = { id: string; startsAt: string; endsAt: string; classTypeId: string; className: string; trainer: string; zone: string; kind: string; spotsLeft: number };
type PublicClass = { id: string; name: string; level: string | null; color: string; description: string | null; photoUrl: string | null; zone: string };
type PublicTrainer = { id: string; name: string; bio: string | null; avatarUrl: string | null; classes: string[] };
type PublicStudio = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  tagline: string | null;
  logo: string;
  logoUrl: string | null;
  logoWide: boolean;
  look: Look;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  joinCode: string;
  hours: { weekday: number; from: string; to: string }[];
  faq: { q: string; a: string }[];
  modules: { events: boolean; courses: boolean; shop: boolean };
  trainers: PublicTrainer[];
  classes: PublicClass[];
  schedule: { from: string; sessions: PublicSession[] };
};

/** Aplikacja klientki – tam są logowanie, rezerwacje i płatności. */
const APP_URL = '/app';
const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

/**
 * Napis przy wolnych miejscach w grafiku. To decyzja „sprzedażowa”: ile miejsc to już „ostatnie”,
 * czy pokazywać dokładną liczbę, co z pełnymi zajęciami (lista oczekujących jest w aplikacji).
 */
export function spotsLabel(spotsLeft: number): { text: string; tone: 'calm' | 'last' | 'full' } {
  if (spotsLeft <= 0) return { text: 'Lista oczekujących', tone: 'full' };
  if (spotsLeft <= 2) return { text: spotsLeft === 1 ? 'Ostatnie miejsce' : 'Ostatnie 2 miejsca', tone: 'last' };
  return { text: `Wolne miejsca: ${spotsLeft}`, tone: 'calm' };
}

export function StudioSite({ slug }: { slug: string }) {
  const [studio, setStudio] = useState<PublicStudio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/studios/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.message ?? 'Nie udało się wczytać strony.');
        return data as PublicStudio;
      })
      .then((s) => {
        setStudio(s);
        applyLook(s.look);
        document.title = s.tagline ? `${s.name} – ${s.tagline}` : s.name;
      })
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  if (error)
    return (
      <main className="site-state">
        <div className="wordmark">glam</div>
        <p className="muted">{error}</p>
        <a className="btn ghost sm" href="/">
          Wróć
        </a>
      </main>
    );
  if (!studio)
    return (
      <main className="site-state">
        <Spinner />
      </main>
    );

  return (
    <div className="site">
      <SiteNav studio={studio} />
      <Hero studio={studio} />
      <About studio={studio} />
      <ScheduleSection studio={studio} />
      <ClassesSection studio={studio} />
      <TrainersSection studio={studio} />
      <MoreSection studio={studio} />
      <Footer studio={studio} />
    </div>
  );
}

function SiteNav({ studio }: { studio: PublicStudio }) {
  return (
    <header className="site-nav">
      <a className="site-brand" href="#top" aria-label={`${studio.name} – początek strony`}>
        <StudioBrand studio={studio} scale={1.1} />
      </a>
      <nav className="site-links" aria-label="Sekcje strony">
        <a href="#studio">Studio</a>
        <a href="#grafik">Grafik</a>
        <a href="#zajecia">Zajęcia</a>
        <a href="#trenerki">Trenerki</a>
      </nav>
      <a className="btn sm" href={APP_URL}>
        Zapisz się
      </a>
    </header>
  );
}

function Hero({ studio }: { studio: PublicStudio }) {
  const fmt = useFormatters(studio.timezone);
  const now = Date.now();
  const next = studio.schedule.sessions.filter((s) => new Date(s.startsAt).getTime() > now).slice(0, 3);
  return (
    <section className="site-hero" id="top">
      <div className="site-hero-text">
        <div className="eyebrow">{studio.city ? `Studio ruchu · ${studio.city}` : 'Studio ruchu'}</div>
        <h1 className="site-title">
          {studio.name}
          {studio.tagline && <span className="serif"> {lowerFirst(studio.tagline)}</span>}
        </h1>
        <p className="site-lead muted">Zapisy, karnety i grafik masz w jednej aplikacji. Wybierz zajęcia, zarezerwuj miejsce i przyjdź – resztą zajmiemy się my.</p>
        <div className="row wrap">
          <a className="btn" href={APP_URL}>
            Zapisz się na zajęcia <Icon name="chevron" size={18} />
          </a>
          <a className="btn ghost" href="#grafik">
            Zobacz grafik
          </a>
        </div>
      </div>
      <aside className="site-hero-card" aria-label="Najbliższe zajęcia">
        <div className="eyebrow">Najbliżej w studiu</div>
        {next.length === 0 ? (
          <p className="muted small">Grafik na ten tydzień jeszcze się układa.</p>
        ) : (
          <ul className="site-next">
            {next.map((s) => (
              <li key={s.id}>
                <span className="site-next-time">{fmt.time(s.startsAt)}</span>
                <span className="grow">
                  <span className="site-next-name">{s.className}</span>
                  <span className="tiny muted">
                    {fmt.dayShort(s.startsAt)} · prowadzi {s.trainer}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </section>
  );
}

function About({ studio }: { studio: PublicStudio }) {
  const zones = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of studio.classes) m.set(c.zone, (m.get(c.zone) ?? 0) + 1);
    return [...m.entries()];
  }, [studio.classes]);
  return (
    <section className="site-section" id="studio">
      <div className="site-head">
        <div className="eyebrow">Studio</div>
        <h2 className="site-h2">
          Ruch, który <span className="serif">jest dla Ciebie</span>
        </h2>
      </div>
      <div className="site-about">
        <div className="stack">
          <p className="site-prose">
            {studio.tagline ? `${studio.tagline}. ` : ''}
            {studio.trainers.length > 0 && `${studio.trainers.length} ${plural(studio.trainers.length, 'trenerka', 'trenerki', 'trenerek')} i ${studio.classes.length} ${plural(studio.classes.length, 'rodzaj', 'rodzaje', 'rodzajów')} zajęć – od pierwszych kroków po trening dla zaawansowanych.`}
          </p>
          <div className="site-zones">
            {zones.map(([zone, n]) => (
              <div key={zone} className="site-zone">
                <span className="site-zone-n display">{n}</span>
                <span className="small">
                  {plural(n, 'rodzaj zajęć', 'rodzaje zajęć', 'rodzajów zajęć')}
                  <br />
                  <span className="muted">{zone}</span>
                </span>
              </div>
            ))}
          </div>
          {studio.faq.length > 0 && (
            <div className="site-faq">
              {studio.faq.map((f) => (
                <details key={f.q}>
                  <summary>
                    {f.q}
                    <Icon name="plus" size={18} />
                  </summary>
                  <p className="muted">{f.a}</p>
                </details>
              ))}
            </div>
          )}
        </div>
        <ContactCard studio={studio} />
      </div>
    </section>
  );
}

function ContactCard({ studio }: { studio: PublicStudio }) {
  const days = new Map<number, string[]>();
  for (const h of studio.hours) days.set(h.weekday, [...(days.get(h.weekday) ?? []), `${h.from}–${h.to}`]);
  return (
    <aside className="site-contact card soft">
      <div className="eyebrow">Recepcja</div>
      <dl className="site-hours">
        {[...days.entries()].map(([d, ranges]) => (
          <div key={d}>
            <dt>{WEEKDAYS[d % 7]}</dt>
            <dd>{ranges.join(', ')}</dd>
          </div>
        ))}
      </dl>
      <hr className="hairline" />
      <div className="stack" style={{ gap: 8 }}>
        {studio.address && <span className="small">{studio.address}</span>}
        {studio.phone && (
          <a className="small" href={`tel:${studio.phone.replace(/\s/g, '')}`}>
            {studio.phone}
          </a>
        )}
        {studio.email && (
          <a className="small" href={`mailto:${studio.email}`}>
            {studio.email}
          </a>
        )}
      </div>
    </aside>
  );
}

function ScheduleSection({ studio }: { studio: PublicStudio }) {
  const fmt = useFormatters(studio.timezone);
  const days = useMemo(() => {
    const m = new Map<string, PublicSession[]>();
    for (const s of studio.schedule.sessions) {
      const key = fmt.dateKey(s.startsAt);
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return m;
  }, [studio.schedule.sessions, fmt]);
  const keys = nextDays(studio.schedule.from, 7);
  const [day, setDay] = useState(keys[0]);
  const list = days.get(day) ?? [];
  const now = Date.now();

  return (
    <section className="site-section" id="grafik">
      <div className="site-head row between wrap">
        <div>
          <div className="eyebrow">Grafik</div>
          <h2 className="site-h2">
            Ten <span className="serif">tydzień</span>
          </h2>
        </div>
        <a className="btn ghost sm" href={APP_URL}>
          Pełny grafik w aplikacji
        </a>
      </div>
      <div className="site-days" role="group" aria-label="Dzień tygodnia">
        {keys.map((k) => {
          const d = new Date(`${k}T12:00:00Z`);
          return (
            <button key={k} className="day" aria-pressed={k === day} onClick={() => setDay(k)}>
              {WEEKDAYS[d.getUTCDay()].slice(0, 3)}
              <b>{d.getUTCDate()}</b>
            </button>
          );
        })}
      </div>
      {list.length === 0 ? (
        <p className="site-empty muted">Tego dnia nie ma zajęć w grafiku. Zajrzyj na inny dzień.</p>
      ) : (
        <ul className="site-schedule">
          {list.map((s) => {
            const past = new Date(s.startsAt).getTime() < now;
            const spots = spotsLabel(s.spotsLeft);
            return (
              <li key={s.id} className={past ? 'past' : undefined}>
                <span className="site-slot-time">
                  {fmt.time(s.startsAt)}
                  <span className="tiny muted">{minutes(s.startsAt, s.endsAt)} min</span>
                </span>
                <span className="grow">
                  <span className="site-slot-name">{s.className}</span>
                  <span className="small muted">
                    prowadzi {s.trainer} · {s.zone}
                  </span>
                </span>
                {past ? (
                  <span className="tiny muted">Zakończone</span>
                ) : (
                  <>
                    <span className={`site-spots tiny ${spots.tone}`}>{spots.text}</span>
                    <a className="btn quiet sm" href={APP_URL} aria-label={`Zapisz się: ${s.className}, ${fmt.time(s.startsAt)}`}>
                      Zapisz się
                    </a>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ClassesSection({ studio }: { studio: PublicStudio }) {
  const zones = [...new Set(studio.classes.map((c) => c.zone))];
  const [zone, setZone] = useState<string | null>(null);
  const list = studio.classes.filter((c) => !zone || c.zone === zone);
  const trainersOf = (id: string) => studio.trainers.filter((t) => t.classes.includes(id)).map((t) => t.name);
  return (
    <section className="site-section" id="zajecia">
      <div className="site-head">
        <div className="eyebrow">Zajęcia</div>
        <h2 className="site-h2">
          Znajdź <span className="serif">swój ruch</span>
        </h2>
      </div>
      {zones.length > 1 && (
        <div className="chips" role="group" aria-label="Sala">
          <button className="chip" aria-pressed={zone === null} onClick={() => setZone(null)}>
            Wszystkie
          </button>
          {zones.map((z) => (
            <button key={z} className="chip" aria-pressed={zone === z} onClick={() => setZone(z)}>
              {z}
            </button>
          ))}
        </div>
      )}
      <div className="site-classes">
        {list.map((c) => {
          const who = trainersOf(c.id);
          return (
            <article key={c.id} className="site-class">
              {c.photoUrl ? <img src={c.photoUrl} alt="" loading="lazy" /> : <span className="site-class-dot" style={{ background: c.color }} aria-hidden="true" />}
              {c.level && <div className="eyebrow">{c.level}</div>}
              <h3>{c.name}</h3>
              {c.description && <p className="small muted">{c.description}</p>}
              {who.length > 0 && <p className="tiny muted site-class-who">prowadzi {who.join(', ')}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TrainersSection({ studio }: { studio: PublicStudio }) {
  if (studio.trainers.length === 0) return null;
  const className = (id: string) => studio.classes.find((c) => c.id === id)?.name;
  return (
    <section className="site-section" id="trenerki">
      <div className="site-head">
        <div className="eyebrow">Zespół</div>
        <h2 className="site-h2">
          Nasze <span className="serif">trenerki</span>
        </h2>
      </div>
      <div className="site-trainers">
        {studio.trainers.map((t) => {
          const names = [...new Set(t.classes.map(className).filter(Boolean))];
          return (
            <article key={t.id} className="site-trainer">
              <div className="site-trainer-photo">{t.avatarUrl ? <img src={t.avatarUrl} alt="" loading="lazy" /> : <span className="display">{t.name.charAt(0)}</span>}</div>
              <h3>{t.name}</h3>
              {t.bio && <p className="small muted">{t.bio}</p>}
              {names.length > 0 && (
                <p className="tiny muted">
                  {names.slice(0, 3).join(' · ')}
                  {names.length > 3 && ` +${names.length - 3}`}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Odnośniki do podstron, które dojdą w kolejnym etapie (wydarzenia, kursy, sklep). */
function MoreSection({ studio }: { studio: PublicStudio }) {
  const items = [
    studio.modules.events && { icon: 'sparkle' as const, title: 'Wydarzenia', hint: 'Warsztaty, wieczory w studiu i prywatne imprezy.' },
    studio.modules.courses && { icon: 'play' as const, title: 'Kursy online', hint: 'Trenuj z nami także w domu, we własnym tempie.' },
    studio.modules.shop && { icon: 'bag' as const, title: 'Sklep', hint: 'Akcesoria i vouchery na prezent.' },
  ].filter(Boolean) as { icon: 'sparkle' | 'play' | 'bag'; title: string; hint: string }[];
  if (items.length === 0) return null;
  return (
    <section className="site-section">
      <div className="site-head">
        <div className="eyebrow">Więcej</div>
        <h2 className="site-h2">
          Poza <span className="serif">salą</span>
        </h2>
      </div>
      <div className="site-more">
        {items.map((i) => (
          <div key={i.title} className="site-more-item" aria-disabled="true">
            <Icon name={i.icon} size={22} />
            <div className="grow">
              <h3>{i.title}</h3>
              <p className="small muted">{i.hint}</p>
            </div>
            <span className="tiny muted site-soon">wkrótce</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer({ studio }: { studio: PublicStudio }) {
  return (
    <footer className="site-footer">
      <div className="site-cta card">
        <h2 className="site-h2">
          Do zobaczenia <span className="serif">na macie</span>
        </h2>
        <p className="muted">
          Dołącz do studia w aplikacji kodem <span className="code">{studio.joinCode}</span>.
        </p>
        <a className="btn" href={APP_URL}>
          Otwórz aplikację <Icon name="chevron" size={18} />
        </a>
      </div>
      <div className="site-footer-row tiny muted">
        <span>
          © {new Date().getFullYear()} {studio.name}
          {studio.address ? ` · ${studio.address}` : ''}
        </span>
        <span>
          działa na <span className="serif">glam</span>
        </span>
      </div>
    </footer>
  );
}

// ——— pomocnicze ———

function useFormatters(timeZone: string) {
  return useMemo(() => {
    const time = new Intl.DateTimeFormat('pl-PL', { timeZone, hour: '2-digit', minute: '2-digit' });
    const dayShort = new Intl.DateTimeFormat('pl-PL', { timeZone, weekday: 'long', day: 'numeric', month: 'long' });
    const key = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return {
      time: (iso: string) => time.format(new Date(iso)),
      dayShort: (iso: string) => dayShort.format(new Date(iso)),
      dateKey: (iso: string) => key.format(new Date(iso)),
    };
  }, [timeZone]);
}

function nextDays(from: string, n: number) {
  const start = new Date(`${from}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

const minutes = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Polska odmiana liczebników: 1 trenerka, 2 trenerki, 5 trenerek. */
function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}
