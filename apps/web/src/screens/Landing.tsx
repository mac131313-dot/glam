// Strona startowa demo: dwa wejścia – panel studia i aplikacja mobilna.
import type { ReactNode } from 'react';
import { PERSONAS } from '../demo.ts';
import { Icon } from '../icons.tsx';

export function Landing() {
  const tiles = [
    { href: '/panel', eyebrow: 'Dla studia', title: 'Panel', serif: 'zarządzania', hint: 'Pulpit, grafik, karnety, powitania, motywy i wygląd studia.', personas: PERSONAS.panel, base: '/panel' },
    { href: '/app', eyebrow: 'Dla klientki', title: 'Aplikacja', serif: 'mobilna', hint: 'Rezerwacje, karnet, oddech z kołem, wejściówki dla znajomych.', personas: PERSONAS.app, base: '/app' },
  ];
  return (
    <main className="login">
      <div className="stack-lg" style={{ width: 'min(880px, 100%)' }}>
        <div className="center stack" style={{ gap: 10 }}>
          <div className="wordmark">glam</div>
          <div className="serif" style={{ fontSize: '1.35rem' }}>
            wersja demonstracyjna
          </div>
        </div>
        <div className="grid-2">
          {tiles.map((t) => (
            <div key={t.href} className="card stack" style={{ padding: 30, gap: 18 }}>
              <div>
                <div className="eyebrow">{t.eyebrow}</div>
                <h2 style={{ fontSize: '2rem', margin: 0 }}>
                  {t.title} <span className="serif">{t.serif}</span>
                </h2>
                <p className="muted small" style={{ margin: '6px 0 0' }}>
                  {t.hint}
                </p>
              </div>
              <a className="btn" href={t.href}>
                Otwórz <Icon name="chevron" size={18} />
              </a>
              <div className="stack" style={{ gap: 4 }}>
                <div className="eyebrow" style={{ margin: 0 }}>
                  Konta demo
                </div>
                {Object.entries(t.personas).map(([k, p]) => (
                  <a key={k} className="small" href={`${t.base}?jako=${k}`} style={{ color: 'var(--muted)' }}>
                    {p.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="tiny muted center">Tryb demo: bez logowania, płatności i SMS-y są symulowane.</p>
      </div>
    </main>
  );
}

/**
 * Na komputerze aplikacja mobilna wyświetla się w ramce telefonu. `transform` na ramce sprawia,
 * że elementy `position: fixed` (pasek zakładek, arkusze, sesja oddechu) trzymają się ramki, a nie okna.
 * Na telefonie ramka znika i aplikacja zajmuje cały ekran.
 */
export function DeviceFrame({ children }: { children: ReactNode }) {
  return (
    <div className="device-stage">
      <div className="device">
        <div className="device-scroll">{children}</div>
      </div>
      <div className="device-caption tiny muted">
        <a href="/">glam demo</a> · <a href="/panel" target="glam-panel">panel studia</a>
      </div>
    </div>
  );
}
