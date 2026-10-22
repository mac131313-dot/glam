// Abonament GLAM: webhook Stripe GLAM (`POST /api/platform/stripe`) i ekran „Abonament” właścicielki
// (`/api/owner/billing`: stan, dane do faktury, Checkout, Billing Portal, zmiana planu, rezygnacja).
// Bez `deps.platformStripe` akcje płatnicze odpowiadają 409 „Płatności abonamentu wkrótce”, a trial działa dalej.
import type { FastifyInstance } from 'fastify';
import { FEATURE_LABEL, formatPLN, PLANS, planById, planUsage, validEmail, validNip } from '@glam/core';
import { ctx, requireStudio, type Deps } from '../../context.ts';
import { nowIso, tx } from '../../db.ts';
import { badRequest, conflict, forbidden, notFound } from '../../errors.ts';
import { loadBilling } from '../../services/billing.ts';
import {
  billingNotConfigured,
  billingPortal,
  changeSubscriptionPlan,
  handlePlatformEvent,
  priceForPlan,
  setCancelAtPeriodEnd,
  subscriptionCheckout,
  type PlatformEvent,
} from '../../services/platform-stripe.ts';
import { verifyStripeSignature } from '../../services/stripe.ts';
import { studioUsage } from '../../services/usage.ts';

