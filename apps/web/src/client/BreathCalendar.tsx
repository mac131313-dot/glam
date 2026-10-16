// Kalendarz oddechu w „Dla mnie”: miesiąc po miesiącu, a dzień z chwilą oddechu rozkwita tym samym kwiatkiem co tydzień rytuału.
import { useState } from 'react';
import type { BreathRitual } from '@glam/core';
import { Icon } from '../icons.tsx';
import { Sheet } from '../ui.tsx';
import { MiniBloom } from './BreathBloom.tsx';

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function BreathCalendar({ ritual, onClose }: { ritual: BreathRitual; onClose: () => void }) {
  const now = new Date();
  const today = isoDay(now);
  const current = now.getFullYear() * 12 + now.getMonth();
  // Wstecz do pierwszego miesiąca z kwiatkiem (najdalej rok), dalej niż bieżący miesiąc nie ma po co.
  const first = ritual.days[0] ? Number(ritual.days[0].slice(0, 4)) * 12 + Number(ritual.days[0].slice(5, 7)) - 1 : current;
  const oldest = Math.max(current - 12, Math.min(first, current));
  const [month, setMonth] = useState(current);
  const done = new Set(ritual.days);

  const year = Math.floor(month / 12);
  const m = month % 12;
  const lead = (new Date(year, m, 1).getDay() + 6) % 7;
  const count = new Date(year, m + 1, 0).getDate();
  const cells = Array.from({ length: count }, (_, i) => isoDay(new Date(year, m, i + 1)));
  const inMonth = cells.filter((d) => done.has(d)).length;
  const title = new Date(year, m, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

  return (
    <Sheet onClose={onClose} label="Kalendarz oddechu">
      <div className="bcal">
        <header className="bcal-head">
          <button className="bcal-nav" aria-label="Poprzedni miesiąc" disabled={month <= oldest} onClick={() => setMonth(month - 1)}>
            <Icon name="back" size={18} />
          </button>
          <h2 className="bcal-title serif">{title.charAt(0).toUpperCase() + title.slice(1)}</h2>
          <button className="bcal-nav bcal-next" aria-label="Następny miesiąc" disabled={month >= current} onClick={() => setMonth(month + 1)}>
            <Icon name="back" size={18} />
          </button>
        </header>
        <p className="bcal-sum small muted">
          {inMonth ? `${inMonth} ${inMonth === 1 ? 'dzień' : 'dni'} z oddechem w tym miesiącu` : month === current ? 'Pierwszy kwiatek tego miesiąca czeka na Ciebie.' : 'W tym miesiącu bez kwiatków.'}
        </p>
        <div className="bcal-grid" role="grid" aria-label={`Kalendarz oddechu – ${title}`}>
          {WEEKDAYS.map((w) => (
            <span key={w} className="bcal-dow tiny" role="columnheader">
              {w}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`x${i}`} aria-hidden />
          ))}
          {cells.map((d, i) => {
            const on = done.has(d);
            return (
              <div
                key={d}
                role="gridcell"
                className={`bcal-day ${on ? 'on' : ''} ${d === today ? 'today' : ''} ${d > today ? 'future' : ''}`}
                aria-label={`${i + 1}: ${on ? 'była chwila oddechu' : 'bez oddechu'}`}
              >
                <span className="bcal-num">{i + 1}</span>
                {on && <MiniBloom />}
              </div>
            );
          })}
        </div>
        <p className="bcal-total tiny muted center">Razem {ritual.total} {ritual.total === 1 ? 'dzień' : 'dni'} z chwilą dla siebie</p>
      </div>
    </Sheet>
  );
}
