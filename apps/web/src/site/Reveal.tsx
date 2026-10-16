// Odsłanianie przy przewijaniu (spec 3.2): opacity 0 → 1, y 40 → 0, blur 8 → 0, 0.8 s.
// Grupa: `index` przesuwa start o 0.08 s na element (karty, punkty listy).
import type { CSSProperties, ElementType, ReactNode } from 'react';
import { MOTION, stagger, useInView } from './motion.ts';

type Props = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** opóźnienie w sekundach */
  delay?: number;
  /** pozycja w grupie – dodaje opóźnienie stagger.item × index */
  index?: number;
};

export function Reveal({ children, as: Tag = 'div', className, delay = 0, index = 0 }: Props) {
  const [ref, inView] = useInView<HTMLElement>();
  if (!MOTION) return <Tag className={className}>{children}</Tag>;
  const style = { '--rv-delay': `${delay + index * stagger.item}s` } as CSSProperties;
  return (
    <Tag ref={ref} className={`rv${inView ? ' is-in' : ''}${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </Tag>
  );
}
