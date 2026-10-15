// Kontrakt między edytorem w panelu a podglądem strony w <iframe>.
// Panel i strona działają pod jednym adresem, ale i tak rozmawiają przez postMessage z jawnym originem
// (nigdy '*'), a odbiorca sprawdza origin, nadawcę i kanał.
import type { SiteDoc } from '@glam/core';

export const CHANNEL = 'glam-edytor';

/** Id sekcji stałych na stronie (pozostałe sekcje mają id = klucz sekcji z dokumentu). */
export const HERO_ID = 'hero';
export const FOOTER_ID = 'stopka';

export type FromSite =
  /** most wstał; lista sekcji widocznych na stronie */
  | { rodzaj: 'gotowy'; sekcje: { id: string; nazwa: string }[] }
  /** kliknięto sekcję w podglądzie */
  | { rodzaj: 'wybrano'; sekcja: string }
  /** kliknięto „+” nad lub pod zaznaczoną sekcją */
  | { rodzaj: 'dodaj'; sekcja: string; gdzie: 'przed' | 'po' }
  /** skrót klawiszowy wciśnięty z fokusem w ramce (cofnij, ponów, zapisz działają w całym edytorze) */
  | { rodzaj: 'skrot'; akcja: 'cofnij' | 'ponow' | 'zapisz' };

export type ToSite =
  /** najechano wiersz w drzewku */
  | { rodzaj: 'podswietl'; sekcja: string | null }
  /** kliknięto wiersz: przewiń i zaznacz */
  | { rodzaj: 'przewin'; sekcja: string | null }
  /** przewiń na dół (nowa sekcja na końcu) */
  | { rodzaj: 'przewinDol' }
  /** dokument na żywo – podgląd rysuje się od razu, bez czekania na zapis */
  | { rodzaj: 'dokument'; doc: SiteDoc }
  /** dane studia się zmieniły (np. publikacja) – pobierz je ponownie, bez przeładowania i utraty scrolla */
  | { rodzaj: 'odswiez' };

export type Envelope<T> = T & { kanal: typeof CHANNEL };

export function isEnvelope(data: unknown): data is Envelope<{ rodzaj: string }> {
  return !!data && typeof data === 'object' && (data as { kanal?: unknown }).kanal === CHANNEL && typeof (data as { rodzaj?: unknown }).rodzaj === 'string';
}
