import { PLANS, PLAN_ORDER, TRIAL_DAYS, type PlansResponse } from '@brickledger/shared';
import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../lib/errors';
import { applyBillingEvent } from './service';

/** Public billing routes: plan catalogue and provider webhooks. */
export async function billingPublicRoutes(app: FastifyInstance) {
  const { config, billing, db } = app.ctx;

  app.get('/billing/plans', async (): Promise<PlansResponse> => ({
    currency: config.PRICING_CURRENCY,
    provider: billing.name,
    trialDays: TRIAL_DAYS,
    plans: PLAN_ORDER.map((id) => PLANS[id]),
  }));

  // Webhooks need the exact raw body for signature verification.
  await app.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    hooks.post<{ Params: { provider: string } }>('/billing/webhooks/:provider', async (req, reply) => {
      if (req.params.provider !== billing.name || billing.name === 'mock') {
        throw badRequest(`Webhooks for "${req.params.provider}" are not enabled on this server.`);
      }
      const raw = typeof req.body === 'string' ? req.body : '';
      const event = billing.parseWebhook(raw, req.headers);
      const outcome = await applyBillingEvent(db, billing.name, event);
      req.log.info({ type: event.type, outcome }, 'billing webhook');
      reply.code(200);
      return { received: true };
    });
  });
}
