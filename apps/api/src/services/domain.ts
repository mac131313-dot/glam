import { promises as nodeDns } from 'node:dns';
import type { Db } from '../db.ts';
import { badRequest, conflict } from '../errors.ts';

/**
 * Własna domena strony studia (np. studio.pl). Zapisujemy ją bez „www.”, bez protokołu i ścieżki –
 * ta sama domena obsługuje wtedy i studio.pl, i www.studio.pl (rekordy A dla @ i CNAME dla www).
 */

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Porządkuje to, co właścicielka wkleiła: „https://www.Studio.pl/kontakt” → „studio.pl”.
 * Polskie znaki przechodzą na punycode (zażółć.pl → xn--…), tak jak przyjdą w nagłówku Host.
 * Pusty tekst = odłączenie domeny (null). Zły format → błąd z podpowiedzią.
 */
export function normalizeDomain(input: unknown): string | null {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).hostname;
  } catch {
    throw badRequest('Wpisz sam adres domeny, np. twojestudio.pl.');
  }
  host = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(labels.at(-1)!)) {
    throw badRequest('Wpisz sam adres domeny, np. twojestudio.pl.');
  }
  return host;
}

/** Nagłówek Host → domena w postaci z bazy (bez portu i bez www). */
export const hostKey = (host: string) =>
  host
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '');

/** Studio (opublikowane, niezawieszone), którego domeną jest ten Host. */
export function studioByHost(db: Db, host: string | undefined): { id: string; slug: string } | undefined {
  if (!host) return undefined;
  return db.prepare("SELECT id, slug FROM studios WHERE custom_domain = ? AND published = 1 AND status != 'suspended'").get(hostKey(host)) as
    | { id: string; slug: string }
    | undefined;
}

/** Zapis domeny: format, nie nasz własny adres i nie zajęta przez inne studio. */
export function setDomain(db: Db, studioId: string, input: unknown, ownHost: string): string | null {
  const domain = normalizeDomain(input);
  if (domain && (domain === hostKey(ownHost) || domain.endsWith(`.${hostKey(ownHost)}`))) {
    throw badRequest('To adres GLAM – wpisz domenę kupioną dla studia.');
  }
  if (domain) {
    const taken = db.prepare('SELECT 1 FROM studios WHERE custom_domain = ? AND id != ?').get(domain, studioId);
    if (taken) throw conflict('domain_taken', 'Ta domena jest już podłączona do innego studia.');
  }
  db.prepare('UPDATE studios SET custom_domain = ? WHERE id = ?').run(domain, studioId);
  return domain;
}

export type DnsResolver = { resolve4(host: string): Promise<string[]>; resolveCname(host: string): Promise<string[]> };
export type DnsTarget = { ip: string | null; host: string };
/** ok – wskazuje na nas; other – wskazuje gdzie indziej; none – brak rekordu (albo DNS jeszcze się nie rozszedł). */
export type DnsState = 'ok' | 'other' | 'none';
export type DomainCheck = { domain: string; apex: DnsState; www: DnsState; ok: boolean };

const quiet = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms).unref())]);

/**
 * Czy domena już wskazuje na nasz serwer – sprawdzane po stronie serwera (przeglądarka nie zrobi zapytania DNS).
 * www: CNAME na nasz host albo (gdy rejestrator nie pozwala na CNAME) A na nasz IP.
 * Bez domeny głównej (apex) z naszym IP strona i tak działa pod www – „ok” wymaga tylko www.
 */
export async function checkDomain(domain: string, target: DnsTarget, dns: DnsResolver = nodeDns): Promise<DomainCheck> {
  const ourHost = hostKey(target.host);
  const [apexA, wwwCname, wwwA, hostA] = await withTimeout(
    Promise.all([
      quiet(dns.resolve4(domain)),
      quiet(dns.resolveCname(`www.${domain}`)),
      quiet(dns.resolve4(`www.${domain}`)),
      target.ip ? Promise.resolve([target.ip]) : quiet(dns.resolve4(target.host)),
    ]),
    4000,
    [[], [], [], []] as string[][],
  );
  const ours = new Set(hostA);
  const state = (pointsAtUs: boolean, any: boolean): DnsState => (pointsAtUs ? 'ok' : any ? 'other' : 'none');
  const apex = state(apexA.some((ip) => ours.has(ip)), apexA.length > 0);
  const www = state(
    wwwCname.some((c) => hostKey(c) === ourHost) || wwwA.some((ip) => ours.has(ip)),
    wwwCname.length > 0 || wwwA.length > 0,
  );
  return { domain, apex, www, ok: www === 'ok' };
}
