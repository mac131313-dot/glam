// Edytor strony internetowej studia – pełny ekran pod /panel/strona (poza menu panelu).
// Cały szkic to jeden obiekt (SiteDoc) z jedną historią: każda zmiana idzie przez change().
// Dokument leci do podglądu na żywo (postMessage), na serwer – autozapisem po chwili bezczynności.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FONTS,
  newSection,
  PALETTES,
  SECTION_SPECS,
  SOFTNESS,
  specOf,
  type FieldSpec,
  type FieldValue,
  type Look,
  type MenuItem,
  type SectionSpec,
  type SiteDoc,
  type SiteSection,
  type Softness,
} from '@glam/core';
import { api, ApiError } from '../../api.ts';
import { Spinner, useToast } from '../../ui.tsx';
import { FOOTER_ID, HERO_ID, type FromSite } from '../../site/protocol.ts';
import { ImageField, ImagesField, MediaKinds, PhotoList } from './images.tsx';
import { MenuField } from './menu.tsx';
import { EditorShell, FieldRow, Glyph, Group, PanelHeader, useAutosave, useHistory, usePreviewBridge } from './shell.tsx';

type CatalogItem = { id: string; name: string; photoUrl: string | null };
type EditorState = {
  doc: SiteDoc;
  slug: string;
  studioName: string;
  studioLook: Look;
  publishedAt: string | null;
  draftUpdatedAt: string | null;
  unpublished: boolean;
  catalog: { classes: CatalogItem[]; trainers: CatalogItem[] };
};

type Selection = { kind: 'hero' } | { kind: 'footer' } | { kind: 'section'; key: string } | { kind: 'settings'; tab: SettingsTab } | null;
type SettingsTab = 'wyglad' | 'menu' | 'seo' | 'publikacja';
const SETTINGS: [SettingsTab, string, string][] = [
  ['wyglad', 'Wygląd', 'Paleta, czcionki i zaokrąglenia strony'],
  ['menu', 'Menu', 'Przycisk i odnośniki u góry strony'],
  ['seo', 'Wyszukiwarki', 'Tytuł i opis w Google'],
  ['publikacja', 'Publikacja', 'Adres strony i wersja publiczna'],
];

export function SiteEditor() {
  const [initial, setInitial] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<EditorState>('/site/editor')
      .then(setInitial)
      .catch((e: ApiError) => setError(e.status === 403 ? 'Edytor strony jest dostępny dla właścicielki studia.' : e.message));
  }, []);
  if (error) return <div className="se-stan">{error}</div>;
  if (!initial) return <Spinner />;
  return <Editor initial={initial} />;
}