export function billingRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const owner = { preHandler: requireStudio(db, ['owner']) };
  const panelUrl = () => `${deps.publicUrl ?? ''}/panel`;
  const requireConfigured = () => {
    if (!deps.platformStripe) throw billingNotConfigured();
  };
  const knownPlan = (planId: unknown): string => {
    if (typeof planId !== 'string' || !PLANS.some((p) => p.id === planId)) throw badRequest('Nieznany plan.');
    return planId;
  };
  const requireSubscription = (studioId: string): string => {
    const sub = loadBilling(db, studioId).stripe_subscription_id;
    if (!sub) throw conflict('no_subscription', 'Najpierw dodaj kartę.');
    return sub;
  };

  // Webhook Stripe GLAM. Podpis liczony z surowego body, więc trasa ma własny parser JSON (jak webhook studiów).
  app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    sub.post<{ Body: string }>('/api/platform/stripe', async (req) => {
      const cfg = deps.platformStripe;
      if (!cfg) throw notFound();
      if (!verifyStripeSignature(req.body, req.headers['stripe-signature'] as string | undefined, cfg.webhookSecret)) throw forbidden();
      let event: PlatformEvent;
      try {
        event = JSON.parse(req.body) as PlatformEvent;
      } catch {
        throw badRequest('Nieprawidłowe zdarzenie.');
      }
      if (typeof event?.id !== 'string' || typeof event.type !== 'string' || typeof event.data?.object !== 'object' || event.data.object === null) throw badRequest('Nieprawidłowe zdarzenie.');
      await handlePlatformEvent(deps, event);
      return { received: true };
    });
  });

  app.get('/api/owner/billing', owner, async (req) => {
    const { studio, scope } = ctx(req);
    const plan = planById(studio.plan_id);
    const b = loadBilling(db, studio.id);
    const payments = db
      .prepare('SELECT period_start, period_end, amount_grosze, paid_at FROM platform_payments WHERE studio_id = ? ORDER BY paid_at DESC')
      .all(studio.id) as { period_start: string; period_end: string; amount_grosze: number; paid_at: string }[];
    return {
      configured: !!deps.platformStripe,
      plan: { id: plan.id, name: plan.name, price: formatPLN(plan.priceGrosze) },
      status: studio.status,
      trialEndsAt: studio.trial_ends_at,
      billing: {
        state: b.state,
        currentPeriodEnd: b.current_period_end,
        cancelAtPeriodEnd: !!b.cancel_at_period_end,
        pendingPlanId: b.pending_plan_id,
        companyName: b.company_name,
        nip: b.nip,
        address: b.address,
        invoiceEmail: b.invoice_email,
        hasCard: b.stripe_subscription_id !== null,
      },
      usage: planUsage(studioUsage(scope), plan),
      payments: payments.map((p) => ({ periodStart: p.period_start, periodEnd: p.period_end, amount: formatPLN(p.amount_grosze), paidAt: p.paid_at })),
      plans: PLANS.map((p) => ({ id: p.id, name: p.name, price: formatPLN(p.priceGrosze), limits: p.limits, featureLabels: p.features.map((f) => FEATURE_LABEL[f]) })),
    };
  });

  // Dane do faktury – działają także bez Stripe (GLAM fakturuje sam, ze strony konsoli).
  app.put<{ Body: { companyName?: string; nip?: string; address?: string; invoiceEmail?: string } }>('/api/owner/billing/details', owner, async (req) => {
    const { studio } = ctx(req);
    const b = req.body ?? {};
    const companyName = String(b.companyName ?? '').trim();
    const nip = String(b.nip ?? '').replace(/[\s-]/g, '');
    const address = String(b.address ?? '').trim();
    const invoiceEmail = String(b.invoiceEmail ?? '').trim();
    if (companyName.length < 2 || companyName.length > 200) throw badRequest('Podaj nazwę firmy.');
    if (!validNip(nip)) throw badRequest('Sprawdź NIP – 10 cyfr.');
    if (address.length > 300) throw badRequest('Adres jest za długi.');
    if (invoiceEmail && !validEmail(invoiceEmail)) throw badRequest('Sprawdź adres e-mail do faktur.');
    loadBilling(db, studio.id);
    db.prepare('UPDATE studio_billing SET company_name = ?, nip = ?, address = ?, invoice_email = ?, updated_at = ? WHERE studio_id = ?').run(companyName, nip, address || null, invoiceEmail || null, nowIso(), studio.id);
    return { ok: true };
  });

  // Dodanie karty (pierwsza subskrypcja). Zmiana planu przy aktywnej subskrypcji idzie przez /plan.
  app.post<{ Body: { planId?: string } }>('/api/owner/billing/checkout', owner, async (req) => {
    requireConfigured();
    const { studio } = ctx(req);
    const planId = knownPlan(req.body?.planId);
    const b = loadBilling(db, studio.id);
    if (b.stripe_subscription_id) throw conflict('subscription_exists', 'Abonament jest już aktywny – zmień plan');
    if (!b.company_name || !b.nip) throw badRequest('Uzupełnij dane do faktury');
    return subscriptionCheckout(deps, { id: studio.id, trialEndsAt: studio.trial_ends_at }, b, planId, panelUrl());
  });

  app.post('/api/owner/billing/portal', owner, async (req) => {
    requireConfigured();
    const customer = loadBilling(db, ctx(req).studio.id).stripe_customer_id;
    if (!customer) throw conflict('no_customer', 'Najpierw dodaj kartę.');
    return billingPortal(deps, customer, `${panelUrl()}#settings`);
  });

  // Droższy plan – od razu, z dopłatą proporcjonalną; tańszy – od następnego okresu (`pending_plan_id`).
  // Wybór obecnego planu przy czekającym obniżeniu cofa to obniżenie.
  app.post<{ Body: { planId?: string } }>('/api/owner/billing/plan', owner, async (req) => {
    requireConfigured();
    const { studio } = ctx(req);
    const target = planById(knownPlan(req.body?.planId));
    const subscription = requireSubscription(studio.id);
    const current = planById(studio.plan_id);
    const pending = loadBilling(db, studio.id).pending_plan_id;
    if (target.id === current.id && !pending) throw badRequest('To już Twój plan.');
    const immediate = target.id === current.id || target.priceGrosze > current.priceGrosze;
    await changeSubscriptionPlan(deps, subscription, priceForPlan(deps, target.id), target.id !== current.id && immediate);
    tx(db, () => {
      if (immediate) db.prepare('UPDATE studios SET plan_id = ? WHERE id = ?').run(target.id, studio.id);
      db.prepare('UPDATE studio_billing SET pending_plan_id = ?, updated_at = ? WHERE studio_id = ?').run(immediate ? null : target.id, nowIso(), studio.id);
    });
    return { effective: immediate ? 'now' : 'next_period' };
  });

  for (const [path, cancel] of [['/api/owner/billing/cancel', true], ['/api/owner/billing/resume', false]] as const) {
    app.post(path, owner, async (req) => {
      requireConfigured();
      const { studio } = ctx(req);
      await setCancelAtPeriodEnd(deps, requireSubscription(studio.id), cancel);
      db.prepare('UPDATE studio_billing SET cancel_at_period_end = ?, updated_at = ? WHERE studio_id = ?').run(cancel ? 1 : 0, nowIso(), studio.id);
      return { ok: true };
    });
  }
}
