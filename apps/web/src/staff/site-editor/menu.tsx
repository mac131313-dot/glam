// Pole „Pozycje menu” w edytorze strony (sekcja Menu baru): lista pozycji z nazwą, ceną, kategorią, opisem i zdjęciem.
// Formularz sam porządkuje wartości: nowa pozycja dziedziczy kategorię poprzedniej, sama liczba w cenie dostaje „zł”.
import { useState } from 'react';
import type { MenuItem } from '@glam/core';
import { ImageField } from './images.tsx';
import { FieldRow, Glyph } from './shell.tsx';

const newId = () => Math.random().toString(36).slice(2, 10);

/** „14” → „14 zł”, „14,5” → „14,50 zł”, „12/16” → „12 / 16 zł”. Tekst z czymkolwiek innym zostaje, jak go wpisano. */
export function tidyPrice(raw: string): string {
  const t = raw.trim().replace(/\s*zł$/i, '');
  if (!/^\d+([.,]\d{1,2})?(\s*\/\s*\d+([.,]\d{1,2})?)*$/.test(t)) return raw.trim();
  const fmt = (n: string) => (/[.,]/.test(n) ? n.replace('.', ',').replace(/,(\d)$/, ',$10') : n);
  return `${t.split('/').map((p) => fmt(p.trim())).join(' / ')} zł`;
}

export function MenuField({ value, max, onChange }: { value: MenuItem[]; max: number; onChange: (items: MenuItem[], group?: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const categories = [...new Set(value.map((x) => x.category.trim()).filter(Boolean))];
  const set = (id: string, patch: Partial<MenuItem>, group?: string) => onChange(value.map((x) => (x.id === id ? { ...x, ...patch } : x)), group);
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const add = () => {
    const item: MenuItem = { id: newId(), category: value.at(-1)?.category ?? '', name: '', price: '', text: '', tag: '', image: '' };
    onChange([...value, item]);
    setOpen(item.id);
  };
  const listId = 'se-menu-kategorie';

  return (
    <div className="se-menu">
      <datalist id={listId}>
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {value.length === 0 && <p className="se-pole-podpowiedz">Dodaj pierwszą pozycję – np. smoothie, matcha albo owsiankę.</p>}
      {value.map((x, i) => {
        const isOpen = open === x.id;
        return (
          <div key={x.id} className={`se-menu-pozycja${isOpen ? ' otwarta' : ''}`}>
            <button type="button" className="se-menu-naglowek" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : x.id)}>
              <span className="grow">
                {x.name || <em>Bez nazwy</em>}
                {x.category && <span className="se-pole-podpowiedz">{x.category}</span>}
              </span>
              <span className="se-menu-cena">{x.price}</span>
            </button>
            {isOpen && (
              <div className="se-menu-pola">
                <FieldRow label="Nazwa">
                  <input className="se-input" autoFocus={!x.name} maxLength={60} value={x.name} placeholder="np. Matcha latte" onChange={(e) => set(x.id, { name: e.target.value }, `menu.${x.id}.name`)} />
                </FieldRow>
                <div className="se-menu-dwa">
                  <FieldRow label="Cena">
                    <input className="se-input" maxLength={20} value={x.price} placeholder="18 zł" inputMode="decimal" onChange={(e) => set(x.id, { price: e.target.value }, `menu.${x.id}.price`)} onBlur={() => x.price && tidyPrice(x.price) !== x.price && set(x.id, { price: tidyPrice(x.price) })} />
                  </FieldRow>
                  <FieldRow label="Kategoria">
                    <input className="se-input" list={listId} maxLength={40} value={x.category} placeholder="np. Kawa i matcha" onChange={(e) => set(x.id, { category: e.target.value }, `menu.${x.id}.category`)} />
                  </FieldRow>
                </div>
                <FieldRow label="Opis" hint="Skład albo jedno zdanie – opcjonalnie.">
                  <textarea className="se-input" rows={2} maxLength={200} value={x.text} onChange={(e) => set(x.id, { text: e.target.value }, `menu.${x.id}.text`)} />
                </FieldRow>
                <FieldRow label="Znaczek" hint="Np. wegańskie, bez glutenu, nowość.">
                  <input className="se-input" maxLength={24} value={x.tag} onChange={(e) => set(x.id, { tag: e.target.value }, `menu.${x.id}.tag`)} />
                </FieldRow>
                <div className="se-pole">
                  <span className="se-pole-etykieta">Zdjęcie</span>
                  <ImageField compact allowVideo={false} label={x.name} value={x.image} onChange={(id) => set(x.id, { image: id })} />
                </div>
                <div className="se-menu-akcje">
                  <button type="button" className="se-ikona" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Wyżej" title="Wyżej">
                    <Glyph name="top" />
                  </button>
                  <button type="button" className="se-ikona" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Niżej" title="Niżej">
                    <Glyph name="bottom" />
                  </button>
                  <span className="grow" />
                  <button type="button" className="se-ikona" onClick={() => onChange(value.filter((y) => y.id !== x.id))} aria-label="Usuń pozycję" title="Usuń">
                    <Glyph name="trash" />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {value.length < max && (
        <button type="button" className="se-dodaj" onClick={add}>
          <Glyph name="plus" /> Dodaj pozycję
        </button>
      )}
    </div>
  );
}
