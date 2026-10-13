// Grafik i sale (C1, C7, #7): tydzień w studiu (edytowalny), strefy, typy zajęć, blokady i święta.
import { useState } from 'react';
import { api, ApiError, localDate, useApi } from '../api.ts';
import { ClassCover } from '../client/ClassCover.tsx';
import { Select, Spinner, useToast } from '../ui.tsx';
import { preparePhoto } from './logoUpload.ts';
import { WeekBoard, type BoardConfig } from './WeekBoard.tsx';

type Config = Omit<BoardConfig, 'classTypes'> & {
  zones: { id: string; name: string; access: string }[];
  classTypes: { id: string; name: string; zone_id: string; level: string; color: string; photo_url: string | null; photo_ratio: number | null }[];
  exceptions: { id: string; date: string; zone_id: string | null; reason: string }[];
};

const ACCESS: Record<string, string> = {
  reserved: 'Rezerwowana sesja',
  open: 'Wolny wstęp',
  checkin: 'Kontrolowany wstęp (QR)',
  mixed: 'Mieszany',
};

export function ScheduleAdmin() {
  const { data, reload } = useApi<Config>('/owner/config');
  const [date, setDate] = useState(localDate());
  const [zone, setZone] = useState('');
  const [reason, setReason] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const toast = useToast();

  if (!data) return <Spinner />;
  const zoneName = (id: string | null) => (id ? data.zones.find((z) => z.id === id)?.name : 'Cały obiekt');

  const block = async () => {
    if (!confirm(`Zablokować ${zoneName(zone || null)} w dniu ${date}? Zajęcia zostaną odwołane, a klientki dostaną zwrot wejść i powiadomienie.`)) return;
    try {
      const res = await api('/owner/exceptions', { method: 'POST', body: { date, zoneId: zone || null, reason } });
      toast(`Zablokowane. Odwołane sesje: ${res.cancelledSessions}`);
      setReason('');
      reload();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const uploadPhoto = async (classTypeId: string, file: File | undefined) => {
    if (!file) return;
    setUploading(classTypeId);
    try {
      const dataUrl = await preparePhoto(file);
      await api(`/owner/class-types/${classTypeId}/photo`, { method: 'PUT', body: { dataUrl } });
      toast('Zdjęcie zapisane – klientki widzą je w grafiku');
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setUploading(null);
    }
  };

  const removePhoto = async (classTypeId: string) => {
    await api(`/owner/class-types/${classTypeId}/photo`, { method: 'DELETE' });
    toast('Zdjęcie usunięte');
    reload();
  };

  return (
    <div className="stack-lg">
      <div>
        <h1 style={{ marginBottom: 0 }}>Grafik i sale</h1>
        <p className="muted" style={{ margin: 0 }}>Ustaw tydzień raz – system sam rozpisuje zajęcia na 4 tygodnie do przodu.</p>
      </div>

      <WeekBoard config={data} onChange={reload} />

      <div className="grid-2">
        <section className="card stack">
          <h3>Strefy</h3>
          {data.zones.map((z) => (
            <div key={z.id} className="row between small">
              <b>{z.name}</b>
              <span className="badge">{ACCESS[z.access]}</span>
            </div>
          ))}
        </section>

        <section className="card stack">
          <h3>Blokada sali, święto, urlop</h3>
          <div className="row wrap">
            <div className="field grow">
              <label htmlFor="bd">Dzień</label>
              <input id="bd" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field grow">
              <label htmlFor="bz">Strefa</label>
              <Select id="bz" value={zone} onChange={setZone} options={[{ value: '', label: 'Cały obiekt' }, ...data.zones.map((z) => ({ value: z.id, label: z.name }))]} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="br">Powód (widzi go klientka)</label>
            <input id="br" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="np. Święto, Remont sali" />
          </div>
          <button className="btn danger" disabled={!reason.trim()} onClick={block}>
            Zablokuj i powiadom klientki
          </button>
          {data.exceptions.length > 0 && (
            <div className="small muted">
              Ostatnie: {data.exceptions.slice(0, 4).map((e) => `${e.date} (${zoneName(e.zone_id)}: ${e.reason})`).join(' · ')}
            </div>
          )}
        </section>
      </div>

      <section className="card stack">
        <div>
          <h3 style={{ margin: 0 }}>Typy zajęć i zdjęcia</h3>
          <p className="small muted" style={{ margin: 0 }}>Zdjęcie jest tłem karty zajęć w grafiku klientek. Najlepiej poziome, jasne, z wolną przestrzenią w lewym dolnym rogu na nazwę.</p>
        </div>
        <div className="photo-grid">
          {data.classTypes.map((c) => (
            <div key={c.id} className="stack" style={{ gap: 8 }}>
              <ClassCover photoUrl={c.photo_url} photoRatio={c.photo_ratio} eyebrow="18:00 · 55 min" title={c.name} meta={`${zoneName(c.zone_id)} · ${c.level}`} />
              <div className="row" style={{ gap: 6 }}>
                <label className="btn sm ghost" aria-disabled={uploading === c.id}>
                  {uploading === c.id ? 'Wgrywam…' : c.photo_url ? 'Zmień zdjęcie' : 'Wgraj zdjęcie'}
                  <input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={uploading === c.id} onChange={(e) => uploadPhoto(c.id, e.target.files?.[0])} />
                </label>
                {c.photo_url && (
                  <button className="btn sm quiet" onClick={() => removePhoto(c.id)}>
                    Usuń
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
