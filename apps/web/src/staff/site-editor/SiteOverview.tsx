// „Strona WWW” w menu panelu: stan strony i wejście do edytora na pełnym ekranie.
import { useApi } from '../../api.ts';
import { Spinner } from '../../ui.tsx';

export function SiteOverview() {
  const { data } = useApi<{ slug: string; publishedAt: string | null; unpublished: boolean; draftUpdatedAt: string | null }>('/site/editor');
  if (!data) return <Spinner />;
  const when = (iso: string) => new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <div>
        <h1 style={{ marginBottom: 4 }}>Strona WWW</h1>
        <p className="muted" style={{ margin: 0 }}>
          Wizytówka studia z grafikiem, zajęciami i trenerkami. Treść i układ zmieniasz w edytorze – dane biorą się z panelu same.
        </p>
      </div>
      <div className="card stack">
        <div className="row between wrap">
          <div>
            <div className="eyebrow">Adres</div>
            <a href={`/s/${data.slug}`} target="_blank" rel="noopener">
              {location.host}/s/{data.slug}
            </a>
          </div>
          <span className="small muted">
            {data.publishedAt ? `Opublikowano ${when(data.publishedAt)}` : 'Układ domyślny – jeszcze bez publikacji'}
            {data.publishedAt && data.unpublished ? ' · szkic ma nieopublikowane zmiany' : ''}
          </span>
        </div>
        <div className="row wrap">
          <a className="btn" href="/panel/strona">
            Edytuj stronę
          </a>
          <a className="btn ghost" href={`/s/${data.slug}`} target="_blank" rel="noopener">
            Zobacz stronę
          </a>
        </div>
      </div>
      <p className="small muted">Nowe zajęcia dodane w „Grafik i sale” pojawiają się na stronie same – z etykietą „Nowość”, przez czas ustawiony w edytorze (sekcja Zajęcia).</p>
    </div>
  );
}
