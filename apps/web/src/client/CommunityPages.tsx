// Społeczność (4.5, 4.3, 4.12.4): feed z kalendarzem wydarzeń, grupy, wyzwania, wspólna playlista, zaproszenia
// (polecenie z pierwszymi zajęciami gratis, wejściówka-prezent z QR i przepisaniem, zaproszenia na zajęcia).
import { useEffect, useState } from 'react';
import { api, fmtDay, goToCheckout, fmtLongDay, fmtTime, useApi } from '../api.ts';
import { AuthImg, Avatar, Empty, Field, availableMethods, PAYMENT_LABELS, Pending, Progress, QrCode, readFile, Sheet, Spinner, Tabs, Toggle, useAction, useToast } from '../ui.tsx';
import { ThreadRow, type ThreadItem } from '../groupChat.tsx';
import { useClient } from './ClientApp.tsx';
import type { RouteProps } from './router.tsx';

export default function CommunityPages({ route, arg }: RouteProps) {
  if (route === 'groups') return <Groups />;
  if (route === 'challenges') return <Challenges focus={arg} />;
  if (route === 'music') return <Music />;
  if (route === 'invites') return <Invites />;
  return <Feed group={arg} />;
}

type Post = {
  id: string;
  kind: string;
  body: string;
  mediaUrl: string | null;
  event_at: string | null;
  created_at: string;
  hidden: number;
  likes: number;
  liked: boolean;
  comments: number;
  mine: boolean;
  author: { name: string; avatarUrl: string | null; staff: boolean };
  commentsList: { id: string; body: string; created_at: string; author: { name: string }; mine: boolean }[];
};

const KIND: Record<string, string> = { announcement: 'Ogłoszenie', story: 'Od trenerki', event: 'Wydarzenie', post: '' };

export function Feed({ group }: { group?: string | null }) {
  const feed = useApi<Post[]>(`/feed${group ? `?group=${group}` : ''}`, [group]);
  const events = useApi<{ id: string; body: string; event_at: string }[]>('/feed/events');
  const rules = useApi<string[]>('/community/rules');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [report, setReport] = useState<{ kind: string; id: string } | null>(null);
  const { run, busy } = useAction();
  if (feed.error?.code === 'feature_off') return <Empty>Studio nie prowadzi jeszcze feedu.</Empty>;
  return (
    <div className="stack-lg">
      {!group && events.data && events.data.length > 0 && (
        <section className="stack" style={{ gap: 'var(--space-2)' }}>
          <div className="eyebrow">Kalendarz wydarzeń</div>
          {events.data.map((e) => (
            <div key={e.id} className="card soft row" style={{ gap: 'var(--space-4)' }}>
              <div className="center" style={{ minWidth: 48 }}>
                <div className="serif" style={{ fontSize: '1.6rem', lineHeight: 1 }}>{new Date(e.event_at).getDate()}</div>
                <div className="tiny muted">{fmtTime(e.event_at)}</div>
              </div>
              <div className="small">{e.body}</div>
            </div>
          ))}
        </section>
      )}
      <section className="card stack">
        <textarea className="input" style={{ minHeight: 80 }} placeholder="Podziel się czymś miłym ze studiem…" value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} />
        {photo && <img src={photo} alt="" style={{ maxHeight: 180, borderRadius: 14, objectFit: 'cover' }} />}
        {photo && <Toggle label="Osoby na zdjęciu zgodziły się na publikację" checked={consent} onChange={setConsent} />}
        <div className="row between">
          <label className="btn ghost sm">
            Zdjęcie
            <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files?.[0] && setPhoto(await readFile(e.target.files[0]))} />
          </label>
          <button
            className="btn sm"
            disabled={!text.trim() || busy}
            onClick={() =>
              run(async () => {
                await api('/posts', { method: 'POST', body: { body: text, groupId: group ?? null, photo, photoConsent: consent } });
                setText('');
                setPhoto(null);
                setConsent(false);
                feed.reload();
              }, 'Opublikowane')
            }
          >
            Opublikuj
          </button>
        </div>
      </section>
      {!feed.data ? (
        <Pending error={feed.error} reload={feed.reload} />
      ) : feed.data.length === 0 ? (
        <Empty>Jeszcze tu cicho. Napisz pierwsza</Empty>
      ) : (
        feed.data.map((p) => (
          <article key={p.id} className={`card ${p.kind === 'announcement' ? 'soft' : ''} stack`} style={{ gap: 'var(--space-3)', opacity: p.hidden ? 0.5 : 1 }}>
            <div className="row">
              <Avatar name={p.author.name} size="sm" />
              <div className="grow">
                <b>{p.author.name}</b> {KIND[p.kind] && <span className="badge">{KIND[p.kind]}</span>}
                <div className="tiny muted">{fmtDay(p.created_at)}</div>
              </div>
            </div>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.body}</p>
            {p.event_at && <div className="small">📅 {fmtLongDay(p.event_at)}, {fmtTime(p.event_at)}</div>}
            {p.mediaUrl && <AuthImg src={p.mediaUrl} alt="" style={{ width: '100%', borderRadius: 16, objectFit: 'cover', maxHeight: 360 }} />}
            <div className="row small">
              <button className="link" onClick={() => run(() => api(`/posts/${p.id}/like`, { method: 'POST' }).then(feed.reload))}>
                {p.liked ? '♥' : '♡'} {p.likes}
              </button>
              <span className="muted">{p.comments} komentarzy</span>
              <span className="grow" />
              {p.mine ? (
                <button className="link tiny" onClick={() => run(() => api(`/posts/${p.id}`, { method: 'DELETE' }).then(feed.reload), 'Usunięte')}>
                  usuń
                </button>
              ) : (
                <button className="link tiny" onClick={() => setReport({ kind: 'post', id: p.id })}>
                  zgłoś
                </button>
              )}
            </div>
            {p.commentsList.map((c) => (
              <div key={c.id} className="small" style={{ paddingLeft: 'var(--space-3)', borderLeft: '2px solid var(--line)' }}>
                <b>{c.author.name}</b> {c.body}
                {!c.mine && (
                  <button className="link tiny" style={{ marginLeft: 'var(--space-2)' }} onClick={() => setReport({ kind: 'comment', id: c.id })}>
                    zgłoś
                  </button>
                )}
              </div>
            ))}
            <CommentBox postId={p.id} onDone={feed.reload} />
          </article>
        ))
      )}
      {rules.data && (
        <details className="small muted">
          <summary>Zasady społeczności</summary>
          <ul>
            {rules.data.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}
      {report && <ReportSheet target={report} onClose={() => setReport(null)} />}
    </div>
  );
}

