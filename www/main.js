// GLAM – strona platformy. Bez zależności: zakładki funkcji, podgląd palet, kod QR zmieniający się
// co minutę, aktywny link w menu i formularz kontaktowy (otwiera pocztę z gotową wiadomością).

// Adres, na który trafiają zgłoszenia z formularza. Zmień przed publikacją.
const CONTACT_EMAIL = 'kontakt@twojadomena.pl';

document.documentElement.classList.remove('no-js');

// ——— Pasek nawigacji: materiał dopiero po przewinięciu ———
const nav = document.querySelector('[data-nav]');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// ——— Aktywny link w menu: sekcja, którą właśnie czytasz ———
const navLinks = [...document.querySelectorAll('.nav-links a')];
if ('IntersectionObserver' in window) {
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      navLinks.forEach((a) => a.setAttribute('aria-current', String(a.hash === `#${entry.target.id}`)));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  navLinks.forEach((a) => { const s = document.querySelector(a.hash); if (s) spy.observe(s); });
}

// ——— Zakładki funkcji (wzorzec WAI-ARIA: strzałki, Home, End) ———
const tabs = [...document.querySelectorAll('[data-tabs] [role="tab"]')];
const tabsInd = document.querySelector('[data-tabs-ind]');
// Wskaźnik jedzie do wybranej zakładki od miejsca, w którym akurat jest – kolejne kliknięcie w trakcie ruchu go przekierowuje.
const moveInd = (tab) => {
  tabsInd.style.width = `${tab.offsetWidth}px`;
  tabsInd.style.transform = `translateX(${tab.offsetLeft}px)`;
};
const selectTab = (tab, focus) => {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(t.getAttribute('aria-controls'));
    panel.hidden = !on;
    panel.classList.toggle('entering', on);
  });
  moveInd(tab);
  if (focus) tab.focus();
};
// Pierwsze ustawienie bez animacji, potem przy zmianie szerokości okna.
tabsInd.style.transition = 'none';
moveInd(tabs[0]);
requestAnimationFrame(() => requestAnimationFrame(() => tabsInd.style.removeProperty('transition')));
window.addEventListener('resize', () => moveInd(tabs.find((t) => t.getAttribute('aria-selected') === 'true')));
document.fonts?.ready.then(() => moveInd(tabs.find((t) => t.getAttribute('aria-selected') === 'true')));
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(tabs[(next + tabs.length) % tabs.length], true);
  });
});

// ——— Podgląd marki: te same palety co w edytorze wyglądu (packages/core/src/look.ts) ———
const PALETTES = {
  isola: { name: 'Kamień i taupe', bg: '#f3f0ea', surface: '#fbfaf7', soft: '#e6e1d6', brand: '#9b8570', ink: '#1b1715', muted: '#5e554c' },
  unbound: { name: 'Mgła i grafit', bg: '#efedea', surface: '#faf9f7', soft: '#e2ddd8', brand: '#b1a497', ink: '#2f2b2a', muted: '#6d6968' },
  sand: { name: 'Piasek i mleko', bg: '#f7f4ef', surface: '#fffdfa', soft: '#ece5da', brand: '#c2ad93', ink: '#24201d', muted: '#655b51' },
  blush: { name: 'Pudrowy róż', bg: '#faf5f3', surface: '#fffcfb', soft: '#f1e2e2', brand: '#d4a5a5', ink: '#2e2224', muted: '#6b5a5d' },
  biel: { name: 'Czysta biel', bg: '#ffffff', surface: '#ffffff', soft: '#f3f3f4', brand: '#a1a1aa', ink: '#18181b', muted: '#5f5f66' },
};
const brand = document.querySelector('[data-brand]');
const paletteName = document.querySelector('[data-palette-name]');
const swatches = [...document.querySelectorAll('[data-palette]')];
const applyPalette = (id) => {
  const p = PALETTES[id];
  for (const key of ['bg', 'surface', 'soft', 'brand', 'ink', 'muted']) brand.style.setProperty(`--b-${key}`, p[key]);
  paletteName.textContent = p.name;
  swatches.forEach((s) => {
    const on = s.dataset.palette === id;
    s.setAttribute('aria-checked', String(on));
    s.tabIndex = on ? 0 : -1;
  });
};
swatches.forEach((s, i) => {
  s.addEventListener('click', () => applyPalette(s.dataset.palette));
  s.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = swatches[(i + step + swatches.length) % swatches.length];
    applyPalette(next.dataset.palette);
    next.focus();
  });
});
applyPalette('isola');

// ——— Kod QR: wzór dekoracyjny, który zmienia się co minutę jak w aplikacji ———
const qr = document.querySelector('[data-qr]');
const qrSec = document.querySelector('[data-qr-sec]');
const SIZE = 21;
const cells = [];
for (let i = 0; i < SIZE * SIZE; i++) cells.push(qr.appendChild(document.createElement('i')));
// Trzy narożne znaczniki jak w prawdziwym kodzie: ramka, przerwa, środek. Wokół nich pusty margines.
const finder = (x, y) => {
  for (const [ox, oy] of [[0, 0], [SIZE - 7, 0], [0, SIZE - 7]]) {
    const dx = x - ox, dy = y - oy;
    if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) return Math.min(dx, dy, 6 - dx, 6 - dy) !== 1;
    if (dx >= -1 && dx <= 7 && dy >= -1 && dy <= 7) return false;
  }
  return null;
};
const drawQr = (minute) => {
  let seed = minute + 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const f = finder(x, y);
      cells[y * SIZE + x].classList.toggle('on', f ?? rand() > 0.52);
    }
  }
};
let lastMinute = Math.floor(Date.now() / 60000);
drawQr(lastMinute);
const tick = () => {
  const now = Date.now();
  qrSec.textContent = String(60 - Math.floor((now / 1000) % 60));
  const minute = Math.floor(now / 60000);
  if (minute !== lastMinute) { lastMinute = minute; drawQr(minute); }
};
tick();
setInterval(tick, 1000);

// ——— Formularz: walidacja i gotowa wiadomość w programie pocztowym ———
const mailto = (subject, body = '') => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
document.querySelector('[data-mail]').href = mailto('Pokaz GLAM');

const form = document.querySelector('[data-form]');
const note = document.querySelector('[data-form-note]');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const missing = [...form.querySelectorAll('[required]')].filter((f) => !f.value.trim());
  form.querySelectorAll('[required]').forEach((f) => f.setAttribute('aria-invalid', String(missing.includes(f))));
  if (missing.length) {
    note.textContent = 'Uzupełnij imię, nazwę studia i kontakt.';
    missing[0].focus();
    return;
  }
  const d = Object.fromEntries(new FormData(form));
  window.location.href = mailto(`Pokaz GLAM – ${d.studio}`, `Imię: ${d.imie}\nStudio: ${d.studio}\nKontakt: ${d.kontakt}`);
  note.textContent = 'Otwieramy Twój program pocztowy z gotową wiadomością.';
});
form.addEventListener('input', (e) => { if (e.target.value.trim()) e.target.removeAttribute('aria-invalid'); });

document.querySelector('[data-year]').textContent = String(new Date().getFullYear());
