// Przycisk „Domena” w pasku edytora: adres własnej domeny studia, rekordy DNS do wpisania u rejestratora
// i sprawdzenie (po stronie serwera), czy domena już wskazuje na nas.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api.ts';
import { useLayer } from '../../back.ts';
import { useToast } from '../../ui.tsx';
import { Glyph } from './shell.tsx';

export type SiteDns = { ip: string | null; host: string; domain: string | null };

type DnsState = 'ok' | 'other' | 'none';
type DomainCheck = { domain: string; apex: DnsState; www: DnsState; ok: boolean };
type DomainRes = { domain: string | null; check: DomainCheck | null };

type DnsRecord = { type: string; name: string; value: string; hint: string; state: DnsState | null };

function records(dns: SiteDns, domain: string | null, check: DomainCheck | null): DnsRecord[] {
  const d = domain ?? 'twojestudio.pl';
  const list: DnsRecord[] = [];
  if (dns.ip) list.push({ type: 'A', name: '@', value: dns.ip, hint: `domena bez www: ${d}`, state: check?.apex ?? null });
  list.push({ type: 'CNAME', name: 'www', value: `${dns.host}.`, hint: `adres z www: www.${d}`, state: check?.www ?? null });
  return list;
}

const STATE_LABEL: Record<DnsState, string> = { ok: 'Działa', other: 'Wskazuje gdzie indziej', none: 'Jeszcze nie ustawiony' };

export function DomainButton({ dns, slug }: { dns: SiteDns; slug: string }) {
  const [open, setOpen] = useState(false);
  // Zapisana domena żyje tu, a nie w oknie – po zamknięciu i ponownym otwarciu okno pokazuje to, co zapisano.
  const [domain, setDomain] = useState(dns.domain);
  return (
    <>
      <button className="se-domena" onClick={() => setOpen(true)} title="Podłącz własną domenę">
        <Glyph name="globe" />
        <span>Domena</span>
      </button>
      {open && <DnsDialog dns={dns} slug={slug} domain={domain} onSaved={setDomain} onClose={() => setOpen(false)} />}
    </>
  );
}

function DnsDialog({ dns, slug, domain, onSaved, onClose }: { dns: SiteDns; slug: string; domain: string | null; onSaved: (d: string | null) => void; onClose: () => void }) {
  useLayer(onClose);
  const toast = useToast();
  const [text, setText] = useState(domain ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<DomainCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setCheck((await api<DomainRes>('/site/domain/check')).check);
    } catch {
      setCheck(null);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (domain) void recheck();
  }, [domain, recheck]);

  // Serwer sam porządkuje wpis („https://www.Studio.pl/” → „studio.pl”) – pole pokazuje potem wersję zapisaną.
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<DomainRes>('/site/domain', { method: 'PUT', body: { domain: text } });
      setText(res.domain ?? '');
      setCheck(res.check);
      onSaved(res.domain);
      toast(res.domain ? 'Domena zapisana' : 'Domena odłączona');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać domeny.');
    } finally {
      setBusy(false);
    }
  };
  const dirty = text.trim() !== (domain ?? '');

  const copy = (v: string) => {
    void navigator.clipboard.writeText(v).then(
      () => toast('Skopiowano'),
      () => toast('Nie udało się skopiować – zaznacz i skopiuj ręcznie', 'error'),
    );
  };
  return (
    <div className="se-okno-tlo" onClick={onClose}>
      <div className="se-okno" role="dialog" aria-modal="true" aria-label="Podłączenie domeny" onClick={(e) => e.stopPropagation()}>
        <div className="se-okno-naglowek">
          <Glyph name="globe" />
          <strong className="grow">Podłączenie domeny</strong>
          <button className="se-ikona" onClick={onClose} aria-label="Zamknij" autoFocus>
            <Glyph name="close" />
          </button>
        </div>
        <div className="se-okno-tresc">
          <form
            className="se-pole"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty && !busy) void save();
            }}
          >
            <label className="se-pole-etykieta" htmlFor="se-domena">
              Adres domeny studia
            </label>
            <div className="se-domena-wiersz">
              <input
                id="se-domena"
                className="se-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="twojestudio.pl"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button className="se-przycisk se-publikuj" type="submit" disabled={!dirty || busy}>
                {busy ? 'Zapisuję…' : 'Zapisz'}
              </button>
            </div>
            {error ? (
              <span className="se-pole-podpowiedz se-domena-blad">{error}</span>
            ) : (
              <span className="se-pole-podpowiedz">Wystarczy sama nazwa – działa z www i bez. Wyczyść pole i zapisz, żeby odłączyć domenę.</span>
            )}
          </form>
          {domain && (
            <div className="se-domena-stan">
              <span className="se-pill" data-on={check?.ok || undefined}>
                {checking && !check ? 'Sprawdzam…' : check?.ok ? `${domain} wskazuje na GLAM` : `${domain} jeszcze nie wskazuje na GLAM`}
              </span>
              <button className="se-przycisk maly" type="button" onClick={() => void recheck()} disabled={checking}>
                {checking ? 'Sprawdzam…' : 'Sprawdź ponownie'}
              </button>
            </div>
          )}
          <p>
            Zaloguj się u rejestratora, u którego kupiono domenę (np. OVH, home.pl, nazwa.pl), otwórz <b>strefę DNS</b> i dodaj poniższe rekordy. Stare
            rekordy A i CNAME o tych samych nazwach usuń.
          </p>
          <table className="se-dns">
            <thead>
              <tr>
                <th>Typ</th>
                <th>Nazwa</th>
                <th>Wartość</th>
                {domain && <th>Stan</th>}
                <th aria-label="Kopiuj" />
              </tr>
            </thead>
            <tbody>
              {records(dns, domain, check).map((r) => (
                <tr key={r.type + r.name}>
                  <td>
                    <span className="se-dns-typ">{r.type}</span>
                  </td>
                  <td>
                    <code>{r.name}</code>
                    <div className="se-dns-hint">{r.hint}</div>
                  </td>
                  <td>
                    <code>{r.value}</code>
                  </td>
                  {domain && (
                    <td>
                      {r.state && (
                        <span className="se-pill" data-on={r.state === 'ok' || undefined}>
                          {STATE_LABEL[r.state]}
                        </span>
                      )}
                    </td>
                  )}
                  <td>
                    <button className="se-ikona" onClick={() => copy(r.value)} aria-label={`Kopiuj wartość ${r.type}`} title="Kopiuj wartość">
                      <Glyph name="copy" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!dns.ip && <p className="se-dns-uwaga">Dla domeny bez www ustaw u rejestratora przekierowanie na adres z www.</p>}
          <p className="se-dns-uwaga">
            Zmiany DNS zaczynają działać zwykle w ciągu godziny, czasem do 48 godzin. Do tego czasu strona jest pod adresem{' '}
            <a href={`/s/${slug}`} target="_blank" rel="noopener">
              {location.host}/s/{slug}
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
