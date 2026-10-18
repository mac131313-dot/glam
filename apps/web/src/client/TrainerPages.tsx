// Profil trenerki w aplikacji (trasa „trainer/<id>”): zdjęcie z konta, bio, film „poznajmy się”, opis własny
// i zaproszenia na jej najbliższe zajęcia z zapisem jednym przyciskiem.
import { useApi } from '../api.ts';
import { AuthVideo, Empty, Pending } from '../ui.tsx';
import { useClient } from './ClientApp.tsx';
import type { RouteProps } from './router.tsx';
import { InviteCard, type TrainerInvite } from './TrainerInvite.tsx';

type Trainer = { id: string; name: string; bio: string | null; about: string | null; avatarUrl: string | null; videoUrl: string | null; classes: string[]; invites: TrainerInvite[] };

export default function TrainerPages({ arg }: RouteProps) {
  const t = useApi<Trainer>(arg ? `/trainers/${arg}` : null);
  const { open } = useClient();
  if (!t.data) return <Pending error={t.error} reload={t.reload} />;
  const p = t.data;
  const paragraphs = (p.about ?? '').split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  return (
    <div className="stack-lg">
      <section className="stack" style={{ gap: 14 }}>
        <div style={{ width: '100%', aspectRatio: '4 / 5', borderRadius: 'var(--radius, 18px)', overflow: 'hidden', background: 'var(--soft)', display: 'grid', placeItems: 'center' }}>
          {p.avatarUrl ? <img src={p.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="serif" style={{ fontSize: '4rem', color: 'var(--muted)' }}>{p.name.charAt(0)}</span>}
        </div>
        <h1 className="serif" style={{ fontSize: '2.6rem', margin: 0 }}>
          {p.name}
        </h1>
        {p.bio && <p className="muted" style={{ margin: 0 }}>{p.bio}</p>}
        {p.classes.length > 0 && <div className="small muted">prowadzi {p.classes.join(' · ')}</div>}
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => open(`dm/${p.id}`)}>
          Napisz wiadomość
        </button>
      </section>

      {p.videoUrl && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="eyebrow">Poznajmy się</div>
          <AuthVideo src={p.videoUrl} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: '70vh', borderRadius: 18, background: 'var(--soft)' }} />
        </section>
      )}

      {paragraphs.length > 0 && (
        <section>
          <div className="eyebrow">O mnie</div>
          {paragraphs.map((x, i) => (
            <p key={i} style={{ lineHeight: 1.6 }}>
              {x}
            </p>
          ))}
        </section>
      )}

      <section className="stack" style={{ gap: 10 }}>
        <div className="eyebrow">Zaprasza Cię na</div>
        {p.invites.length === 0 ? <Empty>Na razie bez zaproszeń – zajrzyj do grafiku.</Empty> : p.invites.map((i) => <InviteCard key={i.id} invite={i} onChange={t.reload} showTrainer={false} />)}
      </section>
    </div>
  );
}
