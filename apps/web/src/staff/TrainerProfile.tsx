// Mój profil (trenerka): opis własny na stronę WWW i do aplikacji, film „poznajmy się” i zaproszenia na własne zajęcia.
// Jedno miejsce na wszystko, co trenerka ustawia o sobie: zdjęcie, bio, opis, film, zaproszenia i osobiste życzenia urodzinowe.
// Formularze same pilnują wartości: licznik znaków, długość filmu sprawdzana od razu po wybraniu pliku.
import { useState } from 'react';
import { api, fmtDay, fmtTime, useApi } from '../api.ts';
import type { Me } from '../App.tsx';
import { AuthVideo, Empty, Field, readFile, Select, Spinner, Toggle, useAction, useToast } from '../ui.tsx';
import { preparePhoto } from './logoUpload.ts';

type Invite = { id: string; body: string; sessionId: string; startsAt: string; className: string; zone: string; spotsLeft: number };
type Profile = {
  bio: string | null;
  about: string | null;
  videoUrl: string | null;
  birthdayWishes: boolean;
  invites: Invite[];
  sessions: { id: string; startsAt: string; className: string; zone: string }[];
  limits: { bio: number; about: number; invite: number; videoSec: number };
};

export default function TrainerProfile({ me, reloadMe }: { me: Me; reloadMe: () => Promise<void> }) {
  const profile = useApi<Profile>('/staff/profile');
  if (!profile.data) return <Spinner />;
  const p = profile.data;
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <div>
        <h1>Mój profil</h1>
        <p className="muted">Tak poznają Cię klientki – na stronie studia i w aplikacji, po kliknięciu w Twoje imię.</p>
      </div>
      <PhotoCard me={me} reloadMe={reloadMe} />
      <About profile={p} onSaved={profile.reload} />
      <Video profile={p} onSaved={profile.reload} />
      <Invites profile={p} onSaved={profile.reload} />
      <Wishes profile={p} onSaved={profile.reload} />
    </div>
  );
}

/** Zdjęcie z konta (to samo w aplikacji, panelu i na stronie WWW, jeśli studio nie wstawiło tam innego). */
function PhotoCard({ me, reloadMe }: { me: Me; reloadMe: () => Promise<void> }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const url = me.user.avatarUrl;
  const pick = async (file: File) => {
    let dataUrl: string;
    try {
      dataUrl = await preparePhoto(file, 900);
    } catch (e) {
      return toast((e as Error).message);
    }
    run(() => api('/me/avatar', { method: 'PUT', body: { dataUrl } }).then(reloadMe), 'Zdjęcie zapisane');
  };
  return (
    <section className="card row" style={{ gap: 18, alignItems: 'center' }}>
      <div style={{ width: 96, aspectRatio: '3 / 4', borderRadius: 14, overflow: 'hidden', background: 'var(--soft)', flex: 'none', display: 'grid', placeItems: 'center' }}>
        {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="serif" style={{ fontSize: '2rem', color: 'var(--muted)' }}>{(me.user.name ?? '?').charAt(0)}</span>}
      </div>
      <div className="stack grow" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Zdjęcie</h2>
        <p className="small muted" style={{ margin: 0 }}>Najlepiej pionowe, w jasnym świetle. Widać je na stronie studia i w aplikacji.</p>
        <label className={`btn ${url ? 'ghost' : ''} sm`} style={{ alignSelf: 'flex-start' }} aria-disabled={busy}>
          {url ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => (e.target.files?.[0] && pick(e.target.files[0]), (e.target.value = ''))} />
        </label>
      </div>
    </section>
  );
}

