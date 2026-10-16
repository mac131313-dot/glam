// Aplikacja trenerki → Grupy: rozmowy grup, którymi się opiekuje (moderatorki widzą wszystkie).
// Ten sam czat, który klientki mają w Razem → Grupy – trenerka pisze, odpowiada i ukrywa wiadomości.
import { useEffect, useState } from 'react';
import { can, type Role } from '@glam/core';
import { useApi } from '../api.ts';
import { GroupChatPage, ThreadRow, type ThreadItem } from '../groupChat.tsx';
import { Empty, Spinner } from '../ui.tsx';

export default function GroupChats({ roles }: { roles: Role[] }) {
  const list = useApi<(ThreadItem & { mine: boolean })[]>('/staff/group-chats');
  const [open, setOpen] = useState<string | null>(null);
  const all = can(roles, 'community.moderate');

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && !open && list.reload(), 15_000);
    return () => clearInterval(t);
  }, [list.reload, open]);

  if (list.error?.code === 'feature_off') return <Empty>Studio nie prowadzi jeszcze grup.</Empty>;
  const mine = list.data?.filter((g) => g.mine) ?? [];
  const rest = list.data?.filter((g) => !g.mine) ?? [];
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>
          {all ? 'Grupy' : 'Moje grupy'} <span className="serif">razem</span>
        </h1>
        <p className="small muted" style={{ margin: 0 }}>Piszesz do całej grupy naraz – klientki widzą to w aplikacji w Razem → Grupy i mogą odpowiedzieć.</p>
      </div>
      {!list.data ? (
        <Spinner />
      ) : list.data.length === 0 ? (
        <Empty>Nie opiekujesz się jeszcze żadną grupą. Studio przypisze Cię w Społeczność → Grupy.</Empty>
      ) : (
        <>
          {mine.length > 0 && (
            <ul className="thread-list">
              {mine.map((g) => (
                <ThreadRow key={g.id} g={g} onOpen={() => setOpen(g.id)} />
              ))}
            </ul>
          )}
          {rest.length > 0 && (
            <section>
              {mine.length > 0 && <div className="eyebrow thread-group-head">Pozostałe grupy studia</div>}
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
    </div>
  );
}
