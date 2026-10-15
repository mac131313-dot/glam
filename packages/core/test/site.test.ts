import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOOK, defaultSiteDoc, GALLERY_MAX, isNewClass, parseSiteDoc, siteLook, siteMediaIds, SYSTEM_SECTIONS } from '../src/index.ts';

test('dokument strony: śmieci i stare JSON-y dostają wartości domyślne', () => {
  assert.deepEqual(parseSiteDoc(null), defaultSiteDoc());
  assert.deepEqual(parseSiteDoc('zepsute'), defaultSiteDoc());
  const d = parseSiteDoc({ hero: { values: { title: 42, button: 'Zapraszam' } } });
  assert.equal(d.hero.values.title, '');
  assert.equal(d.hero.values.button, 'Zapraszam');
  assert.equal(d.hero.values.showNext, false, 'minimalizm: bez dodatków domyślnie');
});

test('dokument strony: każda sekcja systemowa dokładnie raz, kolejność z dokumentu, brakujące po swojej poprzedniczce', () => {
  const d = parseSiteDoc({
    sections: [
      { type: 'classes', visible: false },
      { type: 'classes' },
      { type: 'nieznana' },
      { type: 'article', key: 'a-cennik', values: { title: 'Cennik', layout: 'zly' } },
      { type: 'about' },
    ],
  });
  const keys = d.sections.map((s) => s.key);
  assert.deepEqual(keys, ['classes', 'trainers', 'more', 'a-cennik', 'about', 'schedule']);
  for (const t of SYSTEM_SECTIONS) assert.equal(keys.filter((k) => k === t).length, 1, t);
  assert.equal(d.sections[0].visible, false);
  assert.equal(d.sections[3].values.layout, 'plain');
});

test('dokument strony: liczby w granicach, motyw tylko z białej listy', () => {
  const d = parseSiteDoc({
    sections: [{ type: 'classes', values: { newsDays: 999 } }],
    theme: { palette: 'isola', softness: 'twardo', fonts: { display: 'playfair', head: 'cormorant', body: 'comic-sans' } },
  });
  assert.equal(d.sections.find((s) => s.type === 'classes')!.values.newsDays, 120);
  assert.deepEqual(d.theme, { palette: 'isola', softness: null, fonts: { display: 'playfair' } });
  const look = siteLook(DEFAULT_LOOK, d.theme);
  assert.equal(look.palette, 'isola');
  assert.equal(look.fonts.display, 'playfair');
  assert.equal(look.fonts.head, DEFAULT_LOOK.fonts.head);
});

test('nowe zajęcia: nie z konfiguracji startowej, przez N dni od dodania', () => {
  const studio = '2026-01-01T10:00:00Z';
  const now = new Date('2026-10-15T12:00:00Z');
  assert.equal(isNewClass('2026-01-01T10:05:00Z', studio, 30, now), false, 'oferta startowa');
  assert.equal(isNewClass('2026-10-10T12:00:00Z', studio, 30, now), true);
  assert.equal(isNewClass('2026-09-01T12:00:00Z', studio, 30, now), false, 'starsze niż 30 dni');
  assert.equal(isNewClass(null, studio, 30, now), false, 'brak daty = sprzed wprowadzenia nowości');
});

test('zdjęcia strony: tylko id z biblioteki studia, galeria z limitem, zdjęcia zajęć i trenerek', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const d = parseSiteDoc({
    hero: { values: { image: 'https://obcy.pl/x.jpg' } },
    sections: [
      { type: 'about', values: { image: id(1) } },
      { type: 'gallery', key: 'g-sala', values: { images: [id(2), id(2), 'zle', ...Array.from({ length: 20 }, (_, i) => id(10 + i))] } },
    ],
    photos: { classes: { ss_flow: id(3), 'zly klucz': id(4) }, trainers: { t1: 'nie-id' } },
  });
  assert.equal(d.hero.values.image, '', 'adres z zewnątrz odpada');
  assert.equal(d.sections[0].values.image, id(1));
  const gallery = d.sections.find((s) => s.key === 'g-sala')!.values.images as string[];
  assert.equal(gallery.length, GALLERY_MAX);
  assert.equal(gallery[0], id(2), 'bez duplikatów');
  assert.deepEqual(d.photos, { classes: { ss_flow: id(3) }, trainers: {} });
  assert.ok(siteMediaIds(d).includes(id(3)) && siteMediaIds(d).includes(id(1)));
  assert.ok(defaultSiteDoc().sections.some((s) => s.type === 'gallery'), 'domyślnie jest miejsce na galerię');
});

test('filmy na stronie: mapa „który plik to film” tylko z poprawnymi id', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const d = parseSiteDoc({ hero: { values: { image: id(5) } }, media: { [id(5)]: 'video', [id(6)]: 'audio', 'nie-id': 'video' } });
  assert.deepEqual(d.media, { [id(5)]: 'video' });
  assert.equal(d.hero.values.image, id(5), 'film siedzi w tym samym polu co zdjęcie');
  assert.deepEqual(defaultSiteDoc().media, {});
});
