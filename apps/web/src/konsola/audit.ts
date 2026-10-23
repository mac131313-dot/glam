// Wspólne nazwy w konsoli: wpisy dziennika (`platform_audit` + wejścia w dane studia) po polsku, role zespołu,
// statusy usług i format daty. Używa ich historia na karcie studia i cały Dziennik – jeden słownik na oba miejsca.
import { FEATURE_LABEL, planById, type Feature } from '@glam/core';

const DAY = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'numeric', year: 'numeric' });
export const date = (iso: string) => DAY.format(new Date(iso));

/** Role zespołu konsoli (klucze jak w `platform_staff.role`). */
export const ROLE_NAME: Record<string, string> = { admin: 'Admin', support: 'Wsparcie', finance: 'Finanse' };

/** Statusy komponentów strony statusu; `operational` to brak otwartego incydentu. */
export const INCIDENT_STATUS: Record<string, string> = { operational: 'Działa', degraded: 'Spowolnienie', outage: 'Awaria', maintenance: 'Prace serwisowe' };

/** Wpis historii: nazwa działania i krótki opis szczegółów. Obejmuje każde działanie, które zapisuje serwer. */
export function describeAudit(action: string, d: Record<string, any> | null): { title: string; detail?: string } {
  const planName = (id: string | null | undefined) => (id ? planById(id).name : 'brak');
  const role = (r: string | undefined) => (r ? (ROLE_NAME[r] ?? r).toLowerCase() : undefined);
  switch (action) {
    case 'studio.plan':
      return { title: 'Zmiana planu', detail: `${planName(d?.from)} → ${planName(d?.to)}` };
    case 'studio.suspend':
      return { title: 'Zawieszenie', detail: d?.reason };
    case 'studio.unsuspend':
      return { title: 'Zdjęcie zawieszenia' };
    case 'studio.trial':
      return { title: 'Przedłużenie triala', detail: d?.days && d.to ? `o ${d.days} dni, do ${date(d.to)}` : undefined };
    case 'studio.offline_billing':
      return { title: 'Rozliczane poza systemem' };
    case 'studio.flag': {
      const label = FEATURE_LABEL[d?.flag as Feature] ?? d?.flag;
      return { title: 'Zmiana funkcji', detail: `${label}: ${d?.enabled === null ? 'jak w planie' : d?.enabled ? 'włączona' : 'wyłączona'}` };
    }
    case 'studio.fill':
      return { title: 'Uzupełnienie grafiku' };
    case 'studio.access':
      return { title: 'Wejście w dane studia', detail: d?.reason };
    case 'payment.invoiced':
      return { title: 'Płatność zafakturowana', detail: d?.number };
    case 'ticket.reply':
      return { title: d?.closed ? 'Zgłoszenie zamknięte' : 'Odpowiedź na zgłoszenie' };
    case 'incident.open':
      return { title: 'Incydent zgłoszony', detail: [d?.component, d?.status && INCIDENT_STATUS[d.status]?.toLowerCase()].filter(Boolean).join(' · ') || undefined };
    case 'incident.resolve':
      return { title: 'Incydent rozwiązany' };
    case 'team.invite':
      return { title: 'Zaproszenie do zespołu', detail: role(d?.role) };
    case 'team.role':
      return { title: 'Zmiana roli w zespole', detail: `${role(d?.from)} → ${role(d?.to)}` };
    case 'team.disable':
      return { title: 'Wyłączenie z zespołu' };
    case 'team.enable':
      return { title: 'Przywrócenie do zespołu' };
    default:
      return { title: action };
  }
}
