import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client';
import { billingEvents, organizations } from '../../db/schema';
import type { BillingEvent, ProviderName } from './providers';

type OrgRow = typeof organizations.$inferSelect;

/**
 * Applies a verified provider event to the workspace. Idempotent: each provider
 * event id is recorded once in billing_events and replays are ignored.
 */
export async function applyBillingEvent(
  db: DB,
  provider: ProviderName,
  event: BillingEvent,
  /** Stops a subscription that a newer one has replaced, so nobody pays for both. */
  cancelReplaced?: (subscriptionId: string) => Promise<void>,
): Promise<'applied' | 'duplicate' | 'ignored' | 'unmatched'> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(billingEvents)
      .values({ id: `${provider}:${event.id}`, provider, type: event.type, payload: event as unknown as Record<string, unknown> })
      .onConflictDoNothing()
      .returning({ id: billingEvents.id });
    if (inserted.length === 0) return 'duplicate';
    if (event.ignored) return 'ignored';

    // A subscription already replaced by a newer one has no say any more.
    if (event.subscriptionId) {
      const [replaced] = await tx.select({ id: billingEvents.id }).from(billingEvents).where(eq(billingEvents.id, `${provider}:replaced:${event.subscriptionId}`)).limit(1);
      if (replaced) return 'ignored';
    }

    let org: OrgRow | undefined;
    if (event.orgId) [org] = await tx.select().from(organizations).where(eq(organizations.id, event.orgId)).limit(1);
    if (!org && event.subscriptionId) {
      [org] = await tx.select().from(organizations).where(eq(organizations.billingSubscriptionId, event.subscriptionId)).limit(1);
    }
    if (!org && event.customerId) {
      [org] = await tx.select().from(organizations).where(eq(organizations.billingCustomerId, event.customerId)).limit(1);
    }
    if (!org) return 'unmatched';

    const current = org.billingProvider === provider ? org.billingSubscriptionId : null;
    if (current && event.subscriptionId && current !== event.subscriptionId) {
      // Only a successful payment can move a workspace to a different subscription.
      if (event.status !== 'active') return 'ignored';
      // Inside the transaction: if this fails, nothing is recorded and the provider redelivers the event.
      await cancelReplaced?.(current);
      await tx.insert(billingEvents).values({ id: `${provider}:replaced:${current}`, provider, type: 'subscription.replaced', payload: { by: event.subscriptionId } }).onConflictDoNothing();
    }

    const patch: Partial<OrgRow> = { billingProvider: provider, updatedAt: new Date() };
    if (event.customerId) patch.billingCustomerId = event.customerId;
    if (event.subscriptionId) patch.billingSubscriptionId = event.subscriptionId;
    if (event.plan) patch.plan = event.plan;
    if (event.interval) patch.planInterval = event.interval;
    if (event.status) patch.planStatus = event.status;
    if (event.currentPeriodEnd) patch.currentPeriodEnd = event.currentPeriodEnd;
    if (event.status === 'active') patch.trialEndsAt = null;
    await tx.update(organizations).set(patch).where(eq(organizations.id, org.id));
    return 'applied';
  });
}
