// Karnety i produkty (1.1.3, C2, C4, C5): produkt składany z klocków, podgląd „Jak to widzi klientka”
// liczony tym samym kodem (@glam/core), którego używa serwer. Zmiana ceny lub zasad = nowa wersja; zmiana zasad
// może objąć kupione karnety (klientki dostają powiadomienie). Klocki: pula / czas, aktywacja, okno godzin, limity,
// goście, zawieszanie, odnawianie, rozliczenie, zniżka dla powracających, kursy w karnecie, kanały sprzedaży.
import { useMemo, useState } from 'react';
import { describeRules, validateRules, type ProductRules } from '@glam/core';
import { api, ApiError, useApi } from '../api.ts';
import { Sheet, Spinner, Toggle, useToast } from '../ui.tsx';

type Product = { id: string; name: string; description: string | null; published: number; version: number; price: string; price_grosze: number; preview: string[]; sold: number; rules: ProductRules; channels: string[] };
type Config = { zones: { id: string; name: string; access: string }[]; classTypes: { id: string; name: string; zone_id: string }[] };
type CourseLite = { id: string; title: string; status: string };

export function Products() {
  const { data: products, reload } = useApi<Product[]>('/owner/products');
  const { data: config } = useApi<Config>('/owner/config');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [priceEdit, setPriceEdit] = useState<Product | null>(null);
  const [newPrice, setNewPrice] = useState('');
  const toast = useToast();

  const update = async (id: string, body: object, msg: string) => {
    try {
      await api(`/owner/products/${id}`, { method: 'PUT', body });
      toast(msg);
      reload();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div>
          <h1 style={{ marginBottom: 0 }}>Karnety i produkty</h1>
          <p className="muted" style={{ margin: 0 }}>Każdy produkt to zestaw reguł: pula wejść, dostęp czasowy, okno, limity.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>
          + Nowy produkt
        </button>
      </div>

      {!products && <Spinner />}
      {/* Lista zamiast siatki kart: nazwa, skrót zasad i cena w jednym wierszu. Pełny podgląd „Jak to widzi klientka” jest w Zasadach. */}
      {products && products.length > 0 && (
        <section className="card product-list">
          {products.map((p) => (
            <div key={p.id} className={`product-row ${p.published ? '' : 'is-hidden'}`}>
              <div className="product-row-text">
                <div className="product-row-name">
                  {p.name}
                  {!p.published && <span className="badge">ukryty</span>}
                </div>
                <div className="product-row-rules">{p.preview.join(' · ')}</div>
                <div className="tiny muted">
                  wersja {p.version} · sprzedanych: {p.sold}
                </div>
              </div>
              <b className="product-row-price">{p.price}</b>
              <div className="product-row-actions">
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    setPriceEdit(p);
                    setNewPrice(String(p.price_grosze / 100));
                  }}
                >
                  Cena
                </button>
                <button className="btn ghost sm" onClick={() => setEditing(p)}>
                  Zasady
                </button>
                <button className="btn quiet sm" onClick={() => update(p.id, { published: !p.published }, p.published ? 'Ukryte w aplikacji' : 'Opublikowane')}>
                  {p.published ? 'Ukryj' : 'Pokaż'}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {priceEdit && (
        <Sheet onClose={() => setPriceEdit(null)} label="Zmiana ceny">
          <div className="stack">
            <h2>{priceEdit.name}</h2>
            <div className="field">
              <label htmlFor="np">Nowa cena (zł)</label>
              <input id="np" className="input" inputMode="decimal" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
            </div>
            <p className="small muted">
              Powstanie wersja {priceEdit.version + 1}. Kupione wcześniej karnety ({priceEdit.sold}) zachowają swoje warunki.
            </p>
            <button
              className="btn"
              onClick={async () => {
                await update(priceEdit.id, { priceGrosze: Math.round(Number(newPrice.replace(',', '.')) * 100) }, 'Nowa cena obowiązuje od teraz');
                setPriceEdit(null);
              }}
            >
              Zapisz nową wersję
            </button>
          </div>
        </Sheet>
      )}

      {(creating || editing) && config && (
        <ProductBuilder
          config={config}
          product={editing ?? undefined}
          onClose={() => (setCreating(false), setEditing(null))}
          onCreated={() => {
            setCreating(false);
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

const WEEKDAYS = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];

function ProductBuilder({ config, product, onClose, onCreated }: { config: Config; product?: Product; onClose: () => void; onCreated: () => void }) {
  const r0 = product?.rules;
  const pool0 = r0?.pools?.[0];
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(product ? String(product.price_grosze / 100) : '200');
  const [kind, setKind] = useState<'pool' | 'time'>(r0?.unlimited ? 'time' : 'pool');
  const [entries, setEntries] = useState(pool0?.entries ?? 4);
  const [classTypes, setClassTypes] = useState<string[]>(pool0 && pool0.classTypeIds !== 'all' ? pool0.classTypeIds : []);
  const [zones, setZones] = useState<string[]>(r0?.unlimited && r0.unlimited.zoneIds !== 'all' ? r0.unlimited.zoneIds : []);
  const [validity, setValidity] = useState(r0?.validityDays ?? 30);
  const [activation, setActivation] = useState(r0?.validFrom === 'activation');
  const [daily, setDaily] = useState(r0?.dailyLimit ?? 0);
  const [weekly, setWeekly] = useState(r0?.weeklyLimit ?? 0);
  const [win, setWin] = useState(r0?.window ?? null);
  const [guests, setGuests] = useState(r0?.guestsPerMonth ?? 0);
  const [freeze, setFreeze] = useState(r0?.freeze ?? null);
  const [billing, setBilling] = useState<'' | 'year' | 'week' | 'once'>(r0?.billing ?? '');
  const [autoRenew, setAutoRenew] = useState(!!r0?.autoRenew);
  const [returning, setReturning] = useState(r0?.returningDiscountPct ?? 0);
  const [courses, setCourses] = useState<string[] | 'all'>(r0?.courseIds ?? []);
  const [intro, setIntro] = useState(!!r0?.introOnly);
  const [channels, setChannels] = useState<string[]>(product?.channels ?? ['app', 'desk']);
  const [applyToExisting, setApplyToExisting] = useState(false);
  const courseList = useApi<CourseLite[]>('/creator/courses');
  const toast = useToast();

  const rules: ProductRules = useMemo(
    () => ({
      validityDays: validity,
      ...(kind === 'pool'
        ? { pools: [{ id: pool0?.id ?? 'main', label: name || 'Wejścia', entries, classTypeIds: classTypes.length ? classTypes : 'all' }] }
        : { unlimited: { zoneIds: zones.length ? zones : 'all', classTypeIds: 'all' } }),
      ...(activation ? { validFrom: 'activation' as const } : {}),
      ...(daily > 0 ? { dailyLimit: daily } : {}),
      ...(weekly > 0 ? { weeklyLimit: weekly } : {}),
      ...(win ? { window: win } : {}),
      ...(guests > 0 ? { guestsPerMonth: guests } : {}),
      ...(freeze ? { freeze } : {}),
      ...(billing ? { billing } : {}),
      ...(autoRenew || billing === 'year' || billing === 'week' ? { autoRenew: billing === 'once' ? false : true } : {}),
      ...(returning > 0 ? { returningDiscountPct: returning } : {}),
      ...(courses === 'all' || courses.length ? { courseIds: courses } : {}),
      ...(intro ? { introOnly: true } : {}),
    }),
    [kind, name, entries, classTypes, zones, validity, activation, daily, weekly, win, guests, freeze, billing, autoRenew, returning, courses, intro, pool0?.id],
  );
  const names = {
    classTypes: Object.fromEntries(config.classTypes.map((c) => [c.id, c.name])),
    zones: Object.fromEntries(config.zones.map((z) => [z.id, z.name])),
  };
  const errors = validateRules(rules);
  if (!channels.length) errors.push('Wybierz co najmniej jeden kanał sprzedaży.');
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const priceGrosze = Math.round(Number(price.replace(',', '.')) * 100);

  const save = async () => {
    try {
      if (product) {
        await api(`/owner/products/${product.id}`, { method: 'PUT', body: { name, rules, priceGrosze, channels, applyToExisting } });
        toast(applyToExisting ? 'Nowa wersja – klientki z aktywnym karnetem dostały powiadomienie' : 'Nowa wersja obowiązuje dla nowych zakupów');
      } else {
        await api('/owner/products', { method: 'POST', body: { name, priceGrosze, rules, channels } });
        toast(`Produkt „${name}” opublikowany`);
      }
      onCreated();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const num = (label: string, value: number, set: (n: number) => void, min = 0) => (
    <div className="field grow">
      <label>{label}</label>
      <input className="input" type="number" min={min} value={value} onChange={(e) => set(Number(e.target.value))} />
    </div>
  );

  return (
    <Sheet onClose={onClose} label={product ? 'Zasady produktu' : 'Nowy produkt'}>
      <div className="stack">
        <h2>{product ? product.name : 'Nowy produkt'}</h2>
        <div className="field">
          <label htmlFor="pn">Nazwa</label>
          <input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Reformer 6" />
        </div>
        <div className="row">
          <div className="field grow">
            <label htmlFor="pp">Cena (zł)</label>
            <input id="pp" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          {num('Ważność (dni)', validity, setValidity, 1)}
        </div>
        <Toggle label="Ważność liczona od pierwszego wejścia" hint="Klientka aktywuje karnet przy pierwszych zajęciach (najpóźniej 180 dni od zakupu)." checked={activation} onChange={setActivation} />
        <div className="chips">
          <button className="chip" aria-pressed={kind === 'pool'} onClick={() => setKind('pool')}>
            Pula wejść
          </button>
          <button className="chip" aria-pressed={kind === 'time'} onClick={() => setKind('time')}>
            Dostęp czasowy (bez limitu)
          </button>
        </div>
        {kind === 'pool' ? (
          <>
            {num('Liczba wejść', entries, setEntries, 1)}
            <div className="field">
              <label>Na jakie zajęcia (brak wyboru = dowolne)</label>
              <div className="chips" style={{ flexWrap: 'wrap' }}>
                {config.classTypes.map((c) => (
                  <button key={c.id} className="chip" aria-pressed={classTypes.includes(c.id)} onClick={() => toggle(classTypes, setClassTypes, c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="field">
            <label>Strefy (brak wyboru = wszystkie)</label>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {config.zones.map((z) => (
                <button key={z.id} className="chip" aria-pressed={zones.includes(z.id)} onClick={() => toggle(zones, setZones, z.id)}>
                  {z.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="row">
          {num('Limit dzienny (0 = brak)', daily, setDaily)}
          {num('Limit tygodniowy (0 = brak)', weekly, setWeekly)}
          {num('Wejścia z gościem / mies.', guests, setGuests)}
        </div>
        <Toggle label="Okno godzin (np. poranny karnet)" checked={!!win} onChange={(v) => setWin(v ? { weekdays: [1, 2, 3, 4, 5], from: '07:00', to: '12:00' } : null)} />
        {win && (
          <div className="stack gap-2">
            <div className="chips">
              {WEEKDAYS.map((d, i) => (
                <button key={d} className="chip" aria-pressed={win.weekdays.includes(i)} onClick={() => setWin({ ...win, weekdays: win.weekdays.includes(i) ? win.weekdays.filter((x) => x !== i) : [...win.weekdays, i].sort() })}>
                  {d}
                </button>
              ))}
            </div>
            <div className="row">
              <input className="input" type="time" value={win.from} onChange={(e) => setWin({ ...win, from: e.target.value })} aria-label="Od" />
              <input className="input" type="time" value={win.to} onChange={(e) => setWin({ ...win, to: e.target.value })} aria-label="Do" />
            </div>
          </div>
        )}
        <Toggle label="Zawieszanie (urlop, ciąża, choroba)" checked={!!freeze} onChange={(v) => setFreeze(v ? { maxTimes: 2, maxDays: 30 } : null)} />
        {freeze && (
          <div className="row">
            {num('Ile razy', freeze.maxTimes, (n) => setFreeze({ ...freeze, maxTimes: n }))}
            {num('Łącznie dni', freeze.maxDays, (n) => setFreeze({ ...freeze, maxDays: n }))}
          </div>
        )}
        <div className="field">
          <label>Rozliczenie</label>
          <div className="chips">
            {[
              ['', 'Zwykły karnet'],
              ['week', 'Subskrypcja tygodniowa'],
              ['year', 'Subskrypcja roczna'],
              ['once', 'Jednorazowo (bez odnawiania)'],
            ].map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={billing === k} onClick={() => setBilling(k as typeof billing)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {!billing && <Toggle label="Odnawiaj automatycznie co okres" hint="Klientka może wyłączyć odnawianie w każdej chwili." checked={autoRenew} onChange={setAutoRenew} />}
        {num('Zniżka dla powracających % (po 30 dniach przerwy)', returning, setReturning)}
        <div className="field">
          <label>Kursy online w karnecie</label>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            <button className="chip" aria-pressed={courses === 'all'} onClick={() => setCourses(courses === 'all' ? [] : 'all')}>
              Wszystkie
            </button>
            {courseList.data
              ?.filter((c) => c.status === 'published')
              .map((c) => (
                <button key={c.id} className="chip" aria-pressed={courses !== 'all' && courses.includes(c.id)} disabled={courses === 'all'} onClick={() => courses !== 'all' && toggle(courses, setCourses, c.id)}>
                  {c.title}
                </button>
              ))}
          </div>
        </div>
        <Toggle label="Tylko na start" hint="Pakiet dla nowych klientek – przy pierwszym zakupie" checked={intro} onChange={setIntro} />
        <div className="field">
          <label>Gdzie sprzedajemy</label>
          <div className="chips">
            <button className="chip" aria-pressed={channels.includes('app')} onClick={() => toggle(channels, setChannels, 'app')}>
              W aplikacji
            </button>
            <button className="chip" aria-pressed={channels.includes('desk')} onClick={() => toggle(channels, setChannels, 'desk')}>
              W recepcji
            </button>
          </div>
        </div>

        <div className="card soft flat">
          <div className="eyebrow">Jak to widzi klientka</div>
          <div className="row between">
            <b>{name || 'Nazwa produktu'}</b>
            <b>{price} zł</b>
          </div>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {describeRules(rules, names).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        {product && (
          <Toggle
            label={`Zastosuj także do kupionych karnetów (${product.sold})`}
            hint="Domyślnie kupione karnety zachowują swoje warunki. Jeśli zmieniasz na korzyść klientek – możesz objąć wszystkie; dostaną powiadomienie."
            checked={applyToExisting}
            onChange={setApplyToExisting}
          />
        )}
        {errors.length > 0 && (
          <p className="small" style={{ color: 'var(--danger)' }}>
            {errors[0]}
          </p>
        )}
        <button className="btn" disabled={!name.trim() || errors.length > 0} onClick={save}>
          {product ? `Zapisz wersję ${product.version + 1}` : 'Opublikuj produkt'}
        </button>
      </div>
    </Sheet>
  );
}
