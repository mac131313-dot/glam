// „Strona WWW” w menu panelu: duży podgląd strony (szkic) z wejściem do edytora na pełnym ekranie.
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api.ts';
import { Spinner } from '../../ui.tsx';

// Podgląd renderujemy w szerokości komputera i zmniejszamy do szerokości karty.
const DESKTOP = 1440;

export function SiteOverview() {
  const { data } = useApi<{ slug: string; publishedAt: string | null; unpublished: boolean; draftUpdatedAt: string | null }>('/site/editor');
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / DESKTOP));
    ro.observe(box);
    return () => ro.disconnect();
  }, [data]);

  if (!data) return <Spinner />;
  const when = (iso: string) => new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const url = `/s/${encodeURIComponent(data.slug)}`;
  const status = data.publishedAt
    ? data.unpublished
      ? `Nieopublikowane zmiany · zapisano ${when(data.draftUpdatedAt ?? data.publishedAt)}`
      : `Opublikowano ${when(data.publishedAt)}`
    : 'Układ domyślny – jeszcze bez publikacji';

  return (
    <div className="stack-lg">
      <div>
        <h1 style={{ marginBottom: 4 }}>Strona WWW</h1>
        <p className="muted" style={{ margin: 0 }}>
          Wizytówka studia z grafikiem, zajęciami i trenerkami. Treść i układ zmieniasz w edytorze – dane biorą się z panelu same.
        </p>
      </div>

      <div className="site-ov">
        <div ref={boxRef} className="site-ov-frame" aria-hidden>
          <iframe
            src={`${url}?podglad=1`}
            title="Podgląd strony"
            tabIndex={-1}
            scrolling="no"
            onLoad={() => setLoaded(true)}
            style={{ width: DESKTOP, height: `${100 / scale}%`, transform: `scale(${scale})`, opacity: loaded ? 1 : 0 }}
          />
        </div>
        <a className="site-ov-hit" href="/panel/strona" aria-label="Edytuj stronę" />
        <div className="site-ov-bar">
          <div className="site-ov-info">
            <a className="site-ov-title" href={url} target="_blank" rel="noopener">
              {location.host}/s/{data.slug}
            </a>
            <span className="site-ov-sub">{status}</span>
          </div>
          <div className="site-ov-actions">
            <a className="btn sm site-ov-soft" href={url} target="_blank" rel="noopener">
              Zobacz stronę
            </a>
            <a className="btn sm site-ov-main" href="/panel/strona">
              Edytuj stronę
            </a>
          </div>
        </div>
      </div>

      <p className="small muted">Nowe zajęcia dodane w „Grafik i sale” pojawiają się na stronie same – z etykietą „Nowość”, przez czas ustawiony w edytorze (sekcja Zajęcia).</p>
    </div>
  );
}