function About({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [about, setAbout] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const { run, busy } = useAction();
  const value = about ?? profile.about ?? '';
  const bioValue = bio ?? profile.bio ?? '';
  return (
    <section className="card stack">
      <h2>O mnie</h2>
      <Field label="Jedno zdanie pod imieniem" hint={`Np. „Reformer i mat. Spokojnie, technicznie, z uśmiechem 🌿”. ${bioValue.length}/${profile.limits.bio}`}>
        <input className="input" value={bioValue} maxLength={profile.limits.bio} onChange={(e) => setBio(e.target.value)} />
      </Field>
      <Field label="Opis własny – Twoimi słowami" hint={`Jak zaczęła się Twoja przygoda z ruchem, co lubisz na zajęciach, czego mogą się spodziewać. Pusta linia = nowy akapit. ${value.length}/${profile.limits.about}`}>
        <textarea className="input" rows={8} value={value} maxLength={profile.limits.about} onChange={(e) => setAbout(e.target.value)} />
      </Field>
      <button
        className="btn sm"
        style={{ alignSelf: 'flex-start' }}
        disabled={(about === null && bio === null) || busy}
        onClick={() => run(() => api('/staff/profile', { method: 'PUT', body: { about: value, bio: bioValue } }).then(() => (setAbout(null), setBio(null), onSaved())), 'Zapisane')}
      >
        Zapisz
      </button>
    </section>
  );
}

function Wishes({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const { run } = useAction();
  return (
    <section className="card stack">
      <Toggle
        label="Osobiste życzenia urodzinowe"
        hint="W dniu urodzin Twoich klientek wyślemy życzenia podpisane Twoim imieniem (szablon z sekcji 8.1). Zawsze możesz wyłączyć."
        checked={profile.birthdayWishes}
        onChange={(v) => run(() => api('/staff/profile', { method: 'PUT', body: { birthdayWishes: v } }).then(onSaved), 'Zapisane')}
      />
    </section>
  );
}

function Video({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [error, setError] = useState('');
  const { run, busy } = useAction();
  const max = profile.limits.videoSec;

  const pick = (file: File) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = url;
    v.onerror = () => setError('Nie udało się odczytać filmu. Spróbuj MP4 albo MOV.');
    const check = async (duration: number) => {
      URL.revokeObjectURL(url);
      if (duration > max + 0.5) return setError(`Film może mieć max ${max} sekund – ten ma ${Math.round(duration)} s.`);
      setError('');
      const dataUrl = await readFile(file);
      run(() => api('/staff/profile/video', { method: 'POST', body: { dataUrl, durationSec: duration } }).then(onSaved), 'Film dodany');
    };
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration)) return check(v.duration);
      // WebM nagrany w przeglądarce nie ma długości w nagłówku – przewinięcie na koniec ją odsłania.
      v.ontimeupdate = () => ((v.ontimeupdate = null), check(v.duration));
      v.currentTime = 1e101;
    };
  };

  return (
    <section className="card stack">
      <h2>Film „poznajmy się”</h2>
      <p className="small muted">Kilka zdań do kamery: kim jesteś i na co zapraszasz. Do {max} sekund, nagrany telefonem wystarczy.</p>
      {profile.videoUrl && <AuthVideo key={profile.videoUrl} src={profile.videoUrl} controls playsInline style={{ width: '100%', maxWidth: 320, borderRadius: 14, background: 'var(--soft)' }} />}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className={`btn ${profile.videoUrl ? 'ghost' : ''} sm`} aria-disabled={busy}>
          {busy ? 'Wgrywam…' : profile.videoUrl ? 'Nagraj nowy' : 'Dodaj film'}
          <input type="file" accept="video/mp4,video/quicktime,video/webm" capture="user" hidden disabled={busy} onChange={(e) => (e.target.files?.[0] && pick(e.target.files[0]), (e.target.value = ''))} />
        </label>
        {profile.videoUrl && (
          <button className="btn ghost sm" disabled={busy} onClick={() => run(() => api('/staff/profile/video', { method: 'DELETE' }).then(onSaved), 'Film usunięty')}>
            Usuń film
          </button>
        )}
      </div>
      {error && <span className="tiny" style={{ color: 'var(--danger)' }}>{error}</span>}
    </section>
  );
}

function Invites({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [sessionId, setSessionId] = useState('');
  const [body, setBody] = useState('');
  const { run, busy } = useAction();
  const chosen = sessionId || profile.sessions[0]?.id || '';
  const label = (s: { startsAt: string; className: string; zone: string }) => `${fmtDay(s.startsAt)} ${fmtTime(s.startsAt)} · ${s.className} · ${s.zone}`;

  return (
    <section className="card stack">
      <h2>Zaproszenia na moje zajęcia</h2>
      <p className="small muted">Klientki zobaczą je na ekranie Start i w Twoim profilu – z przyciskiem zapisu.</p>
      {profile.sessions.length === 0 ? (
        <p className="small muted">Nie masz nadchodzących zajęć bez zaproszenia w najbliższych 3 tygodniach.</p>
      ) : (
        <div className="stack">
          <Field label="Zajęcia">
            <Select value={chosen} onChange={setSessionId} options={profile.sessions.map((s) => ({ value: s.id, label: label(s) }))} ariaLabel="Zajęcia" />
          </Field>
          <Field label="Kilka słów od Ciebie" hint={`${body.length}/${profile.limits.invite}`}>
            <textarea className="input" rows={3} value={body} maxLength={profile.limits.invite} placeholder="Np. Spokojne tempo i dużo pracy z oddechem – idealne na początek tygodnia 🌿" onChange={(e) => setBody(e.target.value)} />
          </Field>
          <button
            className="btn sm"
            style={{ alignSelf: 'flex-start' }}
            disabled={!chosen || body.trim().length < 3 || busy}
            onClick={() => run(() => api('/staff/invites', { method: 'POST', body: { sessionId: chosen, body } }).then(() => (setBody(''), setSessionId(''), onSaved())), 'Zaproszenie widać w aplikacji')}
          >
            Zaproś
          </button>
        </div>
      )}
      {profile.invites.length === 0 ? (
        <Empty>Na razie bez zaproszeń.</Empty>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {profile.invites.map((i) => (
            <li key={i.id} className="card flat row between" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{label(i)}</div>
                <div className="small">{i.body}</div>
                <div className="tiny muted">{i.spotsLeft > 0 ? `wolne miejsca: ${i.spotsLeft}` : 'komplet'}</div>
              </div>
              <button className="btn ghost sm" disabled={busy} onClick={() => run(() => api(`/staff/invites/${i.id}`, { method: 'DELETE' }).then(onSaved), 'Zaproszenie usunięte')}>
                Usuń
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
