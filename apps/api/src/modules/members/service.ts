import { ProjectRoles, type ProjectRole } from '@brickledger/shared';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../../db/client';
import { invitations, orgMembers, projectMembers, users } from '../../db/schema';
import { sha256 } from '../../lib/crypto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { logActivity } from '../activity';

export const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, contributor: 2, manager: 3 };

export async function findInvitation(db: DB, token: string) {
  const [inv] = await db.select().from(invitations).where(eq(invitations.tokenHash, sha256(token))).limit(1);
  return inv ?? null;
}

/**
 * Accepts an invitation for the signed-in user. The link itself is the credential
 * (single use, 7-day expiry), so it can be shared over WhatsApp/SMS as well as email.
 */
export async function acceptInvitation(db: DB, token: string, userId: string) {
  const inv = await findInvitation(db, token);
  if (!inv) throw notFound('Invitation');
  if (inv.acceptedAt) throw conflict('This invitation has already been used.');
  if (inv.expiresAt.getTime() < Date.now()) throw badRequest('This invitation has expired. Ask the project manager for a new one.');

  await db.transaction(async (tx) => {
    await tx.insert(orgMembers).values({ orgId: inv.orgId, userId, role: 'member' }).onConflictDoNothing();
    if (inv.projectId) {
      const [existing] = await tx
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, inv.projectId), eq(projectMembers.userId, userId)));
      const role = inv.role as ProjectRole;
      if (!existing) {
        await tx.insert(projectMembers).values({ projectId: inv.projectId, userId, role, addedBy: inv.invitedBy });
      } else if (ROLE_RANK[role] > ROLE_RANK[existing.role as ProjectRole]) {
        await tx
          .update(projectMembers)
          .set({ role })
          .where(and(eq(projectMembers.projectId, inv.projectId), eq(projectMembers.userId, userId)));
      }
    }
    await tx.update(invitations).set({ acceptedAt: new Date(), acceptedBy: userId }).where(eq(invitations.id, inv.id));
    if (inv.projectId) {
      const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
      await logActivity(tx, {
        projectId: inv.projectId,
        userId,
        action: 'create',
        entityType: 'members',
        entityId: userId,
        summary: `${u?.name ?? 'Someone'} joined the project as ${ProjectRoles.label(inv.role)}`,
      });
    }
  });
  return { orgId: inv.orgId, projectId: inv.projectId };
}
