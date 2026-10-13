// Moderacja społeczności (4.5, decyzja 5 i 10): filtr wulgaryzmów, limity treści, zasady.
// Filtr łapie typowe wulgaryzmy i ich odmiany (także z gwiazdkami i cyframi zamiast liter).
// Nie zastępuje człowieka – treść zgłoszona przez klientki trafia do moderacji studia.

const ROOTS = ['kurw', 'chuj', 'huj', 'pierd', 'jeb', 'pizd', 'skurwy', 'spierdal', 'wypierdal', 'zajeb', 'cipa', 'cipk', 'dziwk', 'suka', 'debil', 'idiotk', 'kretyn', 'fuck', 'shit', 'bitch'];

// Ciało i porównania: zgodnie z 6.5 i 10 nie promujemy treści o „spalaniu”, wadze i wyglądzie.
const BODY_SHAME = ['grubas', 'gruba krowa', 'tłusta', 'spaśl', 'wieloryb', 'spal kalorie', 'spalić kalorie', 'spalanie kalorii', 'przed i po'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '*': '', '.': '', '-': '', _: '' };

function squash(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .split('')
    .map((ch) => (ch in LEET ? LEET[ch] : ch))
    .join('')
    .replace(/(.)\1+/g, '$1');
}

export type ModerationResult = { ok: true } | { ok: false; reason: 'profanity' | 'body_shaming' | 'too_long' | 'empty' | 'links' };

export const MODERATION_COPY: Record<Exclude<ModerationResult, { ok: true }>['reason'], string> = {
  profanity: 'Ta treść zawiera słowa, których nie używamy w naszej społeczności.',
  body_shaming: 'Piszemy o ciele z szacunkiem – bez ocen wyglądu i „spalania”.',
  too_long: 'To za długa wiadomość. Skróć ją, proszę.',
  empty: 'Napisz kilka słów.',
  links: 'Linki mogą dodawać tylko osoby z zespołu studia.',
};

export function moderate(text: string, opts: { maxLength?: number; allowLinks?: boolean } = {}): ModerationResult {
  const t = (text ?? '').trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (t.length > (opts.maxLength ?? 2000)) return { ok: false, reason: 'too_long' };
  if (!opts.allowLinks && /https?:\/\/|www\./i.test(t)) return { ok: false, reason: 'links' };
  const words = squash(t).split(/[^a-ząćęłńóśźż]+/);
  if (words.some((w) => ROOTS.some((r) => w.startsWith(r) || (r.length >= 5 && w.includes(r))))) return { ok: false, reason: 'profanity' };
  const flat = squash(t);
  if (BODY_SHAME.some((p) => flat.includes(p))) return { ok: false, reason: 'body_shaming' };
  return { ok: true };
}

export const COMMUNITY_RULES = [
  'Wspieramy się – bez ocen wyglądu, porównań i komentarzy o wadze.',
  'Zdjęcia innych osób publikujemy tylko za ich zgodą.',
  'Bez wulgaryzmów, reklam i treści medycznych „na pewno pomoże”.',
  'Coś Cię zaniepokoiło? Zgłoś to – moderacja studia zajmie się tym dyskretnie.',
];

/** Limit propozycji utworów: jedna dziennie na osobę (4.12.4). */
export const TRACK_SUGGESTIONS_PER_DAY = 1;
