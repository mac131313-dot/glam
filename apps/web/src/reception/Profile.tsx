// Profil konta firmowego recepcji: kto jest zalogowany, godziny recepcji, kod studia dla nowej klientki,
// historia płatności, sklep i zamówienia, powiadomienia na tym telefonie i konto. Bez karnetów – to konto studia.
import { useEffect, useState } from 'react';
import { nextReceptionLabel, receptionOpen, receptionSlots, type SupportHours } from '@glam/core';
import { DEMO_MODE, fmtPhone, useApi } from '../api.ts';
import type { Me } from '../App.tsx';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../push.ts';
import { Avatar, ListRow, QrCode, Sheet, Toggle, useToast } from '../ui.tsx';
import { PaymentsPage } from './Payments.tsx';
import { ShopOrdersPage } from './ShopOrders.tsx';

type StudioInfo = { name: string; timezone: string; inviteCode: string; features: string[]; support: { hours: SupportHours } };

const DAYS = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob'];

export function ReceptionProfile({ me }: { me: Me }) {
  const { data: studio } = useApi<StudioInfo>('/studio');
  const [invite, setInvite] = useState(false);
  const [page, setPage] = useState<'payments' | 'shop' | null>(null);
  const [push, setPush] = useState<boolean | null>(null);
  const toast = useToast();

  useEffect(() => {
    pushEnabled().then(setPush).catch(() => setPush(false));
  }, []);

  const togglePush = async (on: boolean) => {
    try {
      if (on) {
        const ok = await enablePush();
        if (!ok) return toast('Zezwól na powiadomienia w ustawieniach telefonu.', 'error');
      } else await disablePush();
      setPush(on);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const hours = studio?.support.hours;
  const open = hours && receptionOpen(hours, new Date(), studio.timezone);
  const next = hours && nextReceptionLabel(hours, new Date(), studio.timezone);
  // Jeden wiersz na dzień (od poniedziałku), kilka okien recepcji tego dnia obok siebie.
  const slots = hours ? receptionSlots(hours) : [];
  const lines = [1, 2, 3, 4, 5, 6, 0]
    .map((d) => ({ days: DAYS[d], time: slots.filter((s) => s.weekday === d).map((s) => `${s.from}–${s.to}`).join(' · ') }))
    .filter((l) => l.time);

  return (
    <div className="stack-lg">
      <section className="row">
        <Avatar name={me.user.name} />
        <div>
          <h1 className="serif" style={{ margin: 0, fontSize: '2.2rem' }}>{me.user.name ?? 'Recepcja'}</h1>
          <div className="muted small">konto firmowe · {fmtPhone(me.user.phone)}</div>
        </div>
      </section>

      {hours && (
        <section className="card soft stack gap-2">
          <div className="row between">
            <div className="eyebrow" style={{ margin: 0 }}>Godziny recepcji</div>
            <span className={`badge ${open ? 'ok' : ''}`}>{open ? 'otwarte' : 'zamknięte'}</span>
          </div>
          {lines.map((l) => (
            <div key={l.days + l.time} className="row between small">
              <span>{l.days}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{l.time}</span>
            </div>
          ))}
          {!open && next && <span className="tiny muted">Najbliżej: {next}</span>}
        </section>
      )}

      <section>
        <div className="eyebrow">Na co dzień</div>
        <ListRow title="Kod studia" hint="Nowa klientka skanuje i dołącza w aplikacji" onClick={() => setInvite(true)} />
        <ListRow title="Historia płatności" hint="Wpłaty w studiu z ostatnich 30 dni" onClick={() => setPage('payments')} />
        {studio?.features.includes('shop') && <ListRow title="Sklep i zamówienia" hint="Odbiory w recepcji i wysyłki" onClick={() => setPage('shop')} />}
      </section>

      {pushSupported() && push !== null && (
        <section>
          <div className="eyebrow">Ten telefon</div>
          <Toggle label="Powiadomienia" hint="Nowe wiadomości od klientek i alerty dnia" checked={push} onChange={togglePush} />
        </section>
      )}

      <section>
        <div className="eyebrow">Konto</div>
        <ListRow title="Panel studia" hint="Pełny system na komputerze lub tablecie" onClick={() => window.open('/panel', 'glam-panel')} />
        {DEMO_MODE && <ListRow title="Tryb demo" hint="Zmień konto" onClick={() => (location.href = '/')} />}
      </section>

      {page === 'payments' && <PaymentsPage onBack={() => setPage(null)} />}
      {page === 'shop' && <ShopOrdersPage onBack={() => setPage(null)} />}

      {invite && studio && (
        <Sheet onClose={() => setInvite(false)} label="Kod studia">
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <div className="eyebrow">Dołącz do {studio.name}</div>
            <QrCode text={`${location.origin}/app?kod=${studio.inviteCode}`} size={220} label={`Kod QR studia ${studio.name}`} />
            <b className="code" style={{ fontSize: '1.6rem', letterSpacing: '0.12em' }}>{studio.inviteCode}</b>
            <p className="small muted" style={{ margin: 0 }}>Klientka skanuje aparatem albo wpisuje kod w aplikacji.</p>
          </div>
        </Sheet>
      )}
    </div>
  );
}
