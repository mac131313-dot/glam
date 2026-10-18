// Publiczna strona sprzedażowa kursu: /s/:slug/kurs/:id. Wzór: audyt landingu STRETCH&GLOW – bierzemy jego
// kolejność (hero z liczbami → efekty → program → prowadzące → dla kogo → pakiety → FAQ → autorka → stopka),
// ale naprawiamy błędy: program moduł po module z liczbą treningów, ceny w tabeli, daty edycji w jednym miejscu,
// a sekcja bez danych po prostu się nie pokazuje. Wygląd jak strona studia (site.css): minimalizm, Isola / Unbound.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { CoursePage, Look } from '@glam/core';
import { goToCheckout } from '../api.ts';
import { applyLook } from '../look.ts';
import { StudioBrand } from '../StudioBrand.tsx';
import { PAYMENT_LABELS, Spinner } from '../ui.tsx';
import './site.css';

type Tier = { id: string; name: string; features: string[]; highlight: boolean; price: string; fullPrice: string | null; grosze: number; seatsLeft: number | null };
type Person = { id: string; name: string; role: 'author' | 'trainer' | 'expert'; title: string | null; bio: string | null; photoUrl: string | null };
type PublicCourse = {
  studio: { slug: string; name: string; city: string | null; look: Look; logo: string; logoUrl: string | null; logoWide: boolean; email: string | null; phone: string | null; address: string | null; nip: string | null; timezone: string; regulations: string | null };
  course: { id: string; title: string; subtitle: string | null; description: string | null; level: string; contraindications: string | null; coverUrl: string | null; lessons: number; minutes: number; averageMinutes: number | null; accessDays: number | null };
  page: CoursePage;
  edition: { id: string; name: string; theme: string | null; salesFrom: string | null; salesUntil: string | null; startsAt: string | null; accessUntil: string | null; news: { title: string; body: string }[]; state: 'upcoming' | 'on_sale' | 'closed' } | null;
  salesOpen: boolean;
  trailer: { title: string; url: string | null; minutes: number } | null;
  modules: { name: string; lessons: number; minutes: number; people: string[]; titles: string[] }[];
  calendar: { day: number; minutes: number; lessons: string[] }[];
  people: Person[];
  tiers: Tier[];
  comparison: { feature: string; tiers: Record<string, boolean>; common: boolean }[];
  passProducts: { id: string; name: string; price: string }[];
  paymentMethods: string[];
};

const APP_URL = '/app';
const ROLE: Record<Person['role'], string> = { author: 'autorka kursu', trainer: 'trenerka', expert: 'ekspertka' };

