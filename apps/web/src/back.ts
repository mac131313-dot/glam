// Warstwy (podstrona, arkusz, odtwarzacz, paywall) a przycisk „Wstecz” telefonu.
// W aplikacji klientki każda otwarta warstwa dokłada wpis do historii przeglądarki, więc Wstecz na Androidzie
// i gest cofania na iOS zamykają najwyższą warstwę zamiast całej aplikacji. Escape robi to samo na komputerze.
// W panelu studia historia należy do sekcji (#hash), więc tam warstwy zamykają się tylko Escape, jak dotąd.
import { useEffect, useRef } from 'react';
import { SURFACE } from './api.ts';

type Layer = { close: () => void };

const layers: Layer[] = [];
/** Ile zdarzeń popstate pochodzi od nas (sprzątanie historii po zamknięciu z UI) i ma zostać pominiętych. */
let ownPops = 0;
/** Wpisy do zdjęcia z historii – zbieramy je, bo zamknięcie kilku podstron naraz to jedno history.go(-n). */
let pendingBack = 0;

if (SURFACE === 'app' && typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ownPops > 0) {
      ownPops--;
      return;
    }
    layers.pop()?.close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && layers.length) history.back();
  });
}

function flushBack() {
  const n = pendingBack;
  pendingBack = 0;
  if (n > 0) {
    ownPops++;
    history.go(-n);
  }
}

/** Rejestruje warstwę: Wstecz / Escape wywołają `onClose`. Zamknięcie z UI zdejmuje wpis z historii. */
export function useLayer(onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;

  useEffect(() => {
    if (SURFACE !== 'app') {
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ref.current();
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    const layer: Layer = { close: () => ref.current() };
    layers.push(layer);
    history.pushState({ glamLayer: true }, '');
    return () => {
      const i = layers.indexOf(layer);
      if (i < 0) return; // zamknięta przyciskiem Wstecz – wpis już zdjęty
      layers.splice(i, 1);
      pendingBack++;
      queueMicrotask(flushBack);
    };
  }, []);
}