function CommentBox({ postId, onDone }: { postId: string; onDone: () => void }) {
  const [t, setT] = useState('');
  const { run, busy } = useAction();
  return (
    <div className="row">
      <input className="input" style={{ minHeight: 40, padding: 'var(--space-2) var(--space-4)' }} placeholder="Skomentuj…" value={t} onChange={(e) => setT(e.target.value)} />
      <button className="btn ghost sm" disabled={!t.trim() || busy} onClick={() => run(() => api(`/posts/${postId}/comments`, { method: 'POST', body: { body: t } }).then(() => (setT(''), onDone())))}>
        Dodaj
      </button>
    </div>
  );
}

export function ReportSheet({ target, onClose }: { target: { kind: string; id: string }; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const { run } = useAction();
  return (
    <Sheet onClose={onClose} label="Zgłoś treść">
      <div className="stack">
        <h2>Zgłoś treść</h2>
        <p className="small muted">Moderacja studia zajmie się tym dyskretnie. Autorka nie dowie się, kto zgłosił.</p>
        <textarea className="input" placeholder="Co jest nie tak? (opcjonalnie)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn block" onClick={() => run(() => api('/reports', { method: 'POST', body: { targetKind: target.kind, targetId: target.id, reason } }).then((r) => (onClose(), r)))}>
          Wyślij zgłoszenie
        </button>
      </div>
    </Sheet>
  );
}

type GroupItem = ThreadItem & { members: number; description: string | null; approval: number; joined: number; requested: number };

// Rozmowę (także z powiadomienia „community/groups/<id>”) otwiera RouteView jako osobny ekran – GroupChatPage.
function Groups() {
  const groups = useApi<GroupItem[]>('/groups');
  // Prywatne rozmowy z trenerkami – na tej samej liście co grupy, jak w komunikatorze.
  const dms = useApi<ThreadItem[]>('/dm');
  const { open } = useClient();
  const { run } = useAction();
  // Po powrocie z rozmowy odświeżamy liczniki.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && (groups.reload(), dms.reload()), 15_000);
    return () => clearInterval(t);
  }, [groups.reload, dms.reload]);
  if (!groups.data) return <Pending error={groups.error} reload={groups.reload} />;
  const direct = (dms.data ?? []).map((d) => ({ ...d, route: `dm/${d.id}` }));
  if (groups.data.length === 0 && direct.length === 0) return <Empty icon="🌸">Studio nie założyło jeszcze grup.</Empty>;
  const mine = [...groups.data.filter((g) => g.joined).map((g) => ({ ...g, route: `groups/${g.id}` })), ...direct].sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? ''));
  const others = groups.data.filter((g) => !g.joined);
  return (
    <div className="stack">
      {mine.length > 0 && (
        <ul className="thread-list">
          {mine.map((g) => (
            <ThreadRow key={g.route} g={g} onOpen={() => open(g.route)} />
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <>
          <div className="eyebrow thread-group-head">{mine.length ? 'Dołącz do kolejnej' : 'Dołącz do grupy'}</div>
          <ul className="session-list">
            {others.map((g) => (
              <li key={g.id} className="group-row">
                <span className="group-main">
                  <span className="session-title">{g.name}</span>
                  {g.description && <span className="session-meta">{g.description}</span>}
                  <span className="session-meta">
                    {g.trainer ? `prowadzi ${g.trainer} · ` : ''}
                    {g.members > 0 ? `${g.members} ${osoby(g.members)}` : 'bądź pierwsza'}
                    {g.approval ? ' · dołączanie za zgodą studia' : ''}
                  </span>
                </span>
                {g.requested ? (
                  <button className="link small muted" title="Kliknij, żeby wycofać prośbę" onClick={() => run(() => api(`/groups/${g.id}/leave`, { method: 'POST' }).then(groups.reload), 'Prośba wycofana')}>
                    Prośba wysłana
                  </button>
                ) : (
                  <button
                    className="link small"
                    onClick={() =>
                      run(
                        () => api<{ requested?: boolean; message?: string }>(`/groups/${g.id}/join`, { method: 'POST' }).then((r) => (groups.reload(), r)),
                        (r) => r?.message ?? 'Witaj w grupie',
                      )
                    }
                  >
                    {g.approval ? 'Poproś o dołączenie' : 'Dołącz'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

type Challenge = { id: string; title: string; description: string | null; metric: string; target: number; starts_on: string; ends_on: string; joined_at: string | null; completed_at: string | null; members: number; progress: number; checkedToday: boolean; active: boolean; badge: { name: string } | null; author_name: string | null; class_name: string | null };

function Challenges({ focus }: { focus: string | null }) {
  const list = useApi<Challenge[]>('/challenges');
  const { run } = useAction();
  if (list.error?.code === 'feature_off') return <Empty>Studio nie prowadzi teraz wyzwań.</Empty>;
  if (!list.data) return <Pending error={list.error} reload={list.reload} />;
  const METRIC: Record<string, string> = { trainings: 'treningów', mindful: 'chwil dla siebie', checkins: 'dni' };
  return (
    <div className="stack">
      {list.data.length === 0 && <Empty>Nowe wyzwania pojawią się wkrótce.</Empty>}
      {[...list.data].sort((a, b) => Number(b.id === focus) - Number(a.id === focus)).map((c) => (
        <section key={c.id} className={`card ${c.joined_at ? 'soft' : 'flat'} stack`} style={{ gap: 'var(--space-2)' }}>
          <div className="row between">
            <b>{c.title}</b>
            {c.completed_at ? <span className="badge ok">ukończone</span> : !c.active && <span className="badge">zakończone</span>}
          </div>
          {(c.author_name || c.class_name) && (
            <div className="tiny muted">
              {c.author_name && `trenerka ${c.author_name}`}
              {c.author_name && c.class_name && ' · '}
              {c.class_name && `dla grupy ${c.class_name}`}
            </div>
          )}
          {c.description && <p className="small" style={{ margin: 0, whiteSpace: 'pre-line' }}>{c.description}</p>}
          <div className="tiny muted">
            {c.starts_on.split('-').reverse().join('.')} – {c.ends_on.split('-').reverse().join('.')} · {c.members} {uczestniczki(c.members)} {c.badge && `· odznaka „${c.badge.name}”`}
          </div>
          {c.joined_at ? (
            <>
              <Progress value={c.progress} max={c.target} label="Postęp wyzwania" />
              <div className="row between small">
                <span>
                  {c.progress} / {c.target} {METRIC[c.metric]}
                </span>
                {c.metric === 'checkins' && c.active && !c.completed_at && (
                  <button className="btn sm" disabled={c.checkedToday} onClick={() => run(() => api(`/challenges/${c.id}/checkin`, { method: 'POST' }).then(list.reload), 'Odhaczone')}>
                    {c.checkedToday ? 'Dziś odhaczone' : 'Odhacz dziś'}
                  </button>
                )}
                {c.metric !== 'checkins' && !c.completed_at && (
                  <button className="link tiny" onClick={() => run(() => api(`/challenges/${c.id}/refresh`, { method: 'POST' }).then(list.reload))}>
                    odśwież
                  </button>
                )}
              </div>
            </>
          ) : (
            c.active && (
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => run(() => api(`/challenges/${c.id}/join`, { method: 'POST' }).then((r) => (list.reload(), r)))}>
                Dołączam
              </button>
            )
          )}
        </section>
      ))}
      <p className="tiny muted">Bez rankingów – każda idzie w swoim tempie.</p>
    </div>
  );
}

function Music() {
  const data = useApi<{ playlists: { id: string; provider: string; url: string; name: string; purpose: string; class_name: string | null }[]; shared: { id: string; title: string; artist: string | null; track_url: string; status: string; votes: number; voted: number; mine: number; added_by: string }[] }>('/playlists');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const { run, busy } = useAction();
  if (data.error?.code === 'feature_off') return <Empty>Studio nie udostępnia jeszcze playlist.</Empty>;
  if (!data.data) return <Pending error={data.error} reload={data.reload} />;
  const PURPOSE: Record<string, string> = { class: 'Na zajęcia', meditation: 'Medytacja', stretch: 'Stretch', sleep: 'Na sen', shared: 'Wspólna' };
  return (
    <div className="stack-lg">
      <section className="stack" style={{ gap: 'var(--space-2)' }}>
        <div className="eyebrow">Playlisty studia</div>
        {data.data.playlists.map((p) => (
          <a key={p.id} className="card flat row between" href={p.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <span>
              <b>{p.name}</b>
              <span className="small muted" style={{ display: 'block' }}>
                {PURPOSE[p.purpose]} {p.class_name ? `· ${p.class_name}` : ''} · {p.provider === 'spotify' ? 'Spotify' : 'Apple Music'}
              </span>
            </span>
            <span className="small">Otwórz ↗</span>
          </a>
        ))}
      </section>
      <section className="stack" style={{ gap: 'var(--space-2)' }}>
        <div className="eyebrow">Wspólna playlista – głosuj</div>
        <p className="tiny muted m-0">Najpopularniejsze utwory trafiają na zajęcia w tym tygodniu. Trenerka zatwierdza propozycje.</p>
        {data.data.shared.map((t) => (
          <div key={t.id} className="row between card flat">
            <a href={t.track_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              <b>{t.title}</b>
              <span className="small muted" style={{ display: 'block' }}>
                {t.artist} · dodała {t.added_by} {t.status === 'pending' && '· czeka na zatwierdzenie'}
              </span>
            </a>
            {t.status === 'approved' && (
              <button className="btn ghost sm" onClick={() => run(() => api(`/playlists/shared/${t.id}/vote`, { method: 'POST' }).then(data.reload))}>
                {t.voted ? '♥' : '♡'} {t.votes}
              </button>
            )}
          </div>
        ))}
        <Field label="Zaproponuj utwór (link ze Spotify lub Apple Music)" hint="Jedna propozycja dziennie.">
          <input className="input" placeholder="https://open.spotify.com/track/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="row">
          <input className="input" placeholder="Tytuł" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input" placeholder="Wykonawca" value={artist} onChange={(e) => setArtist(e.target.value)} />
        </div>
        <button className="btn" disabled={!url || !title || busy} onClick={() => run(() => api('/playlists/shared', { method: 'POST', body: { url, title, artist } }).then((r) => (setUrl(''), setTitle(''), setArtist(''), data.reload(), r)))}>
          Zaproponuj
        </button>
      </section>
      <p className="tiny muted">Muzykę odtwarzasz w aplikacji Spotify / Apple Music – my nie przechowujemy historii słuchania.</p>
    </div>
  );
}

type GuestPass = { id: string; code: string; recipient_phone: string | null; status: string; variant: string; created_at: string; expires_at: string; activated_by_name: string | null };
const GP_STATUS: Record<string, [string, string]> = { sent: ['wysłana', 'warn'], activated: ['aktywowana', 'ok'], used: ['wykorzystana', 'ok'], expired: ['wygasła', ''] };

function Invites() {
  const { studio, me } = useClient();
  const [tab, setTab] = useState<'friend' | 'gift' | 'classes'>('friend');
  return (
    <div className="stack-lg">
      <Tabs
        label="Zaproszenia"
        value={tab}
        onChange={setTab}
        options={[
          ['friend', 'Polecenie'],
          ['gift', 'Wejściówka w prezencie'],
          ['classes', 'Zaproszenia na zajęcia'],
        ]}
      />
      {tab === 'friend' && <Referrals studioName={studio.name} free={studio.referral.friendFirstClassFree} name={me.user.name} />}
      {tab === 'gift' && <GiftPasses />}
      {tab === 'classes' && <SessionInvites />}
    </div>
  );
}

function share(text: string, url: string | undefined, toast: (t: string) => void) {
  if (navigator.share) navigator.share({ text, url }).catch(() => {});
  else navigator.clipboard.writeText(url ? `${text} ${url}` : text).then(() => toast('Skopiowano – wklej znajomej'));
}

function Referrals({ studioName, free, name }: { studioName: string; free: boolean; name: string | null }) {
  const list = useApi<{ id: string; code: string; invitee_phone: string | null; statusText: string; status: string; created_at: string }[]>('/my/referrals');
  const [phone, setPhone] = useState('');
  const [created, setCreated] = useState<{ code: string; text: string; link: string } | null>(null);
  const { run, busy } = useAction();
  const toast = useToast();
  const create = (channel: string) =>
    run(async () => {
      const r = await api<{ code: string; text: string; link: string }>('/referrals', { method: 'POST', body: { phone: phone || undefined, channel } });
      setCreated(r);
      list.reload();
      if (channel === 'whatsapp') window.open(`https://wa.me/?text=${encodeURIComponent(`${r.text} ${r.link}`)}`, '_blank');
      if (channel === 'messenger') window.open(`https://www.facebook.com/dialog/send?link=${encodeURIComponent(r.link)}&app_id=0&redirect_uri=${encodeURIComponent(r.link)}`, '_blank');
      if (channel === 'link') share(r.text, r.link, toast);
    }, channel === 'sms' ? 'Wysłałyśmy SMS' : undefined);
  return (
    <div className="stack">
      <div className="welcome-hero stack">
        <h2 className="m-0">
          Zaproś <span className="serif">znajomą</span>
        </h2>
        <p className="m-0">
          {free ? 'Znajoma dostaje pierwsze zajęcia gratis, a Ty – wejście, gdy kupi swój pierwszy karnet.' : `Zaproś znajomą do ${studioName}.`}
        </p>
      </div>
      <Field label="Numer znajomej (opcjonalnie)" hint="Wystarczy numer – nie potrzebujemy innych danych. Znajoma widzi tylko Twoje imię.">
        <input className="input" inputMode="tel" placeholder="500 600 700" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <div className="pill-row">
        <button className="btn sm" disabled={busy} onClick={() => create('link')}>
          Udostępnij link
        </button>
        <button className="btn ghost sm" disabled={busy || !phone} onClick={() => create('sms')}>
          SMS
        </button>
        <button className="btn ghost sm" disabled={busy} onClick={() => create('whatsapp')}>
          WhatsApp
        </button>
        <button className="btn ghost sm" disabled={busy} onClick={() => create('messenger')}>
          Messenger
        </button>
        <button className="btn ghost sm" disabled={busy} onClick={() => create('instagram')}>
          Instagram
        </button>
      </div>
      {created && (
        <div className="card soft stack center">
          <QrCode text={created.link} size={160} label="Kod zaproszenia" />
          <div className="code" style={{ fontSize: '1.3rem' }}>{created.code}</div>
          <p className="tiny muted m-0">Na Instagramie wklej link w wiadomości do znajomej.</p>
        </div>
      )}
      <div className="eyebrow">Moje zaproszenia</div>
      {list.data?.length === 0 && <Empty>Jeszcze nikogo nie zaprosiłaś.</Empty>}
      {list.data?.map((r) => (
        <div key={r.id} className="row between card flat small">
          <span>
            <span className="code">{r.code}</span> {r.invitee_phone && `· ${r.invitee_phone}`}
            <span className="muted" style={{ display: 'block' }}>{fmtDay(r.created_at)}</span>
          </span>
          <span className={`badge ${r.status === 'sent' ? 'warn' : 'ok'}`}>{r.statusText}</span>
        </div>
      ))}
      <p className="tiny muted">{name ? `${name}, ` : ''}bonus za polecenie: maksymalnie kilka w miesiącu, zgodnie z zasadami studia.</p>
    </div>
  );
}

function GiftPasses() {
  const { studio, me } = useClient();
  const mine = useApi<GuestPass[]>('/my/guest-passes');
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState(studio.guestPassVariants[0]?.id ?? 'single');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [method, setMethod] = useState('blik');
  const [created, setCreated] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<GuestPass | null>(null);
  const [tphone, setTphone] = useState('');
  const { run, busy } = useAction();
  const toast = useToast();
  const v = studio.guestPassVariants.find((x) => x.id === variant);
  const text = (code: string) => `${me.user.name ?? 'Twoja znajoma'} zrobiła Ci prezent 💛 Wejściówka do ${studio.name}. Odbierz w aplikacji GLAM, kod: ${code}`;
  return (
    <div className="stack">
      <button className="btn" onClick={() => (setOpen(true), setCreated(null))}>
        Podaruj wejściówkę
      </button>
      <div className="eyebrow">Moje wejściówki</div>
      {mine.data?.length === 0 && <Empty>Tu zobaczysz wysłane prezenty.</Empty>}
      {mine.data?.map((g) => (
        <div key={g.id} className="card flat stack" style={{ gap: 'var(--space-2)' }}>
          <div className="row between">
            <span className="code" style={{ fontWeight: 500 }}>{g.code}</span>
            <span className={`badge ${GP_STATUS[g.status]?.[1] ?? ''}`}>{GP_STATUS[g.status]?.[0] ?? g.status}</span>
          </div>
          <div className="small muted">
            {g.activated_by_name ? `${g.activated_by_name} odebrała prezent` : g.recipient_phone ? `dla ${g.recipient_phone}` : 'do przekazania'} · ważna do {fmtDay(g.expires_at)}
          </div>
          {g.status === 'sent' && (
            <div className="row">
              <button className="btn ghost sm" onClick={() => share(text(g.code), `${location.origin}/app?wejsciowka=${g.code}`, toast)}>
                Wyślij
              </button>
              <button className="btn ghost sm" onClick={() => setTransfer(g)}>
                Przepisz na inną osobę
              </button>
            </div>
          )}
        </div>
      ))}
      {open && (
        <Sheet onClose={() => setOpen(false)} label="Podaruj wejściówkę">
          {created ? (
            <div className="stack center">
              <div className="gift-open serif" style={{ fontSize: '2.2rem' }}>Prezent gotowy 🎁</div>
              <QrCode text={`${location.origin}/app?wejsciowka=${created}`} size={180} label="QR wejściówki" />
              <div className="card soft code" style={{ fontSize: '1.6rem' }}>{created}</div>
              {phone && <p className="small muted">Wysłałyśmy SMS na numer znajomej.</p>}
              <button className="btn block" onClick={() => share(text(created), `${location.origin}/app?wejsciowka=${created}`, toast)}>
                Udostępnij znajomej
              </button>
            </div>
          ) : (
            <div className="stack">
              <h2>Wejściówka dla znajomej</h2>
              <div className="pill-row">
                {studio.guestPassVariants.map((x) => (
                  <button key={x.id} className="chip" aria-pressed={variant === x.id} onClick={() => setVariant(x.id)}>
                    {x.label} · {x.price}
                  </button>
                ))}
              </div>
              <p className="tiny muted m-0">Ważna {studio.guestPassValidityDays} dni na aktywację. Znajoma aktywuje ją swoim numerem telefonu.</p>
              <Field label="Numer znajomej (opcjonalnie)" hint="Bez numeru dostaniesz kod i QR do przekazania.">
                <input className="input" inputMode="tel" placeholder="500 600 700" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Kartka z życzeniami">
                <textarea className="input" maxLength={300} placeholder="Chodź ze mną na Reformer" value={message} onChange={(e) => setMessage(e.target.value)} />
              </Field>
              <div className="pill-row">
                {availableMethods(['blik', 'apple_pay', 'google_pay', 'p24', 'card']).map((m) => (
                  <button key={m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
                    {PAYMENT_LABELS[m]}
                  </button>
                ))}
              </div>
              <button
                className="btn block"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api<{ code: string; checkoutUrl?: string }>('/guest-passes', { method: 'POST', body: { variantId: variant, recipientPhone: phone || undefined, message, method } });
                    if (goToCheckout(r)) return;
                    setCreated(r.code);
                    mine.reload();
                  })
                }
              >
                Zapłać {v?.price}
              </button>
            </div>
          )}
        </Sheet>
      )}
      {transfer && (
        <Sheet onClose={() => setTransfer(null)} label="Przepisz wejściówkę">
          <div className="stack">
            <h2>Przepisz na inną osobę</h2>
            <p className="small muted">Stary kod przestanie działać, nowa osoba dostanie SMS.</p>
            <input className="input" inputMode="tel" placeholder="Numer nowej osoby" value={tphone} onChange={(e) => setTphone(e.target.value)} />
            <button className="btn block" disabled={!tphone || busy} onClick={() => run(() => api(`/guest-passes/${transfer.id}/transfer`, { method: 'POST', body: { phone: tphone } }).then((r) => (setTransfer(null), mine.reload(), r)))}>
              Przepisz
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function SessionInvites() {
  const { go } = useClient();
  const invites = useApi<{ id: string; status: string; session_id: string; starts_at: string; class_name: string; from_name: string }[]>('/my/invites');
  const { run } = useAction();
  if (!invites.data) return <Pending error={invites.error} reload={invites.reload} />;
  return (
    <div className="stack">
      <p className="small muted m-0">Chcesz iść z koleżanką? W grafiku wybierz zajęcia i „Umów się z dziewczynami”.</p>
      {invites.data.length === 0 && <Empty>Brak zaproszeń na zajęcia.</Empty>}
      {invites.data.map((i) => (
        <div key={i.id} className="card flat stack" style={{ gap: 'var(--space-2)' }}>
          <div>
            <b>{i.from_name}</b> zaprasza na <b>{i.class_name}</b>
            <div className="small muted">
              {fmtLongDay(i.starts_at)}, {fmtTime(i.starts_at)}
            </div>
          </div>
          {i.status === 'sent' ? (
            <div className="row">
              <button className="btn sm" onClick={() => run(() => api(`/session-invites/${i.id}`, { method: 'POST', body: { accept: true } }).then((r) => (invites.reload(), r)))}>
                Idę!
              </button>
              <button className="btn ghost sm" onClick={() => run(() => api(`/session-invites/${i.id}`, { method: 'POST', body: { accept: false } }).then((r) => (invites.reload(), r)))}>
                Nie tym razem
              </button>
            </div>
          ) : (
            <span className="badge">{i.status === 'accepted' ? 'idziesz' : 'odmówione'}</span>
          )}
        </div>
      ))}
      <button className="btn ghost" onClick={() => go('schedule')}>
        Otwórz grafik
      </button>
    </div>
  );
}

/** 1 osoba · 2–4 osoby · 5+ osób (12–14 też „osób”). */
const osoby = (n: number) => (n === 1 ? 'osoba' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'osoby' : 'osób');
/** 1 uczestniczka · 2–4 uczestniczki · 5+ uczestniczek. */
const uczestniczki = (n: number) => (n === 1 ? 'uczestniczka' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'uczestniczki' : 'uczestniczek');
