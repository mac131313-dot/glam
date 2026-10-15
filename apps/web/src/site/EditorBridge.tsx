// Most edytora: budzi się tylko w ramce z ?podglad=1&edytor=1. Zwykła odwiedzająca kończy na warunku w StudioSite.
// Podświetlenie to jedna osobna nakładka (position: absolute), a nie obwódka na sekcji – obwódka przesunęłaby układ
// i podgląd przestałby pokazywać prawdę. Kliknięcia są przechwytywane w fazie capture: linki w podglądzie nie nawigują.
import { useEffect, useRef } from 'react';
import type { SiteDoc } from '@glam/core';
import { CHANNEL, isEnvelope, type FromSite, type ToSite } from './protocol.ts';

const SECTION_SELECTOR = 'main > section[id]';

export function EditorBridge({ onDoc, onRefresh }: { onDoc: (doc: SiteDoc) => void; onRefresh: () => void }) {
  const hoverRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLDivElement>(null);
  const selected = useRef<string | null>(null);
  const hovered = useRef<string | null>(null);
  // Najświeższe wywołania zwrotne bez ponownego podpinania nasłuchów.
  const cb = useRef({ onDoc, onRefresh });
  cb.current = { onDoc, onRefresh };

  useEffect(() => {
    const origin = location.origin;
    const send = (m: FromSite) => window.parent.postMessage({ ...m, kanal: CHANNEL }, origin);

    const sectionOf = (el: EventTarget | null): HTMLElement | null => {
      if (!(el instanceof Element)) return null;
      const header = el.closest('[data-edit-target]');
      if (header) return document.getElementById(header.getAttribute('data-edit-target')!);
      return el.closest(SECTION_SELECTOR);
    };
    const byId = (id: string | null) => (id ? (document.querySelector(`main > section[id="${CSS.escape(id)}"]`) as HTMLElement | null) : null);

    const place = (box: HTMLDivElement | null, el: HTMLElement | null) => {
      if (!box) return;
      if (!el) {
        box.hidden = true;
        return;
      }
      const r = el.getBoundingClientRect();
      box.hidden = false;
      box.style.top = `${r.top + window.scrollY}px`;
      box.style.left = `${r.left + window.scrollX}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      const label = box.querySelector('.eb-label');
      if (label) label.textContent = el.dataset.sectionName ?? el.id;
    };
    const redraw = () => {
      place(selectRef.current, byId(selected.current));
      place(hoverRef.current, hovered.current !== selected.current ? byId(hovered.current) : null);
    };

    const sections = () => [...document.querySelectorAll<HTMLElement>(SECTION_SELECTOR)].map((s) => ({ id: s.id, nazwa: s.dataset.sectionName ?? s.id }));

    const onOver = (e: MouseEvent) => {
      if ((e.target as Element).closest?.('.eb-plus')) return;
      const id = sectionOf(e.target)?.id ?? null;
      if (id === hovered.current) return;
      hovered.current = id;
      redraw();
    };
    const onLeave = () => {
      hovered.current = null;
      redraw();
    };
    const onClick = (e: MouseEvent) => {
      const plus = (e.target as Element).closest?.('.eb-plus') as HTMLElement | null;
      if (plus) {
        e.preventDefault();
        e.stopPropagation();
        if (selected.current) send({ rodzaj: 'dodaj', sekcja: selected.current, gdzie: plus.dataset.gdzie as 'przed' | 'po' });
        return;
      }
      const sec = sectionOf(e.target);
      // Przyciski wewnątrz sekcji (dni grafiku, filtr sal, pytania) działają – blokujemy tylko nawigację.
      const interactive = (e.target as Element).closest?.('button, summary');
      if (!interactive) e.preventDefault();
      if ((e.target as Element).closest?.('a')) e.preventDefault();
      if (!sec) return;
      selected.current = sec.id;
      redraw();
      send({ rodzaj: 'wybrano', sekcja: sec.id });
    };
    const onSubmit = (e: Event) => e.preventDefault();
    // Fokus w ramce „połyka” skróty edytora – przekazujemy je do panelu.
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      const akcja = key === 's' ? 'zapisz' : key === 'z' ? (e.shiftKey ? 'ponow' : 'cofnij') : key === 'y' ? 'ponow' : null;
      if (!akcja) return;
      e.preventDefault();
      send({ rodzaj: 'skrot', akcja });
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== window.parent || !isEnvelope(e.data)) return;
      const m = e.data as unknown as ToSite;
      if (m.rodzaj === 'podswietl') {
        hovered.current = m.sekcja;
        redraw();
      } else if (m.rodzaj === 'przewin') {
        selected.current = m.sekcja;
        const el = byId(m.sekcja);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        redraw();
      } else if (m.rodzaj === 'przewinDol') {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      } else if (m.rodzaj === 'dokument') {
        cb.current.onDoc(m.doc);
      } else if (m.rodzaj === 'odswiez') {
        cb.current.onRefresh();
      }
    };

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    window.addEventListener('resize', redraw);
    // Treść zmienia się na żywo (dokument z edytora, leniwe obrazki) – nakładki idą za sekcjami.
    const ro = new ResizeObserver(redraw);
    const main = document.querySelector('main');
    if (main) ro.observe(main);
    const mo = new MutationObserver(() => {
      redraw();
      if (selected.current && !byId(selected.current)) selected.current = null;
    });
    if (main) mo.observe(main, { childList: true, subtree: true, characterData: true });

    send({ rodzaj: 'gotowy', sekcje: sections() });
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('resize', redraw);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <>
      <div ref={hoverRef} className="eb-box eb-hover" hidden aria-hidden="true">
        <span className="eb-label" />
      </div>
      <div ref={selectRef} className="eb-box eb-selected" hidden aria-hidden="true">
        <span className="eb-label" />
        <button type="button" className="eb-plus eb-plus-top" data-gdzie="przed" aria-label="Dodaj sekcję powyżej" tabIndex={-1}>
          +
        </button>
        <button type="button" className="eb-plus eb-plus-bottom" data-gdzie="po" aria-label="Dodaj sekcję poniżej" tabIndex={-1}>
          +
        </button>
      </div>
    </>
  );
}
