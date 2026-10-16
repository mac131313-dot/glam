// Cienkie ikony liniowe (1.5 px) – w miejsce emoji w interfejsie. Kolor dziedziczą z tekstu.
import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />,
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
      <path d="M8 3.5v4M16 3.5v4M4 10h16" />
    </>
  ),
  leaf: <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14M5 19l7-7" />,
  tv: (
    <>
      <path d="M7.5 17.5H6a2.5 2.5 0 0 1-2.5-2.5V7A2.5 2.5 0 0 1 6 4.5h12A2.5 2.5 0 0 1 20.5 7v8a2.5 2.5 0 0 1-2.5 2.5h-1.5" />
      <path d="m12 14.5 4 5H8z" />
    </>
  ),
  heart: <path d="M12 19.5s-7.5-4.4-7.5-10A4 4 0 0 1 12 7a4 4 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z" />,
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
  chart: <path d="M5 19V11M10 19V6M15 19v-5M20 19V9M3.5 19.5h17" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </>
  ),
  gift: (
    <>
      <rect x="4" y="9" width="16" height="11" rx="2.5" />
      <path d="M12 9v11M4 13h16M12 9c-1.5-3.5-5-3.5-5-1.5S9.5 9 12 9zM12 9c1.5-3.5 5-3.5 5-1.5S14.5 9 12 9z" />
    </>
  ),
  ticket: <path d="M4 8a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4zM10 6v12" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  season: <path d="M12 3c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10zM12 21v-6" />,
  type: <path d="M5 7V5h14v2M12 5v14M9 19h6" />,
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="3" />
      <path d="M11 18h2" />
    </>
  ),
  out: <path d="M14 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h9" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  down: <path d="m7 10 5 5 5-5" />,
  back: <path d="m15 6-6 6 6 6" />,
  swap: <path d="M7 7h11l-3-3M17 17H6l3 3" />,
  wave: <path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />,
  clip: <path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />,
  vibrate: (
    <>
      <rect x="8" y="4" width="8" height="16" rx="2.5" />
      <path d="M4.5 9v6M19.5 9v6" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m7.5 12.2 2.8 2.8 6.2-6.6" />,
  star: <path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" />,
  bell: <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14zM10 20.5a2.2 2.2 0 0 0 4 0" />,
  chat: <path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4 3v-3H5A1.5 1.5 0 0 1 3.5 16V8A1.5 1.5 0 0 1 5 6.5z" />,
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2" />
    </>
  ),
  bag: <path d="M5.5 8.5h13l-1 11h-11zM9 8.5V7a3 3 0 0 1 6 0v1.5" />,
  cap: <path d="m3 9 9-4 9 4-9 4zM7 11v4.5c1.5 1.5 3 2 5 2s3.5-.5 5-2V11M21 9v5" />,
  music: <path d="M9 17.5V6l10-2v11.5M9 17.5a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 9 17.5zM19 15.5a2.5 2.5 0 1 1-2.5-2.5 2.5 2.5 0 0 1 2.5 2.5z" />,
  flag: <path d="M6 20V4.5M6 5h11l-2 4 2 4H6" />,
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  pen: <path d="m15.5 5.5 3 3L9 18H6v-3zM13.5 7.5l3 3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  people: (
    <>
      <circle cx="9" cy="9" r="3" />
      <circle cx="16.5" cy="10" r="2.5" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M14.5 15c2.6-.4 4.6.9 5.5 3.5" />
    </>
  ),
  shield: <path d="M12 3.5 19 6v5.5c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z" />,
  moon: <path d="M18.5 14.5A7 7 0 0 1 9.5 5.5a7 7 0 1 0 9 9z" />,
  sparkle: <path d="M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M7 17l2-2M15 9l2-2" />,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  trash: <path d="M5 7h14M9.5 7V5h5v2M7 7l1 12.5h8L17 7" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
    </>
  ),
  card: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
      <path d="M3.5 10h17" />
    </>
  ),
  ten: <path d="M7 8v8M10.5 9.5a2.5 3.5 0 1 0 5 0 2.5 3.5 0 1 0-5 0" />,
  flower: <path d="M12 10.5a2 2 0 1 0 0 3 2 2 0 0 0 0-3zM12 4.5c2 1.5 2 3.5 0 6-2-2.5-2-4.5 0-6zM12 13.5c2 2.5 2 4.5 0 6-2-1.5-2-3.5 0-6zM4.5 12c1.5-2 3.5-2 6 0-2.5 2-4.5 2-6 0zM13.5 12c2.5-2 4.5-2 6 0-1.5 2-3.5 2-6 0z" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name]}
    </svg>
  );
}
