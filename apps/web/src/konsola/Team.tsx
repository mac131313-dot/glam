// Zespół konsoli (tylko admin): lista osób, zaproszenie (telefon, imię, rola), zmiana roli i wyłączenie z potwierdzeniem.
// Serwer pilnuje, by został aktywny admin – jego odmowa wraca tu jako komunikat.
import { useState } from 'react';
import { api, fmtPhone, useApi } from '../api.ts';
import { Field, ListRow, Pending, Select, Sheet, useAction } from '../ui.tsx';
import { ROLE_NAME } from './audit.ts';
import type { PlatformRole } from './KonsolaApp.tsx';

type Member = { userId: string; name: string | null; phone: string; role: PlatformRole; disabledAt: string | null };

const ROLES = (['admin', 'support', 'finance'] as const).map((r) => ({ value: r, label: ROLE_NAME[r] }));

/** Same cyfry numeru (9 po prefiksie +48), pogrupowane po trzy: „500 600 700”. */
const phoneDigits = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  return (digits.length > 9 && digits.startsWith('48') ? digits.slice(2) : digits).slice(0, 9);
};
const groupPhone = (digits: string) => digits.replace(/(\d{3})(?=\d)/g, '$1 ');

export function Team({ meId }: { meId: string }) {
  const { data, error, reload } = useApi<Member[]>('/platform/team', [], { global: true });
  const [open, setOpen] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);
  if (!data) return <Pending error={error} reload={reload} />;
  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div>
          <h1 style={{ marginBottom: 0 }}>Zespół</h1>
          <p className="muted" style={{ margin: 0 }}>Kto ma dostęp do konsoli</p>
        </div>
        <button className="btn quiet sm" onClick={() => setInviting(true)}>
          Zaproś
        </button>
      </div>
      <div className="list-rows">
        {data.map((m) => (
          <ListRow
            key={m.userId}
            title={m.name ?? fmtPhone(m.phone)}
            hint={[fmtPhone(m.phone), ROLE_NAME[m.role], m.userId === meId ? 'to Ty' : null].filter(Boolean).join(' · ')}
            badge={m.disabledAt ? <span className="badge warn">Wyłączona</span> : undefined}
            onClick={() => setOpen(m)}
          />
        ))}
      </div>
      {inviting && <InviteSheet onClose={() => setInviting(false)} onDone={reload} />}
      {open && <MemberSheet member={data.find((m) => m.userId === open.userId) ?? open} isMe={open.userId === meId} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function InviteSheet({ onClose, onDone }: { onClose: () => void; onDone: () => unknown }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<PlatformRole>('support');
  const { run, busy } = useAction();
  return (
    <Sheet onClose={onClose} label="Zaproszenie do zespołu">
      <div className="stack">
        <h2>Zaproś do zespołu</h2>
        <p className="small muted" style={{ margin: 0 }}>Osoba dostanie SMS z zaproszeniem i zaloguje się do konsoli tym numerem.</p>
        <Field label="Imię">
          <input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Telefon" hint={phone.length > 0 && phone.length < 9 ? `Jeszcze ${9 - phone.length} cyfr` : undefined}>
          <input className="input" inputMode="tel" autoComplete="off" placeholder="500 600 700" value={groupPhone(phone)} onChange={(e) => setPhone(phoneDigits(e.target.value))} />
        </Field>
        <div className="field">
          <span className="field-label">Rola</span>
          <Select ariaLabel="Rola" value={role} options={ROLES} onChange={(r) => setRole(r as PlatformRole)} />
        </div>
        <button
          className="btn"
          disabled={!name.trim() || phone.length !== 9 || busy}
          onClick={async () => {
            const done = await run(() => api('/platform/team', { method: 'POST', body: { phone, name: name.trim(), role }, global: true }), 'Zaproszenie wysłane');
            if (done === undefined) return;
            await onDone();
            onClose();
          }}
        >
          Zaproś
        </button>
      </div>
    </Sheet>
  );
}

function MemberSheet({ member: m, isMe, onClose, onChanged }: { member: Member; isMe: boolean; onClose: () => void; onChanged: () => unknown }) {
  const [confirming, setConfirming] = useState(false);
  const { run, busy } = useAction();
  const update = async (patch: { role?: PlatformRole; disabled?: boolean }, ok: string) => {
    const done = await run(() => api(`/platform/team/${m.userId}`, { method: 'PUT', body: patch, global: true }), ok);
    await onChanged();
    return done !== undefined;
  };

  if (confirming)
    return (
      <Sheet key="confirm" onClose={() => setConfirming(false)} label="Wyłączenie z zespołu">
        <div className="stack">
          <h2>{isMe ? 'Wyłączyć siebie?' : `Wyłączyć ${m.name ?? 'tę osobę'}?`}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {isMe ? 'Stracisz dostęp do konsoli od razu.' : 'Osoba straci dostęp do konsoli od razu i zostanie wylogowana.'} Możesz ją później przywrócić.
          </p>
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              if (await update({ disabled: true }, 'Dostęp wyłączony')) onClose();
              else setConfirming(false);
            }}
          >
            Wyłącz dostęp
          </button>
        </div>
      </Sheet>
    );

  return (
    <Sheet key="member" onClose={onClose} label="Osoba z zespołu">
      <div className="stack">
        <div>
          <h2 style={{ marginBottom: 0 }}>{m.name ?? fmtPhone(m.phone)}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {fmtPhone(m.phone)}
            {isMe && ' · to Ty'}
          </p>
        </div>
        {m.disabledAt ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>Dostęp jest wyłączony. Przywrócona osoba wraca z rolą: {ROLE_NAME[m.role].toLowerCase()}.</p>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                if (await update({ disabled: false }, 'Dostęp przywrócony')) onClose();
              }}
            >
              Przywróć dostęp
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <span className="field-label">Rola</span>
              <Select ariaLabel="Rola" value={m.role} options={ROLES} onChange={(r) => r !== m.role && !busy && update({ role: r as PlatformRole }, 'Rola zmieniona')} />
            </div>
            <button className="btn danger" disabled={busy} onClick={() => setConfirming(true)}>
              Wyłącz dostęp
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
