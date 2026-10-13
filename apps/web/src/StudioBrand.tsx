// Marka studia w jednym miejscu: wgrane logo wyświetlone wg ustawień studia (kształt, rozmiar, tło,
// dopasowanie, kadr) albo litera zastępcza. Ten sam komponent w aplikacji, panelu i podglądzie.
import { resolveLogoDisplay, resolveLook, type Look } from '@glam/core';
import type { CSSProperties } from 'react';

export type BrandSource = { name: string; logo: string; logoUrl?: string | null; logoWide?: boolean; look?: Partial<Look> | null };

const BG: Record<string, string> = {
  none: 'transparent',
  surface: 'var(--surface)',
  soft: 'var(--soft)',
  brand: 'var(--brand)',
  ink: 'var(--ink)',
};

export function StudioBrand({ studio, scale = 1, showName }: { studio: BrandSource; scale?: number; showName?: boolean }) {
  const style = resolveLogoDisplay(resolveLook(studio.look).logo, !!studio.logoWide);
  const h = Math.round(style.size * scale);
  const nameVisible = showName ?? style.showName;
  const name = nameVisible ? <span className="studio-brand-name">{studio.name}</span> : null;

  if (!studio.logoUrl) {
    return (
      <>
        <span className="studio-logo" style={{ width: h, height: h, fontSize: h * 0.55 }}>
          {studio.logo}
        </span>
        {showName ?? true ? <span className="studio-brand-name">{studio.name}</span> : null}
      </>
    );
  }

  const free = style.shape === 'free';
  const radius = { circle: '50%', rounded: `${Math.round(h * 0.28)}px`, square: `${Math.max(2, Math.round(h * 0.06))}px`, free: style.background === 'none' ? '0' : `${Math.round(h * 0.28)}px` }[style.shape];
  const pad = style.fit === 'cover' && !free ? 0 : Math.round((h * style.padding) / 100);
  const transform = style.zoom !== 1 || style.x || style.y ? `translate(${style.x}%, ${style.y}%) scale(${style.zoom})` : undefined;

  const frame: CSSProperties = {
    height: h,
    width: free ? 'auto' : h,
    maxWidth: free ? h * 6 : h,
    borderRadius: radius,
    background: BG[style.background],
    padding: free && style.background === 'none' ? 0 : pad,
    paddingInline: free && style.background !== 'none' ? Math.max(pad, Math.round(h * 0.3)) : undefined,
  };
  const img: CSSProperties = free
    ? { height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain', transform }
    : { width: '100%', height: '100%', objectFit: style.fit, transform };

  return (
    <>
      <span className="studio-brand-frame" style={frame}>
        <img src={studio.logoUrl} alt={nameVisible ? '' : studio.name} style={img} draggable={false} />
      </span>
      {name}
    </>
  );
}