function Editor({ initial }: { initial: EditorState }) {
  const toast = useToast();
  const { state: doc, change, undo, redo, reset, canUndo, canRedo } = useHistory<SiteDoc>(initial.doc);
  const [meta, setMeta] = useState(initial);
  const [selection, setSelection] = useState<Selection>(null);
  const [leftTab, setLeftTab] = useState<'sekcje' | 'ustawienia'>('sekcje');
  const [publishing, setPublishing] = useState(false);

  const save = useCallback(async (d: SiteDoc, auto: boolean) => {
    const res = await api<EditorState>('/site/draft', { method: 'PUT', body: { doc: d, auto } });
    setMeta((m) => ({ ...m, unpublished: res.unpublished, draftUpdatedAt: res.draftUpdatedAt }));
    return res.doc;
  }, []);
  const autosave = useAutosave({ doc, initial: initial.doc, save });
  const autosaveRef = useRef(autosave.saveNow);
  autosaveRef.current = autosave.saveNow;

  const src = `/s/${encodeURIComponent(meta.slug)}?podglad=1&edytor=1`;
  const docRef = useRef(doc);
  docRef.current = doc;

  const insertArticle = useCallback(
    (at: number, type: 'article' | 'gallery' = 'article') => {
      const s = newSection(type);
      change((d) => ({ ...d, sections: [...d.sections.slice(0, at), s, ...d.sections.slice(at)] }));
      setSelection({ kind: 'section', key: s.key });
      setLeftTab('sekcje');
      return s.key;
    },
    [change],
  );

  const onMessage = useCallback(
    (m: FromSite) => {
      if (m.rodzaj === 'gotowy') return;
      if (m.rodzaj === 'skrot') {
        if (m.akcja === 'cofnij') undo();
        else if (m.akcja === 'ponow') redo();
        else void autosaveRef.current();
        return;
      }
      if (m.rodzaj === 'wybrano') {
        setLeftTab('sekcje');
        if (m.sekcja === HERO_ID) setSelection({ kind: 'hero' });
        else if (m.sekcja === FOOTER_ID) setSelection({ kind: 'footer' });
        else setSelection({ kind: 'section', key: m.sekcja });
      }
      if (m.rodzaj === 'dodaj') {
        const sections = docRef.current.sections;
        const at = m.sekcja === HERO_ID ? 0 : m.sekcja === FOOTER_ID ? sections.length : sections.findIndex((s) => s.key === m.sekcja) + (m.gdzie === 'po' ? 1 : 0);
        const key = insertArticle(Math.max(0, at));
        // Nowa sekcja pojawi się w podglądzie po wyrenderowaniu dokumentu – wtedy ją zaznaczamy.
        setTimeout(() => bridge.send({ rodzaj: 'przewin', sekcja: key }), 120);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [insertArticle, undo, redo],
  );
  const bridge = usePreviewBridge({ src, onMessage });

  // Podgląd na żywo: każda zmiana dokumentu od razu w ramce (bez czekania na zapis i bez przeładowania).
  useEffect(() => {
    if (bridge.ready) bridge.send({ rodzaj: 'dokument', doc });
  }, [doc, bridge.ready, bridge]);

  const select = (s: Selection, id: string | null) => {
    setSelection(s);
    bridge.send({ rodzaj: 'przewin', sekcja: id });
  };

  // ——— operacje na dokumencie ———
  const setSection = (key: string, fn: (s: SiteSection) => SiteSection, group?: string) => change((d) => ({ ...d, sections: d.sections.map((s) => (s.key === key ? fn(s) : s)) }), group);
  const removeSection = (key: string) => {
    change((d) => ({ ...d, sections: d.sections.filter((s) => s.key !== key) }));
    setSelection(null);
  };
  const duplicateSection = (key: string) => {
    const i = doc.sections.findIndex((s) => s.key === key);
    const src = doc.sections[i];
    if (src.type !== 'article' && src.type !== 'gallery') return;
    const copy = { ...newSection(src.type), values: structuredClone(src.values), nav: '' };
    change((d) => ({ ...d, sections: [...d.sections.slice(0, i + 1), copy, ...d.sections.slice(i + 1)] }));
    setSelection({ kind: 'section', key: copy.key });
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    change((d) => {
      const list = [...d.sections];
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      return { ...d, sections: list };
    });
  };

  const publish = async () => {
    setPublishing(true);
    try {
      // Najpierw zapis bieżącego szkicu, potem publikacja tego, co jest w bazie.
      if (autosave.dirty && !(await autosave.saveNow())) throw new Error('Nie udało się zapisać szkicu.');
      const res = await api<EditorState>('/site/publish', { method: 'POST' });
      setMeta(res);
      toast('Strona opublikowana');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPublishing(false);
    }
  };
  const discard = async () => {
    if (!confirm('Odrzucić zmiany i wrócić do opublikowanej wersji strony?')) return;
    const res = await api<EditorState>('/site/discard', { method: 'POST' });
    setMeta(res);
    reset(res.doc);
    autosave.markSaved(res.doc);
    toast('Przywrócono opublikowaną wersję');
  };

  // ——— drzewko ———
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const row = (opts: { id: string; label: string; icon: Parameters<typeof Glyph>[0]['name']; active: boolean; visible?: boolean; onClick: () => void; onToggle?: () => void; onDelete?: () => void; index?: number; muted?: string }) => (
    <li
      key={opts.id}
      className="se-wiersz"
      aria-current={opts.active ? 'true' : undefined}
      data-ukryty={opts.visible === false ? '' : undefined}
      data-cel={opts.index !== undefined && dragOver === opts.index ? '' : undefined}
      draggable={opts.index !== undefined}
      onDragStart={opts.index !== undefined ? () => (dragFrom.current = opts.index!) : undefined}
      onDragOver={
        opts.index !== undefined
          ? (e) => {
              e.preventDefault();
              setDragOver(opts.index!);
            }
          : undefined
      }
      onDragLeave={() => setDragOver(null)}
      onDrop={
        opts.index !== undefined
          ? (e) => {
              e.preventDefault();
              if (dragFrom.current !== null) move(dragFrom.current, opts.index!);
              dragFrom.current = null;
              setDragOver(null);
            }
          : undefined
      }
      onDragEnd={() => {
        dragFrom.current = null;
        setDragOver(null);
      }}
      onMouseEnter={() => bridge.send({ rodzaj: 'podswietl', sekcja: opts.visible === false ? null : opts.id })}
      onMouseLeave={() => bridge.send({ rodzaj: 'podswietl', sekcja: null })}
    >
      {opts.index !== undefined && (
        <span className="se-uchwyt" aria-hidden="true">
          <Glyph name="drag" />
        </span>
      )}
      <button className="se-wiersz-glowny" onClick={opts.onClick}>
        <Glyph name={opts.icon} />
        <span className="grow">{opts.label}</span>
        {opts.muted && <span className="se-wiersz-dopisek">{opts.muted}</span>}
      </button>
      <span className="se-wiersz-akcje">
        {opts.onDelete && (
          <button className="se-ikona" onClick={opts.onDelete} aria-label={`Usuń: ${opts.label}`} title="Usuń sekcję">
            <Glyph name="trash" />
          </button>
        )}
        {opts.onToggle && (
          <button className="se-ikona" onClick={opts.onToggle} aria-label={opts.visible ? `Ukryj: ${opts.label}` : `Pokaż: ${opts.label}`} title={opts.visible ? 'Ukryj na stronie' : 'Pokaż na stronie'}>
            <Glyph name={opts.visible ? 'eye' : 'eyeOff'} />
          </button>
        )}
      </span>
    </li>
  );

  const sectionLabel = (s: SiteSection) =>
    s.type === 'article' ? String(s.values.title || 'Sekcja z tekstem') : s.type === 'gallery' ? (s.values.title ? `Galeria: ${s.values.title}` : 'Galeria') : specOf(s.type).label;
  const isCustom = (s: SiteSection) => s.type === 'article' || s.type === 'gallery';

  const tree =
    leftTab === 'sekcje' ? (
      <div className="se-drzewo-tresc">
        <div className="se-drzewo-grupa">Nagłówek</div>
        <ul>
          {row({
            id: HERO_ID,
            label: 'Nagłówek strony',
            icon: 'top',
            active: selection?.kind === 'hero',
            visible: doc.hero.visible,
            onClick: () => select({ kind: 'hero' }, HERO_ID),
            onToggle: () => change((d) => ({ ...d, hero: { ...d.hero, visible: !d.hero.visible } })),
          })}
        </ul>
        <div className="se-drzewo-grupa">Sekcje</div>
        <ul>
          {doc.sections.map((s, i) =>
            row({
              id: s.key,
              label: sectionLabel(s),
              icon: s.type === 'article' ? 'text' : s.type === 'gallery' ? 'image' : 'section',
              active: selection?.kind === 'section' && selection.key === s.key,
              visible: s.visible,
              index: i,
              onClick: () => select({ kind: 'section', key: s.key }, s.key),
              onToggle: () => setSection(s.key, (x) => ({ ...x, visible: !x.visible })),
              muted: s.type === 'gallery' ? `${(s.values.images as string[]).length} zdj.` : s.type === 'classes' && s.values.newsEnabled ? 'nowości' : undefined,
              onDelete: isCustom(s) ? () => removeSection(s.key) : undefined,
            }),
          )}
        </ul>
        <button
          className="se-dodaj"
          onClick={() => {
            insertArticle(doc.sections.length);
            setTimeout(() => bridge.send({ rodzaj: 'przewinDol' }), 120);
          }}
        >
          <Glyph name="plus" /> Dodaj sekcję z tekstem
        </button>
        <button
          className="se-dodaj"
          onClick={() => {
            insertArticle(doc.sections.length, 'gallery');
            setTimeout(() => bridge.send({ rodzaj: 'przewinDol' }), 120);
          }}
        >
          <Glyph name="image" /> Dodaj galerię zdjęć
        </button>
        <div className="se-drzewo-grupa">Stopka</div>
        <ul>
          {row({
            id: FOOTER_ID,
            label: 'Stopka',
            icon: 'bottom',
            active: selection?.kind === 'footer',
            visible: doc.footer.visible,
            onClick: () => select({ kind: 'footer' }, FOOTER_ID),
            onToggle: () => change((d) => ({ ...d, footer: { ...d.footer, visible: !d.footer.visible } })),
          })}
        </ul>
        <p className="se-wskazowka">Kliknij sekcję w podglądzie, żeby ją edytować. Przeciągnij wiersz, żeby zmienić kolejność.</p>
      </div>
    ) : (
      <div className="se-drzewo-tresc">
        <div className="se-drzewo-grupa">Ustawienia strony</div>
        <ul>
          {SETTINGS.map(([tab, label, hint]) => (
            <li key={tab} className="se-wiersz" aria-current={selection?.kind === 'settings' && selection.tab === tab ? 'true' : undefined}>
              <button className="se-wiersz-glowny dwulinijkowy" onClick={() => setSelection({ kind: 'settings', tab })}>
                <span className="grow">
                  {label}
                  <span className="se-wiersz-dopisek">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  // ——— panel po prawej ———
  const close = () => setSelection(null);
  let panel: React.ReactNode = null;
  if (selection?.kind === 'hero') {
    panel = (
      <>
        <PanelHeader title="Nagłówek strony" onClose={close} />
        <VisibleRow visible={doc.hero.visible} onChange={(v) => change((d) => ({ ...d, hero: { ...d.hero, visible: v } }))} />
        <SpecFields spec={SECTION_SPECS.hero} values={doc.hero.values} onChange={(k, v, g) => change((d) => ({ ...d, hero: { ...d.hero, values: { ...d.hero.values, [k]: v } } }), g)} />
      </>
    );
  } else if (selection?.kind === 'footer') {
    panel = (
      <>
        <PanelHeader title="Stopka" onClose={close} />
        <VisibleRow visible={doc.footer.visible} onChange={(v) => change((d) => ({ ...d, footer: { ...d.footer, visible: v } }))} />
        <SpecFields spec={SECTION_SPECS.footer} values={doc.footer.values} onChange={(k, v, g) => change((d) => ({ ...d, footer: { ...d.footer, values: { ...d.footer.values, [k]: v } } }), g)} />
      </>
    );
  } else if (selection?.kind === 'section') {
    const s = doc.sections.find((x) => x.key === selection.key);
    if (s) {
      panel = (
        <>
          <PanelHeader
            title={sectionLabel(s)}
            onClose={close}
            actions={
              isCustom(s) && (
                <>
                  <button className="se-ikona" onClick={() => duplicateSection(s.key)} aria-label="Powiel sekcję" title="Powiel">
                    <Glyph name="copy" />
                  </button>
                  <button className="se-ikona" onClick={() => removeSection(s.key)} aria-label="Usuń sekcję" title="Usuń">
                    <Glyph name="trash" />
                  </button>
                </>
              )
            }
          />
          <VisibleRow visible={s.visible} onChange={(v) => setSection(s.key, (x) => ({ ...x, visible: v }))} />
          <Group label="Menu strony">
            <FieldRow label="Etykieta w menu" hint="Puste = sekcji nie ma w menu.">
              <input className="se-input" value={s.nav} maxLength={30} onChange={(e) => setSection(s.key, (x) => ({ ...x, nav: e.target.value }), `${s.key}.nav`)} />
            </FieldRow>
          </Group>
          {!isCustom(s) && <SystemNote type={s.type} />}
          <SpecFields spec={specOf(s.type)} values={s.values} onChange={(k, v, g) => setSection(s.key, (x) => ({ ...x, values: { ...x.values, [k]: v } }), g)} />
          {(s.type === 'classes' || s.type === 'trainers') && (
            <Group label={s.type === 'classes' ? 'Zdjęcia zajęć' : 'Zdjęcia trenerek'}>
              <PhotoList
                items={s.type === 'classes' ? meta.catalog.classes : meta.catalog.trainers}
                photos={doc.photos[s.type]}
                onChange={(id, mediaId) =>
                  change((d) => {
                    const map = { ...d.photos[s.type as 'classes' | 'trainers'] };
                    if (mediaId) map[id] = mediaId;
                    else delete map[id];
                    return { ...d, photos: { ...d.photos, [s.type]: map } };
                  })
                }
              />
            </Group>
          )}
        </>
      );
    }
  } else if (selection?.kind === 'settings') {
    const title = SETTINGS.find(([t]) => t === selection.tab)![1];
    panel = (
      <>
        <PanelHeader title={title} onClose={close} />
        {selection.tab === 'wyglad' && <ThemePanel doc={doc} studioLook={meta.studioLook} change={change} />}
        {selection.tab === 'menu' && (
          <Group label="Pasek u góry">
            <FieldRow label="Przycisk">
              <input className="se-input" value={doc.nav.button} maxLength={24} onChange={(e) => change((d) => ({ ...d, nav: { ...d.nav, button: e.target.value } }), 'nav.button')} />
            </FieldRow>
            <Switch label="Odnośniki do sekcji" checked={doc.nav.showLinks} onChange={(v) => change((d) => ({ ...d, nav: { ...d.nav, showLinks: v } }))} hint="Etykiety ustawisz w każdej sekcji." />
          </Group>
        )}
        {selection.tab === 'seo' && <SeoPanel doc={doc} change={change} studioName={meta.studioName} slug={meta.slug} />}
        {selection.tab === 'publikacja' && <PublishPanel meta={meta} onPublish={publish} onDiscard={discard} publishing={publishing} />}
      </>
    );
  }

  const tabs = (
    <div className="se-segment" role="tablist">
      {(
        [
          ['sekcje', 'Sekcje'],
          ['ustawienia', 'Ustawienia'],
        ] as const
      ).map(([t, label]) => (
        <button key={t} role="tab" aria-selected={leftTab === t} onClick={() => setLeftTab(t)}>
          {label}
        </button>
      ))}
    </div>
  );

  const pill = !meta.publishedAt ? { label: 'Nieopublikowana', on: false } : meta.unpublished || autosave.dirty ? { label: 'Zmiany czekają', on: false } : { label: 'Opublikowana', on: true };

  // Rodzaj pliku (film / zdjęcie) dla miniatur i podglądu na żywo; przy zapisie serwer i tak ustala go z biblioteki.
  const mediaKinds = {
    isVideo: (id: string) => doc.media[id] === 'video',
    markVideo: (id: string) => change((d) => ({ ...d, media: { ...d.media, [id]: 'video' } })),
  };

  return (
    <MediaKinds.Provider value={mediaKinds}>
    <EditorShell
      title={meta.studioName}
      pill={pill}
      tabs={tabs}
      tree={tree}
      panel={panel}
      preview={{ src, frame: bridge.frame, version: bridge.version }}
      history={{ undo, redo, canUndo, canRedo }}
      save={{ status: autosave.status, savedAt: autosave.savedAt, dirty: autosave.dirty, onSave: () => void autosave.saveNow() }}
      onPublish={publish}
      publishLabel={publishing ? 'Publikuję…' : 'Publikuj'}
      publishDisabled={publishing || (!meta.unpublished && !autosave.dirty && !!meta.publishedAt)}
      backHref="/panel#site"
      extra={
        <a className="se-ikona" href={`/s/${meta.slug}`} target="_blank" rel="noopener" aria-label="Otwórz opublikowaną stronę" title="Otwórz opublikowaną stronę">
          <Glyph name="external" />
        </a>
      }
    />
    </MediaKinds.Provider>
  );
}

// ——— pola z specyfikacji ———

function SpecFields({ spec, values, onChange }: { spec: SectionSpec; values: Record<string, FieldValue>; onChange: (key: string, value: FieldValue, group?: string) => void }) {
  return (
    <>
      {spec.groups.map((g) => (
        <Group key={g.label} label={g.label}>
          {g.fields.map((f) => (
            <SpecField key={f.key} field={f} value={values[f.key]} onChange={(v, grp) => onChange(f.key, v, grp)} />
          ))}
        </Group>
      ))}
    </>
  );
}

function SpecField({ field: f, value, onChange }: { field: FieldSpec; value: FieldValue | undefined; onChange: (v: FieldValue, group?: string) => void }) {
  const group = `field.${f.key}`;
  if (f.kind === 'toggle') return <Switch label={f.label} hint={f.hint} checked={value === true} onChange={(v) => onChange(v)} />;
  if (f.kind === 'number')
    return (
      <FieldRow label={f.label} hint={f.hint}>
        <span className="se-liczba">
          <input className="se-input" type="number" min={f.min} max={f.max} value={Number(value ?? f.default)} onChange={(e) => onChange(Math.min(f.max, Math.max(f.min, Number(e.target.value) || f.min)), group)} />
          {f.suffix && <span>{f.suffix}</span>}
        </span>
      </FieldRow>
    );
  if (f.kind === 'choice')
    return (
      <FieldRow label={f.label} hint={f.hint}>
        <select className="se-input" value={String(value ?? f.default)} onChange={(e) => onChange(e.target.value)}>
          {f.options.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </FieldRow>
    );
  if (f.kind === 'image')
    return (
      <FieldRow label={f.label} hint={f.hint}>
        <ImageField value={String(value ?? '')} onChange={(id) => onChange(id)} />
      </FieldRow>
    );
  if (f.kind === 'images')
    return (
      <div className="se-pole">
        <span className="se-pole-etykieta">{f.label}</span>
        <ImagesField value={Array.isArray(value) ? (value as string[]) : []} max={f.max} onChange={(ids) => onChange(ids)} />
        {f.hint && <span className="se-pole-podpowiedz">{f.hint}</span>}
      </div>
    );
  if (f.kind === 'menu') return <MenuField value={Array.isArray(value) ? (value as MenuItem[]) : []} max={f.max} onChange={(items, grp) => onChange(items, grp)} />;
  if (f.kind === 'textarea')
    return (
      <FieldRow label={f.label} hint={f.hint}>
        <textarea className="se-input" rows={Math.min(10, Math.max(3, Math.ceil(String(value ?? '').length / 38)))} maxLength={f.max} value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value, group)} />
      </FieldRow>
    );
  return (
    <FieldRow label={f.label} hint={f.hint}>
      <input className="se-input" maxLength={f.max} value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value, group)} />
    </FieldRow>
  );
}

function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="se-przelacznik">
      <span className="grow">
        {label}
        {hint && <span className="se-pole-podpowiedz">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function VisibleRow({ visible, onChange }: { visible: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="se-grupa">
      <Switch label="Widoczna na stronie" checked={visible} onChange={onChange} />
    </div>
  );
}

const SYSTEM_NOTES: Partial<Record<SiteSection['type'], string>> = {
  schedule: 'Zajęcia biorą się z grafiku studia (Grafik i sale).',
  classes: 'Lista zajęć to oferta studia (Grafik i sale → typy zajęć). Nowe zajęcia same pojawiają się na stronie.',
  trainers: 'Trenerki, ich opisy i zdjęcia – z kont zespołu.',
  about: 'Godziny recepcji, kontakt i pytania – z Ustawień studia.',
  shop: 'Produkty, ceny i zdjęcia – z panelu: Sklep → Produkty i stany. Sekcja pokazuje się, gdy sklep jest włączony.',
  more: 'Kafelki pokazują się tylko dla modułów włączonych w studiu.',
  menu: 'Menu baru wpisujesz tutaj. Zakładka „Menu” pojawia się na stronie, gdy dodasz pierwszą pozycję.',
};

function SystemNote({ type }: { type: SiteSection['type'] }) {
  const note = SYSTEM_NOTES[type];
  return note ? <p className="se-notka">{note}</p> : null;
}

// ——— ustawienia strony ———

type Change = (fn: (d: SiteDoc) => SiteDoc, group?: string) => void;

function ThemePanel({ doc, studioLook, change }: { doc: SiteDoc; studioLook: Look; change: Change }) {
  const t = doc.theme;
  const setTheme = (patch: Partial<SiteDoc['theme']>) => change((d) => ({ ...d, theme: { ...d.theme, ...patch } }));
  const fontRole = (role: 'display' | 'head' | 'body', label: string) => (
    <FieldRow label={label}>
      <select
        className="se-input"
        value={t.fonts[role] ?? ''}
        onChange={(e) => {
          const fonts = { ...t.fonts };
          if (e.target.value) fonts[role] = e.target.value;
          else delete fonts[role];
          setTheme({ fonts });
        }}
      >
        <option value="">Jak w aplikacji ({FONTS.find((f) => f.id === studioLook.fonts[role])?.label})</option>
        {FONTS.filter((f) => f.roles.includes(role) && !f.pending).map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </FieldRow>
  );
  return (
    <>
      <p className="se-notka">Domyślnie strona wygląda jak aplikacja studia (Ustawienia → Wygląd). Tu możesz zmienić wygląd tylko na stronie.</p>
      <Group label="Paleta">
        <div className="se-palety">
          <button className="se-paleta" aria-pressed={!t.palette} onClick={() => setTheme({ palette: null })}>
            <span className="se-paleta-kolory">
              {swatches(studioLook.palette).map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            Jak w aplikacji
          </button>
          {PALETTES.map((p) => (
            <button key={p.id} className="se-paleta" aria-pressed={t.palette === p.id} onClick={() => setTheme({ palette: p.id })}>
              <span className="se-paleta-kolory">
                {swatches(p.id).map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              {p.label}
            </button>
          ))}
        </div>
      </Group>
      <Group label="Czcionki">
        {fontRole('display', 'Ozdobna (kursywa)')}
        {fontRole('head', 'Nagłówki')}
        {fontRole('body', 'Tekst')}
      </Group>
      <Group label="Zaokrąglenia">
        <select className="se-input" value={t.softness ?? ''} onChange={(e) => setTheme({ softness: (e.target.value || null) as Softness | null })}>
          <option value="">Jak w aplikacji ({SOFTNESS[studioLook.softness].label})</option>
          {(Object.keys(SOFTNESS) as Softness[]).map((k) => (
            <option key={k} value={k}>
              {SOFTNESS[k].label}
            </option>
          ))}
        </select>
      </Group>
    </>
  );
}

function swatches(paletteId: string) {
  const p = PALETTES.find((x) => x.id === paletteId)?.palette ?? PALETTES[0].palette;
  return [p.bg, p.soft, p.brand, p.ink];
}

function SeoPanel({ doc, change, studioName, slug }: { doc: SiteDoc; change: Change; studioName: string; slug: string }) {
  const title = doc.seo.title || studioName;
  const desc = doc.seo.description || 'Opis z hasła studia.';
  return (
    <>
      <Group label="Wynik w Google">
        <div className="se-google">
          <span className="se-google-adres">
            {location.host}/s/{slug}
          </span>
          <span className="se-google-tytul">{title}</span>
          <span className="se-google-opis">{desc}</span>
        </div>
      </Group>
      <Group label="Treść">
        <FieldRow label="Tytuł strony" hint={`${doc.seo.title.length}/70 · puste = nazwa i hasło studia`}>
          <input className="se-input" maxLength={70} value={doc.seo.title} onChange={(e) => change((d) => ({ ...d, seo: { ...d.seo, title: e.target.value } }), 'seo.title')} />
        </FieldRow>
        <FieldRow label="Opis" hint={`${doc.seo.description.length}/170`}>
          <textarea className="se-input" rows={4} maxLength={170} value={doc.seo.description} onChange={(e) => change((d) => ({ ...d, seo: { ...d.seo, description: e.target.value } }), 'seo.description')} />
        </FieldRow>
      </Group>
    </>
  );
}

function PublishPanel({ meta, onPublish, onDiscard, publishing }: { meta: EditorState; onPublish: () => void; onDiscard: () => void; publishing: boolean }) {
  const url = `${location.origin}/s/${meta.slug}`;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null);
  return (
    <>
      <Group label="Adres strony">
        <a className="se-link" href={url} target="_blank" rel="noopener">
          {url} <Glyph name="external" />
        </a>
      </Group>
      <Group label="Stan">
        <p className="se-tekst">
          {meta.publishedAt ? `Opublikowano ${when(meta.publishedAt)}.` : 'Strona pokazuje układ domyślny – Twoje zmiany zobaczą wszyscy po pierwszej publikacji.'}
          {meta.unpublished && meta.publishedAt ? ' Szkic ma zmiany, których jeszcze nie widać na stronie.' : ''}
        </p>
        <button className="se-przycisk se-publikuj" onClick={onPublish} disabled={publishing}>
          {publishing ? 'Publikuję…' : 'Publikuj zmiany'}
        </button>
        {meta.publishedAt && meta.unpublished && (
          <button className="se-przycisk" onClick={onDiscard}>
            Odrzuć szkic
          </button>
        )}
      </Group>
    </>
  );
}
