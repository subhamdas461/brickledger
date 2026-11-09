import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client';
import { users } from '../../db/schema';

/** How long a "this account is fine" answer is reused by a server instance. */
const TTL_MS = 30_000;

export interface AccountGate {
  isActive(userId: string): Promise<boolean>;
  forget(userId: string): void;
}

/**
 * Access tokens stay valid for 15 minutes on their own, so banning needs a check on each request. A
 * short cache keeps that to one small query per user every 30 seconds: a ban or deletion reaches
 * every server instance within that time, and the instance handling the action at once.
 */
export function createAccountGate(db: DB): AccountGate {
  const okUntil = new Map<string, number>();
  return {
    async isActive(userId) {
      if ((okUntil.get(userId) ?? 0) > Date.now()) return true;
      const [row] = await db.select({ bannedAt: users.bannedAt }).from(users).where(eq(users.id, userId)).limit(1);
      const active = Boolean(row) && !row!.bannedAt;
      if (active) {
        if (okUntil.size > 10_000) okUntil.clear();
        okUntil.set(userId, Date.now() + TTL_MS);
      }
      return active;
    },
    forget(userId) {
      okUntil.delete(userId);
    },
  };
}
