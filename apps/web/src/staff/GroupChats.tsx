// Aplikacja trenerki → Rozmowy: prywatne wiadomości od klientek („Napisz do trenerki”) i czaty grup,
// którymi się opiekuje (moderatorki widzą wszystkie grupy). Te same widoki co w aplikacji klientki.
import { useEffect, useState } from 'react';
import { can, type Role } from '@glam/core';
import { useApi } from '../api.ts';
import { DirectChatPage, GroupChatPage, ThreadRow, type ThreadItem } from '../groupChat.tsx';
import { Empty, Spinner } from '../ui.tsx';

export default function GroupChats({ roles }: { roles: Role[] }) {
  const list = useApi<(ThreadItem & { mine: boolean })[]>('/staff/group-chats');
  const isTrainer = roles.includes('trainer');
  const dms = useApi<ThreadItem[]>(isTrainer ? '/staff/dm' : null);
  const [open, setOpen] = useState<string | null>(null);
  const [dm, setDm] = useState<string | null>(null);
  const all = can(roles, 'community.moderate');

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && !open && !dm && (list.reload(), dms.reload()), 15_000);
    return () => clearInterval(t);
  }, [list.reload, dms.reload, open, dm]);

  const mine = list.data?.filter((g) => g.mine) ?? [];
  const rest = list.data?.filter((g) => !g.mine) ?? [];
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>
          Rozmowy <span className="serif">razem</span>
        </h1>
        <p className="small muted" style={{ margin: 0 }}>W grupie piszesz do wszystkich naraz. Prywatne wiadomości widzicie tylko Ty i klientka.</p>
      </div>
      {isTrainer && (dms.data?.length ?? 0) > 0 && (
        <section>
          <div className="eyebrow thread-group-head">Wiadomości od klientek</div>
          <ul className="thread-list">
            {dms.data!.map((d) => (
              <ThreadRow key={d.id} g={d} onOpen={() => setDm(d.id)} />
            ))}
          </ul>
        </section>
      )}
      {list.error?.code === 'feature_off' ? (
        // Bez grup w planie studia wiadomości od klientek nadal działają.
        <Empty>Studio nie prowadzi jeszcze grup.</Empty>
      ) : !list.data ? (
        <Spinner />
      ) : list.data.length === 0 ? (
        <Empty>Nie opiekujesz się jeszcze żadną grupą. Studio przypisze Cię w Społeczność → Grupy.</Empty>
      ) : (
        <>
          {mine.length > 0 && (
            <section>
              <div className="eyebrow thread-group-head">{all ? 'Twoje grupy' : 'Moje grupy'}</div>
              <ul className="thread-list">
                {mine.map((g) => (
                  <ThreadRow key={g.id} g={g} onOpen={() => setOpen(g.id)} />
                ))}
              </ul>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <div className="eyebrow thread-group-head">{mine.length > 0 ? 'Pozostałe grupy studia' : 'Grupy studia'}</div>
              <ul className="thread-list">
                {rest.map((g) => (
                  <ThreadRow key={g.id} g={g} onOpen={() => setOpen(g.id)} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {open && <GroupChatPage groupId={open} onBack={() => (setOpen(null), list.reload())} />}
      {dm && <DirectChatPage path={`/staff/dm/${dm}`} hint="prywatna rozmowa z klientką" onBack={() => (setDm(null), dms.reload())} />}
    </div>
  );
}