export function CourseSite({ slug, courseId }: { slug: string; courseId: string }) {
  const [data, setData] = useState<PublicCourse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<Tier | null>(null);
  const returned = useCheckoutReturn(slug, courseId);

  useEffect(() => {
    fetch(`/api/public/studios/${encodeURIComponent(slug)}/courses/${encodeURIComponent(courseId)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.message ?? 'Nie udało się wczytać strony kursu.');
        setData(body as PublicCourse);
      })
      .catch((e: Error) => setError(e.message));
  }, [slug, courseId]);

  useEffect(() => {
    if (!data) return;
    applyLook(data.studio.look);
    document.title = `${data.course.title} – ${data.studio.name}`;
    const meta = document.querySelector('meta[name="description"]') ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'description' }));
    meta.setAttribute('content', data.page.promise || data.course.subtitle || data.course.title);
  }, [data]);

  if (error)
    return (
      <main className="site-state">
        <div className="wordmark">glam</div>
        <p className="muted">{error}</p>
        <a className="btn ghost sm" href={`/s/${encodeURIComponent(slug)}`}>
          Strona studia
        </a>
      </main>
    );
  if (!data)
    return (
      <main className="site-state">
        <Spinner />
      </main>
    );

  const author = data.people.find((p) => p.role === 'author') ?? null;
  const team = data.people.filter((p) => p !== author);
  const nav = [
    data.modules.length > 0 && ['program', 'Program'],
    team.length > 0 && ['prowadzace', 'Prowadzące'],
    (data.tiers.length > 0 || data.passProducts.length > 0) && ['pakiety', 'Pakiety'],
    ['faq', 'FAQ'],
  ].filter(Boolean) as [string, string][];

  return (
    <div className="site course-site">
      <header className="site-nav">
        <a className="site-brand" href={`/s/${encodeURIComponent(data.studio.slug)}`} aria-label={`${data.studio.name} – strona studia`}>
          {data.studio.logoUrl ? <StudioBrand studio={data.studio} scale={1} /> : <span className="site-wordmark">{data.studio.name}</span>}
        </a>
        <nav className="site-links" aria-label="Sekcje strony">
          {nav.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <a className="btn sm" href={data.tiers.length && data.salesOpen ? '#pakiety' : APP_URL}>
          {data.tiers.length && data.salesOpen ? 'Wybierz pakiet' : 'Aplikacja'}
        </a>
      </header>
      <main>
        <Hero data={data} />
        <Outcomes data={data} />
        <Program data={data} />
        <Team people={team} />
        <ForWhom data={data} />
        <Offers data={data} onBuy={setBuying} />
        <Faq data={data} />
        {author && <Author person={author} />}
        <LegalFooter data={data} />
      </main>
      {buying && <Checkout data={data} tier={buying} onClose={() => setBuying(null)} />}
      {returned.state && <CheckoutReturn state={returned.state} onClose={returned.close} />}
    </div>
  );
}

// ——— formatowanie ———

function useDates(timeZone: string) {
  return useMemo(() => {
    const day = new Intl.DateTimeFormat('pl-PL', { timeZone, day: 'numeric', month: 'long' });
    const full = new Intl.DateTimeFormat('pl-PL', { timeZone, day: 'numeric', month: 'long', year: 'numeric' });
    return { day: (iso: string) => day.format(new Date(iso)), full: (iso: string) => full.format(new Date(iso)) };
  }, [timeZone]);
}

const plural = (n: number, one: string, few: string, many: string) => {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
};

function Section({ id, name, eyebrow, title, serif, children, className }: { id: string; name: string; eyebrow?: string; title: string; serif?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} data-section-name={name} className={`site-section${className ? ` ${className}` : ''}`}>
      <div className="site-head">
        <div>
          {eyebrow && <div className="site-eyebrow">{eyebrow}</div>}
          <h2 className="site-h2">
            {title}
            {serif && <span className="serif"> {serif}</span>}
          </h2>
        </div>
      </div>
      {children}
    </section>
  );
}

// ——— sekcje ———

function Hero({ data }: { data: PublicCourse }) {
  const d = useDates(data.studio.timezone);
  const [playing, setPlaying] = useState(false);
  const e = data.edition;
  // Liczby z hero (audyt: temat, czas edycji, średni trening). Każda tylko, gdy jest z czego ją policzyć.
  const stats = [
    e?.theme && { label: 'Temat edycji', value: e.theme },
    e?.salesUntil && { label: e.state === 'closed' ? 'Sprzedaż zakończona' : 'Zapisy do', value: d.day(e.salesUntil) },
    e?.state === 'upcoming' && e.salesFrom && { label: 'Zapisy od', value: d.day(e.salesFrom) },
    data.course.averageMinutes && { label: 'Średni trening', value: `${data.course.averageMinutes} min` },
    data.course.lessons > 0 && { label: plural(data.course.lessons, 'Trening', 'Treningi', 'Treningów'), value: String(data.course.lessons) },
  ].filter(Boolean) as { label: string; value: string }[];
  const t = data.trailer;

  return (
    <section id="start" data-section-name="Nagłówek" className="site-hero course-hero">
      <div className="course-hero-grid">
        <div className="site-hero-text">
          <div className="site-eyebrow">{[data.studio.name, e?.name].filter(Boolean).join(' · ')}</div>
          <h1 className="site-title">
            {data.course.title}
            {(data.page.promise || data.course.subtitle) && <span className="serif"> {data.page.promise || data.course.subtitle}</span>}
          </h1>
          {data.course.description && <p className="site-lead">{data.course.description}</p>}
          <div className="site-actions">
            {data.tiers.length > 0 && data.salesOpen && (
              <a className="btn" href="#pakiety">
                Wybierz pakiet
              </a>
            )}
            {t &&
              (t.url ? (
                <button type="button" className="site-link course-linkbtn" onClick={() => setPlaying(true)}>
                  Darmowa lekcja{t.minutes ? ` · ${t.minutes} min` : ''}
                </button>
              ) : (
                <a className="site-link" href={APP_URL}>
                  Darmowa lekcja w aplikacji
                </a>
              ))}
          </div>
        </div>
        {(data.course.coverUrl || (playing && t?.url)) && (
          <div className="site-photo tall course-hero-media">
            {playing && t?.url ? <video src={t.url} controls autoPlay playsInline aria-label={`Darmowa lekcja: ${t.title}`} /> : <img src={data.course.coverUrl!} alt="" />}
          </div>
        )}
      </div>
      {stats.length > 0 && (
        <dl className="course-stats">
          {stats.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Outcomes({ data }: { data: PublicCourse }) {
  // Jeden punkt to nie lista (błąd z audytu) – efekty pokazujemy od dwóch.
  if (data.page.outcomes.length < 2) return null;
  return (
    <Section id="efekty" name="Efekty" eyebrow="Efekty" title="Poczuj zmianę" serif="w pierwszych tygodniach">
      <ul className="course-ticks">
        {data.page.outcomes.map((o) => (
          <li key={o}>{o}</li>
        ))}
      </ul>
    </Section>
  );
}

function Program({ data }: { data: PublicCourse }) {
  if (!data.modules.length) return null;
  const names = new Map(data.people.map((p) => [p.id, p.name]));
  const news = data.edition?.news ?? [];
  return (
    <Section id="program" name="Program" eyebrow="Program" title="Moduł po module" serif={`${data.course.lessons} ${plural(data.course.lessons, 'trening', 'treningi', 'treningów')}`}>
      <ol className="course-modules">
        {data.modules.map((m, i) => (
          <li key={m.name}>
            <span className="course-num">{String(i + 1).padStart(2, '0')}</span>
            <div className="site-row-main">
              <span className="site-row-name">{m.name}</span>
              <span className="site-quiet">{[m.people.map((p) => names.get(p)).filter(Boolean).join(', '), m.titles.join(' · ')].filter(Boolean).join(' — ')}</span>
            </div>
            <span className="site-quiet course-count">
              {m.lessons} {plural(m.lessons, 'trening', 'treningi', 'treningów')}
              {m.minutes > 0 && ` · ${m.minutes} min`}
            </span>
          </li>
        ))}
      </ol>
      {news.length > 0 && (
        <div className="course-news">
          <div className="site-eyebrow">Co nowego w tej edycji</div>
          <ol className="course-cards">
            {news.map((n, i) => (
              <li key={n.title}>
                <span className="course-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{n.title}</h3>
                {n.body && <p className="site-desc">{n.body}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {data.calendar.length > 0 && (
        <details className="course-calendar">
          <summary>
            Kalendarz treningowy <span className="site-quiet">· {data.calendar.length} {plural(data.calendar.length, 'dzień', 'dni', 'dni')} z planem</span>
          </summary>
          <ul>
            {data.calendar.map((c) => (
              <li key={c.day}>
                <span className="site-time">{c.day}</span>
                <span className="site-row-main">{c.lessons.join(' + ')}</span>
                {c.minutes > 0 && <span className="site-quiet">{c.minutes} min</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function PersonPhoto({ p }: { p: Person }) {
  return p.photoUrl ? (
    <div className="site-photo portrait">
      <img src={p.photoUrl} alt="" loading="lazy" />
    </div>
  ) : (
    <div className="site-photo portrait empty" aria-hidden>
      <span className="serif">{p.name.replace(/^dr\.? /, '').charAt(0)}</span>
    </div>
  );
}

function Team({ people }: { people: Person[] }) {
  if (!people.length) return null;
  return (
    <Section id="prowadzace" name="Prowadzące" eyebrow="Prowadzące i ekspertki" title="Z kim" serif="ćwiczysz">
      <div className="site-people course-people">
        {people.map((p) => (
          <article key={p.id} className="site-person">
            <PersonPhoto p={p} />
            <h3>{p.name}</h3>
            <p className="site-quiet">{p.title || ROLE[p.role]}</p>
            {p.bio && <p className="site-desc">{p.bio}</p>}
          </article>
        ))}
      </div>
    </Section>
  );
}

function ForWhom({ data }: { data: PublicCourse }) {
  if (!data.page.forWhom.length) return null;
  return (
    <Section id="dla-kogo" name="Dla kogo" eyebrow="Dla kogo" title="To kurs" serif="dla Ciebie, jeśli">
      <div className="site-split course-split">
        <ul className="course-ticks">
          {data.page.forWhom.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <dl className="course-facts">
          <div>
            <dt>Poziom</dt>
            <dd>{data.course.level}</dd>
          </div>
          {data.page.equipment && (
            <div>
              <dt>Sprzęt</dt>
              <dd>{data.page.equipment}</dd>
            </div>
          )}
          {data.course.contraindications && (
            <div>
              <dt>Przeciwwskazania</dt>
              <dd>{data.course.contraindications}</dd>
            </div>
          )}
        </dl>
      </div>
    </Section>
  );
}

function Offers({ data, onBuy }: { data: PublicCourse; onBuy: (t: Tier) => void }) {
  const d = useDates(data.studio.timezone);
  if (!data.tiers.length && !data.passProducts.length) return null;
  const e = data.edition;
  const closedNote = e?.state === 'upcoming' && e.salesFrom ? `Zapisy ruszają ${d.day(e.salesFrom)}.` : e?.state === 'closed' ? 'Sprzedaż tej edycji jest zakończona.' : null;
  return (
    <Section id="pakiety" name="Pakiety" eyebrow="Pakiety" title="Wybierz" serif="swój pakiet">
      {closedNote && <p className="site-prose course-note">{closedNote}</p>}
      {data.tiers.length > 0 && (
        <div className="course-table-wrap">
          <table className="course-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Co zawiera</span>
                </th>
                {data.tiers.map((t) => (
                  <th key={t.id} scope="col" className={t.highlight ? 'hl' : undefined}>
                    {t.highlight && <span className="site-new">Najczęściej wybierany</span>}
                    <span className="course-tier">{t.name}</span>
                    <span className="course-price">
                      {t.fullPrice && <s>{t.fullPrice}</s>} {t.price}
                    </span>
                    {t.seatsLeft !== null && <span className="site-quiet">{t.seatsLeft ? `${t.seatsLeft} ${plural(t.seatsLeft, 'miejsce', 'miejsca', 'miejsc')}` : 'Wyprzedany'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.comparison.map((row) => (
                <tr key={row.feature}>
                  <th scope="row">{row.feature}</th>
                  {data.tiers.map((t) => (
                    <td key={t.id} className={t.highlight ? 'hl' : undefined}>
                      {row.tiers[t.id] ? <span aria-label="tak">●</span> : <span className="course-no" aria-label="nie">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                {data.tiers.map((t) => (
                  <td key={t.id} className={t.highlight ? 'hl' : undefined}>
                    <button type="button" className={`btn sm${t.highlight ? '' : ' ghost'}`} disabled={!data.salesOpen || t.seatsLeft === 0} onClick={() => onBuy(t)}>
                      Wybieram {t.name}
                    </button>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {data.passProducts.length > 0 && (
        <div className="course-pass">
          <div className="site-eyebrow">Masz karnet w studiu?</div>
          <p className="site-prose">
            {data.passProducts.map((p) => p.name).join(', ')} {data.passProducts.length > 1 ? 'obejmują' : 'obejmuje'} ten kurs. Znajdziesz go w aplikacji w zakładce Kursy – bez dopłat.
          </p>
          <a className="site-link" href={APP_URL}>
            Otwórz aplikację
          </a>
        </div>
      )}
    </Section>
  );
}

function Faq({ data }: { data: PublicCourse }) {
  const d = useDates(data.studio.timezone);
  const e = data.edition;
  // Daty edycji odpowiadamy z danych – nigdy nie są nieaktualne (błąd z audytu: „do 1/10” po terminie).
  const auto: { q: string; a: string }[] = [];
  if (e?.accessUntil || data.course.accessDays)
    auto.push({
      q: 'Do kiedy mam dostęp?',
      a: e?.accessUntil ? `Do ${d.full(e.accessUntil)}${e.startsAt ? `. Edycja startuje ${d.full(e.startsAt)}` : ''}.` : `${data.course.accessDays} dni od zakupu.`,
    });
  const faq = [...data.page.faq, ...auto.filter((a) => !data.page.faq.some((f) => f.q === a.q))];
  if (!faq.length) return null;
  return (
    <Section id="faq" name="FAQ" eyebrow="FAQ" title="Pytania" serif="przed startem">
      <div className="site-faq course-faq">
        {faq.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function Author({ person }: { person: Person }) {
  return (
    <section id="autorka" data-section-name="Autorka" className="site-section">
      <div className="site-split">
        <PersonPhoto p={person} />
        <div>
          <div className="site-eyebrow">{person.title || ROLE.author}</div>
          <h2 className="site-h2">{person.name}</h2>
          {person.bio && <p className="site-prose course-bio">{person.bio}</p>}
        </div>
      </div>
    </section>
  );
}

function LegalFooter({ data }: { data: PublicCourse }) {
  const s = data.studio;
  return (
    <section id="stopka" data-section-name="Stopka" className="site-footer">
      <div className="course-legal">
        {s.regulations && (
          <details>
            <summary>Regulamin sprzedaży</summary>
            <p>{s.regulations}</p>
            <p>Dostęp do treści cyfrowych zaczyna się od razu po płatności – kupując, zgadzasz się na to i tracisz prawo odstąpienia od umowy.</p>
          </details>
        )}
        <details>
          <summary>Polityka prywatności</summary>
          <p>
            Administratorem Twoich danych jest {s.name}
            {s.address ? `, ${s.address}` : ''}. Imię, numer telefonu i e-mail są potrzebne, żeby założyć konto, zrealizować zakup i dać Ci dostęp do kursu. Płatność obsługuje bramka studia. Możesz
            poprosić o kopię danych lub ich usunięcie{s.email ? ` pod adresem ${s.email}` : ' w aplikacji, w Profilu'}.
          </p>
        </details>
        <details>
          <summary>Cookies</summary>
          <p>Strona nie używa cookies reklamowych ani analitycznych. Zapisujemy tylko to, co potrzebne do działania aplikacji.</p>
        </details>
      </div>
      <div className="site-footer-row">
        <span>
          © {new Date().getFullYear()} {s.name}
          {s.nip ? ` · NIP ${s.nip}` : ''}
          {s.address ? ` · ${s.address}` : ''}
        </span>
        <span>
          {s.email && <a href={`mailto:${s.email}`}>{s.email}</a>}
          {s.email && ' · '}
          działa na <span className="serif">glam</span>
        </span>
      </div>
    </section>
  );
}

// ——— zakup ———

type ReturnState = { status: 'open' | 'paid' | 'failed' | 'expired' | 'cancelled'; message: string };

/**
 * Powrót ze Stripe Checkout: /s/:slug/kurs/:id?checkout=cs_… – konto i dostęp tworzy webhook,
 * więc chwilę pytamy o wynik (zwykle kilka sekund). Parametr znika z adresu przy pierwszym odczycie.
 */
function useCheckoutReturn(slug: string, courseId: string) {
  const [state, setState] = useState<ReturnState | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('checkout');
    if (!id) return;
    history.replaceState(null, '', location.pathname);
    if (id === 'cancelled') return setState({ status: 'cancelled', message: 'Płatność przerwana – możesz wybrać pakiet jeszcze raz.' });
    setState({ status: 'open', message: 'Czekamy na potwierdzenie płatności…' });
    let alive = true;
    (async () => {
      for (let i = 0; i < 10 && alive; i++) {
        const r = await fetch(`/api/public/studios/${encodeURIComponent(slug)}/courses/${encodeURIComponent(courseId)}/checkout/${encodeURIComponent(id)}`).catch(() => null);
        const body = r?.ok ? ((await r.json().catch(() => null)) as ReturnState | null) : null;
        if (body && body.status !== 'open') return alive && setState(body);
        await new Promise((res) => setTimeout(res, 1500));
      }
      if (alive) setState({ status: 'open', message: 'Bank jeszcze potwierdza płatność. Gdy dotrze, dostęp pojawi się w aplikacji – zaloguj się numerem z formularza.' });
    })();
    return () => {
      alive = false;
    };
  }, [slug, courseId]);
  return { state, close: () => setState(null) };
}

function CheckoutReturn({ state, onClose }: { state: ReturnState; onClose: () => void }) {
  const ok = state.status === 'paid';
  return (
    <div className="course-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="course-checkout" role="dialog" aria-modal="true" aria-label="Wynik płatności">
        <button type="button" className="course-close" onClick={onClose} aria-label="Zamknij">
          ×
        </button>
        <div className="course-done">
          <div className="site-eyebrow">{ok ? 'Zapłacono' : state.status === 'open' ? 'Płatność w toku' : 'Płatność'}</div>
          <h2 className="site-h2">{state.message}</h2>
          {state.status === 'open' && <Spinner />}
          {ok && (
            <a className="btn" href={APP_URL}>
              Otwórz aplikację
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Checkout({ data, tier, onClose }: { data: PublicCourse; tier: Tier; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', couponCode: '', method: data.paymentMethods[0] ?? 'blik', acceptTerms: false, waiveWithdrawal: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; next: string; appUrl: string; paid: string } | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/public/studios/${encodeURIComponent(data.studio.slug)}/courses/${encodeURIComponent(data.course.id)}/purchase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, tierId: tier.id }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message ?? 'Nie udało się. Spróbuj ponownie.');
      // Studio ze Stripe: płatność na stronie Checkout, potem powrót tutaj z ?checkout=…
      if (goToCheckout(body)) return;
      setDone(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="course-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="course-checkout" role="dialog" aria-modal="true" aria-label={`Zakup pakietu ${tier.name}`}>
        <button type="button" className="course-close" onClick={onClose} aria-label="Zamknij">
          ×
        </button>
        {done ? (
          <div className="course-done">
            <div className="site-eyebrow">Zapłacono {done.paid}</div>
            <h2 className="site-h2">{done.message}</h2>
            <p className="site-prose">{done.next}</p>
            <a className="btn" href={done.appUrl}>
              Otwórz aplikację
            </a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="site-eyebrow">{data.course.title}</div>
            <h2 className="site-h2">
              {tier.name} <span className="serif">{tier.price}</span>
            </h2>
            <p className="site-quiet">Konto założymy na Twój numer – w aplikacji zalogujesz się kodem SMS i od razu zaczniesz.</p>
            <label className="field">
              <span className="field-label">Imię i nazwisko</span>
              <input className="input" required autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Telefon</span>
              <input className="input" required type="tel" autoComplete="tel" inputMode="tel" placeholder="500 600 700" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">E-mail (potwierdzenie i faktura)</span>
              <input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Kod rabatowy</span>
              <input className="input" autoCapitalize="characters" value={form.couponCode} onChange={(e) => set('couponCode', e.target.value)} />
            </label>
            <fieldset className="course-methods">
              <legend className="field-label">Płatność</legend>
              {data.paymentMethods.map((m) => (
                <label key={m} className={form.method === m ? 'on' : undefined}>
                  <input type="radio" name="method" value={m} checked={form.method === m} onChange={() => set('method', m)} />
                  {PAYMENT_LABELS[m] ?? m}
                </label>
              ))}
            </fieldset>
            <label className="course-check">
              <input type="checkbox" checked={form.acceptTerms} onChange={(e) => set('acceptTerms', e.target.checked)} />
              <span>Akceptuję regulamin sprzedaży i politykę prywatności.</span>
            </label>
            <label className="course-check">
              <input type="checkbox" checked={form.waiveWithdrawal} onChange={(e) => set('waiveWithdrawal', e.target.checked)} />
              <span>Chcę dostęp od razu i wiem, że tracę wtedy prawo odstąpienia od umowy.</span>
            </label>
            {error && (
              <p className="course-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn" disabled={busy || !form.acceptTerms || !form.waiveWithdrawal}>
              {busy ? 'Płacę…' : `Zapłać ${tier.price}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
