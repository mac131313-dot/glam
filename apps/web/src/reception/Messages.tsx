// Wiadomości recepcji: te same co w panelu (Rozmowy, Napisz do grupy, Prośby o kontakt, Dla mnie) – jedna
// lista rozmów dla panelu i telefonu, pasek zakładek przesuwa się w bok.
import { lazy } from 'react';
import type { Role } from '@glam/core';
import { Lazy } from '../ui.tsx';

const Messages = lazy(() => import('../staff/Messages.tsx'));

export function ReceptionMessages({ roles }: { roles: string[] }) {
  return (
    <Lazy>
      <Messages roles={roles as Role[]} />
    </Lazy>
  );
}
