// Menu strony studia – wspólne dla strony głównej, podstron i sklepu. Każda zakładka to podstrona /s/:slug/:path
// (lista z core/site.ts: sitePages). Na komputerze linki w pasku, na telefonie przycisk „Menu” z oknem na cały ekran.
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import type { SitePage } from '@glam/core';
import { Icon } from '../icons.tsx';

type Props = {
  slug: string;
  /** logo albo nazwa studia */
  brand: ReactNode;
  brandLabel: string;
  pages: SitePage[];
  /** adres bieżącej podstrony (null = strona główna) – zakładka dostaje aria-current */
  current: string | null;
  button: { label: string; href: string };
  /** przejście bez przeładowania (strona studia); bez niego linki są zwykłymi odnośnikami (sklep) */
  onNavigate?: (path: string | null) => void;
  /** href zakładki, gdy trzeba inaczej niż /s/:slug/:path (np. kotwice w edytorze) */
  hrefOf?: (page: SitePage) => string;
  /** atrybuty dla edytora strony */
  editTarget?: string;
  /** menu na zdjęciu nagłówka (na cały ekran): przezroczyste i jasne, dopóki zdjęcie jest pod nim */
  overlay?: boolean;
};

export const pageHref = (slug: string, path: string | null) => `/s/${encodeURIComponent(slug)}${path ? `/${path}` : ''}`;

export function SiteNav({ slug, brand, brandLabel, pages, current, button, onNavigate, hrefOf, editTarget, overlay = false }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [overPhoto, setOverPhoto] = useState(overlay);
  useEffect(() => {
    if (!overlay) {
      setOverPhoto(false);
      return;
    }
    // Zdjęcie ma wysokość ekranu – menu jest „na zdjęciu”, póki nie przewiniemy prawie do jego końca.
    const check = () => setOverPhoto(window.scrollY < window.innerHeight - 96);
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [overlay]);
  const href = (p: SitePage) => hrefOf?.(p) ?? pageHref(slug, p.path);

  /** Zwykłe kliknięcie zostaje w aplikacji strony; Ctrl/Cmd/środkowy przycisk otwiera nową kartę jak zawsze. */
  const follow = (path: string | null, type?: SitePage['type']) => (e: MouseEvent<HTMLAnchorElement>) => {
    setMenuOpen(false);
    // Sklep to osobna strona (ShopSite) – tam zawsze pełne przejście.
    if (!onNavigate || type === 'shop' || hrefOf || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(path);
  };

  return (
    <header className={`site-nav${overlay ? ' overlay' : ''}${overPhoto ? ' over-photo' : ''}`} data-edit-target={editTarget}>
      <a className="site-brand" href={pageHref(slug, null)} onClick={follow(null)} aria-label={brandLabel}>
        {brand}
      </a>
      {pages.length > 0 && (
        <nav className="site-links" aria-label="Menu strony">
          {pages.map((p) => (
            <a key={p.key} href={href(p)} onClick={follow(p.path, p.type)} aria-current={p.path === current ? 'page' : undefined}>
              {p.label}
            </a>
          ))}
        </nav>
      )}
      <a className="btn sm" href={button.href}>
        {button.label}
      </a>
      {pages.length > 0 && (
        <button type="button" className="site-menu-btn" aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
          Menu
        </button>
      )}
      {menuOpen && (
        <MobileMenu onClose={() => setMenuOpen(false)} button={button}>
          {pages.map((p, i) => (
            <a key={p.key} href={href(p)} onClick={follow(p.path, p.type)} aria-current={p.path === current ? 'page' : undefined} style={{ '--i': i } as CSSProperties}>
              {p.label}
            </a>
          ))}
        </MobileMenu>
      )}
    </header>
  );
}

/** Menu na telefonie: natywny <dialog> na cały ekran – Esc, fokus i blokada przewijania jak w oknie trenerki. */
function MobileMenu({ children, button, onClose }: { children: ReactNode; button: Props['button']; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="site-menu" aria-label="Menu" onClose={onClose}>
      <button type="button" className="site-dialog-close" onClick={() => ref.current?.close()} aria-label="Zamknij menu">
        <Icon name="close" size={18} />
      </button>
      <nav className="site-menu-links" aria-label="Menu strony">
        {children}
      </nav>
      <a className="btn" href={button.href}>
        {button.label}
      </a>
    </dialog>
  );
}
