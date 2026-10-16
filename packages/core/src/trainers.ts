// Profil trenerki: opis własny, film „poznajmy się” i zaproszenia na jej zajęcia.

/** Krótkie bio – jedna linijka pod imieniem (karta trenerki, wybór w aplikacji). */
export const TRAINER_BIO_MAX = 300;
/** Opis własny trenerki – dłuższy niż bio (300 znaków), ale wciąż do przeczytania na telefonie. */
export const TRAINER_ABOUT_MAX = 2000;
/** Notka zaproszenia przy terminie zajęć. */
export const TRAINER_INVITE_MAX = 280;
/** Film na profilu: krótki, pionowy lub poziomy – jak trenerka nagra telefonem. */
export const TRAINER_VIDEO_MAX_SEC = 90;

export type InviteCandidate = {
  id: string;
  trainerId: string;
  startsAt: string;
  spotsLeft: number;
  /** klientka jest już zapisana (lub na liście rezerwowej) */
  mine: boolean;
};

/**
 * Które zaproszenia od trenerek pokazać klientce na ekranie Start (lista jest już od najbliższego terminu,
 * tylko przyszłe, publiczne i zaplanowane zajęcia). Zwraca co najwyżej `limit` pozycji.
 */
export function homeInvites<T extends InviteCandidate>(invites: T[], limit = 3): T[] {
  // TODO(Maciek): reguła wyboru zaproszeń na Start – patrz opis w rozmowie.
  return invites.slice(0, limit);
}
