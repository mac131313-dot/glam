// Integracje zewnętrzne jako adaptery – produkcyjny dostawca podmienia tylko implementację.
// Bramka SMS (#44) z połączeniem głosowym (2.2: „awaryjnie, gdy SMS nie dotrze”), e-mail,
// płatności (4.2), wysyłka push (8). W SMS nigdy nie wysyłamy treści zdrowotnych (sekcja 11).

export interface SmsGateway {
  send(phone: string, text: string): Promise<void>;
  /** Połączenie głosowe z syntezą mowy – kod czytany cyframi. */
  call?(phone: string, text: string): Promise<void>;
}

export class ConsoleSmsGateway implements SmsGateway {
  readonly sent: { phone: string; text: string; channel: 'sms' | 'voice' }[] = [];
  private readonly quiet: boolean;

  constructor(quiet = false) {
    this.quiet = quiet;
  }

  async send(phone: string, text: string) {
    this.sent.push({ phone, text, channel: 'sms' });
    if (!this.quiet) console.log(`📱 SMS → ${phone}: ${text}`);
  }

  async call(phone: string, text: string) {
    this.sent.push({ phone, text, channel: 'voice' });
    if (!this.quiet) console.log(`☎️  Połączenie → ${phone}: ${text}`);
  }
}

export interface EmailSender {
  send(to: string, subject: string, text: string, attachments?: { name: string; mime: string; content: string }[]): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  private readonly quiet: boolean;
  constructor(quiet = false) {
    this.quiet = quiet;
  }
  async send(to: string, subject: string, text: string) {
    this.sent.push({ to, subject, text });
    if (!this.quiet) console.log(`✉️  E-mail → ${to}: ${subject}`);
  }
}

// Płatności: BLIK, Apple Pay, Google Pay, Przelewy24, karta (4.2). Studio podpina własną bramkę
// (decyzja 23) – GLAM nie pośredniczy w pieniądzach. Nigdy nie przechowujemy danych kart.
export const PAYMENT_METHODS = ['blik', 'apple_pay', 'google_pay', 'p24', 'card'] as const;
export const DESK_METHODS = ['cash', 'terminal'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number] | (typeof DESK_METHODS)[number] | 'link' | 'saved';

export type ChargeInput = { amountGrosze: number; method: PaymentMethod; description: string; studioId?: string };

export interface PaymentProvider {
  charge(input: ChargeInput): Promise<{ status: 'paid' | 'failed'; ref: string }>;
  refund?(ref: string, amountGrosze: number): Promise<{ status: 'refunded' | 'failed' }>;
}

export class MockPaymentProvider implements PaymentProvider {
  failNext = false;
  async charge() {
    if (this.failNext) {
      this.failNext = false;
      return { status: 'failed' as const, ref: 'mock_failed' };
    }
    return { status: 'paid' as const, ref: `mock_${crypto.randomUUID().slice(0, 8)}` };
  }
  async refund() {
    return { status: 'refunded' as const };
  }
}

/** Wysyłka push na urządzenie. Web Push (PWA) – services/webpush.ts; natywnie APNs/FCM. */
export interface PushSender {
  send(sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; url?: string }): Promise<'ok' | 'gone' | 'error'>;
}

export class ConsolePushSender implements PushSender {
  readonly sent: { endpoint: string; title: string; body: string }[] = [];
  private readonly quiet: boolean;
  constructor(quiet = false) {
    this.quiet = quiet;
  }
  async send(sub: { endpoint: string }, payload: { title: string; body: string }) {
    this.sent.push({ endpoint: sub.endpoint, ...payload });
    if (!this.quiet) console.log(`🔔 Push → ${sub.endpoint.slice(0, 40)}…: ${payload.body}`);
    return 'ok' as const;
  }
}
