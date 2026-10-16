// Nagłówek odsłaniany słowo po słowie (spec 3.3). Każde słowo wyjeżdża spod maski: y 110% → 0, co 0.06 s.
// Dopisek w kursywie (jedyny ozdobnik) dodatkowo prostuje się z 4°. Czytnik ekranu dostaje zwykły tekst.
import type { CSSProperties, ReactNode } from 'react';
import { MOTION, stagger, useInView } from './motion.ts';

type Props = {
  as?: 'h1' | 'h2';
  className?: string;
  title: string;
  serif?: string;
  /** opóźnienie startu w sekundach */
  delay?: number;
  /** od razu po załadowaniu (hero), zamiast przy wejściu w ekran */
  immediate?: boolean;
};

export function SplitHeading({ as: Tag = 'h2', className, title, serif = '', delay = 0, immediate = false }: Props) {
  const [ref, seen] = useInView<HTMLHeadingElement>(0.2);
  if (!MOTION)
    return (
      <Tag className={className}>
        {title}
        {serif && <span className="serif"> {serif}</span>}
      </Tag>
    );

  let i = 0;
  const words = (text: string): ReactNode[] =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .map((w, k) => {
        const style = { '--sw-delay': `${delay + i++ * stagger.word}s` } as CSSProperties;
        return (
          <span key={k}>
            {k > 0 && ' '}
            <span className="sw">
              <span className="sw-i" style={style}>
                {w}
              </span>
            </span>
          </span>
        );
      });

  const label = serif ? `${title} ${serif}`.trim() : title;
  return (
    <Tag ref={ref} className={`site-split-h${immediate || seen ? ' is-in' : ''}${className ? ` ${className}` : ''}`} aria-label={label}>
      <span aria-hidden="true">{words(title)}</span>
      {serif && (
        <span className="serif" aria-hidden="true">
          {title && ' '}
          {words(serif)}
        </span>
      )}
    </Tag>
  );
}
