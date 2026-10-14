// Siatka ról (2.1) + koordynatorka społeczności (decyzja 12). Jedno źródło prawdy dla API i panelu.
// Uprawnienia są „co wolno”, a nie „co widać w menu” – serwer sprawdza je przy każdym zapytaniu.

export type Role = 'client' | 'trainer' | 'reception' | 'owner' | 'coordinator';
export const STAFF_ROLES: Role[] = ['trainer', 'reception', 'owner', 'coordinator'];

export type Permission =
  | 'schedule.view'
  | 'schedule.edit'
  | 'day.own'
  | 'day.all'
  | 'participants.view'
  | 'participants.manage'
  | 'messages.group.own'
  | 'messages.group.all'
  | 'notes.write'
  | 'notes.read'
  | 'blocks.edit'
  | 'finance.view'
  | 'finance.export'
  | 'campaigns.edit'
  | 'themes.edit'
  | 'themes.view'
  | 'courses.create'
  | 'courses.approve'
  | 'roles.manage'
  | 'clients.view'
  | 'clients.contact'
  | 'clients.create'
  | 'community.moderate'
  | 'challenges.edit'
  | 'playlists.moderate'
  | 'desk.sell'
  | 'shop.manage'
  | 'events.manage'
  | 'welcomes.write'
  | 'welcomes.approve'
  | 'cards.write'
  | 'cards.manage'
  | 'config.edit'
  | 'chat.answer'
  | 'loyalty.edit';

const MATRIX: Record<Exclude<Role, 'client'>, Permission[]> = {
  trainer: [
    'schedule.view',
    'day.own',
    'participants.view',
    'messages.group.own',
    'notes.write',
    'clients.create',
    'themes.view',
    'courses.create',
    'welcomes.write',
    'cards.write',
    'playlists.moderate',
  ],
  reception: [
    'schedule.view',
    'schedule.edit',
    'day.all',
    'participants.view',
    'participants.manage',
    'messages.group.all',
    'blocks.edit',
    'finance.export',
    'campaigns.edit',
    'clients.view',
    'clients.contact',
    'clients.create',
    'desk.sell',
    'shop.manage',
    'events.manage',
    'cards.manage',
    'chat.answer',
  ],
  // Koordynatorka: wyzwania, grupy, zaproszenia, edycje sezonowe, playlista. Bez finansów, telefonów i kampanii push.
  coordinator: ['schedule.view', 'community.moderate', 'challenges.edit', 'themes.edit', 'themes.view', 'playlists.moderate'],
  owner: [
    'schedule.view',
    'schedule.edit',
    'day.all',
    'participants.view',
    'participants.manage',
    'messages.group.all',
    'notes.read',
    'blocks.edit',
    'finance.view',
    'finance.export',
    'campaigns.edit',
    'themes.edit',
    'themes.view',
    'courses.approve',
    'roles.manage',
    'clients.view',
    'clients.contact',
    'clients.create',
    'community.moderate',
    'challenges.edit',
    'playlists.moderate',
    'desk.sell',
    'shop.manage',
    'events.manage',
    'welcomes.approve',
    'cards.manage',
    'config.edit',
    'chat.answer',
    'loyalty.edit',
  ],
};

export function can(roles: readonly string[], permission: Permission): boolean {
  return roles.some((r) => r !== 'client' && (MATRIX[r as Exclude<Role, 'client'>] ?? []).includes(permission));
}

export function permissionsOf(roles: readonly string[]): Permission[] {
  return [...new Set(roles.flatMap((r) => (r === 'client' ? [] : (MATRIX[r as Exclude<Role, 'client'>] ?? []))))];
}

export const ROLE_LABEL: Record<Role, string> = {
  client: 'klientka',
  trainer: 'trenerka',
  reception: 'recepcja',
  owner: 'właścicielka',
  coordinator: 'koordynatorka społeczności',
};
