import { ProjectRoles, inviteSchema, updateMemberSchema, type InvitePreview, type PendingInvite, type ProjectMember, type ProjectRole } from '@brickledger/shared';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { invitations, orgMembers, organizations, projectMembers, projects, users } from '../../db/schema';
import { randomToken, sha256 } from '../../lib/crypto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { emails } from '../../lib/mailer';
import { isUuid } from '../../lib/util';
import { parse } from '../../lib/validate';
import { logActivity } from '../activity';
import { assertCanAddMember } from '../billing/limits';
import { projectAccess, requireRole } from '../projects/access';
import { acceptInvitation, findInvitation } from './service';

const INVITE_TTL_DAYS = 7;

export async function memberRoutes(app: FastifyInstance) {
  const { db, config, mailer } = app.ctx;

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/members', async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    const direct = await db
      .select({ userId: users.id, name: users.name, email: users.email, role: projectMembers.role, joinedAt: projectMembers.createdAt })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, access.project.id));
    const admins = await db
      .select({ userId: users.id, name: users.name, email: users.email, joinedAt: orgMembers.createdAt })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(and(eq(orgMembers.orgId, access.org.id), inArray(orgMembers.role, ['owner', 'admin'])));

    const byId = new Map<string, ProjectMember>();
    for (const a of admins) {
      byId.set(a.userId, { userId: a.userId, name: a.name, email: a.email, role: 'manager', viaWorkspace: true, joinedAt: a.joinedAt.toISOString() });
    }
    for (const d of direct) {
      if (!byId.has(d.userId)) {
        byId.set(d.userId, { userId: d.userId, name: d.name, email: d.email, role: d.role as ProjectRole, viaWorkspace: false, joinedAt: d.joinedAt.toISOString() });
      }
    }
    const rank: Record<string, number> = { manager: 0, contributor: 1, viewer: 2 };
    const members = [...byId.values()].sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.name.localeCompare(b.name));

    let invites: PendingInvite[] = [];
    if (access.role === 'manager') {
      const rows = await db
        .select()
        .from(invitations)
        .where(and(eq(invitations.projectId, access.project.id), isNull(invitations.acceptedAt), gt(invitations.expiresAt, sql`now()`)));
      invites = rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role as ProjectRole,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      }));
    }
    return { members, invites };
  });

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/invites', async (req, reply) => {
    const access = await projectAccess(req, req.params.projectId);
    requireRole(access, 'manager', 'invite people');
    const input = parse(inviteSchema, req.body);

    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existingUser) {
      const [already] = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, access.project.id), eq(projectMembers.userId, existingUser.id)));
      const [orgRole] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, access.org.id), eq(orgMembers.userId, existingUser.id)));
      if (already || orgRole?.role === 'owner' || orgRole?.role === 'admin') throw conflict('This person already has access to the project.');
      if (!orgRole) await assertCanAddMember(db, access.org);
    } else {
      await assertCanAddMember(db, access.org);
    }

    const token = randomToken(24);
    const inviteUrl = `${config.APP_URL}/invite/${token}`;
    const invite = await db.transaction(async (tx) => {
      // Replace any older pending invite for the same person.
      await tx
        .delete(invitations)
        .where(and(eq(invitations.projectId, access.project.id), eq(invitations.email, input.email), isNull(invitations.acceptedAt)));
      const [row] = await tx
        .insert(invitations)
        .values({
          orgId: access.org.id,
          projectId: access.project.id,
          email: input.email,
          role: input.role,
          tokenHash: sha256(token),
          invitedBy: req.userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        })
        .returning();
      await logActivity(tx, {
        projectId: access.project.id,
        userId: req.userId,
        action: 'create',
        entityType: 'members',
        summary: `Invited ${input.email} as ${ProjectRoles.label(input.role)}`,
      });
      return row!;
    });

    const [inviter] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.userId));
    await mailer
      .send({
        to: input.email,
        ...emails.invitation({ inviter: inviter?.name ?? 'A teammate', project: access.project.name, role: ProjectRoles.label(input.role), url: inviteUrl }),
      })
      .catch((err) => req.log.error({ err }, 'invite email failed'));

    reply.code(201);
    // The link is returned so managers can also share it over WhatsApp/SMS.
    return {
      invite: { id: invite.id, email: invite.email, role: invite.role, createdAt: invite.createdAt.toISOString(), expiresAt: invite.expiresAt.toISOString() },
      inviteUrl,
    };
  });

  app.delete<{ Params: { projectId: string; inviteId: string } }>('/projects/:projectId/invites/:inviteId', async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    requireRole(access, 'manager', 'revoke invitations');
    if (!isUuid(req.params.inviteId)) throw notFound('Invitation');
    await db.delete(invitations).where(and(eq(invitations.id, req.params.inviteId), eq(invitations.projectId, access.project.id)));
    return { ok: true };
  });

  app.patch<{ Params: { projectId: string; userId: string } }>('/projects/:projectId/members/:userId', async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    requireRole(access, 'manager', 'change roles');
    const input = parse(updateMemberSchema, req.body);
    if (!isUuid(req.params.userId)) throw notFound('Member');
    const updated = await db
      .update(projectMembers)
      .set({ role: input.role })
      .where(and(eq(projectMembers.projectId, access.project.id), eq(projectMembers.userId, req.params.userId)))
      .returning();
    if (!updated.length) throw notFound('Member');
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.params.userId));
    await logActivity(db, {
      projectId: access.project.id,
      userId: req.userId,
      action: 'update',
      entityType: 'members',
      entityId: req.params.userId,
      summary: `Changed ${u?.name ?? 'member'}'s role to ${ProjectRoles.label(input.role)}`,
    });
    return { ok: true };
  });

  app.delete<{ Params: { projectId: string; userId: string } }>('/projects/:projectId/members/:userId', async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    const self = req.params.userId === req.userId;
    if (!self) requireRole(access, 'manager', 'remove people');
    if (!isUuid(req.params.userId)) throw notFound('Member');
    const [orgRole] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, access.org.id), eq(orgMembers.userId, req.params.userId)));
    if (orgRole?.role === 'owner' || orgRole?.role === 'admin') {
      throw badRequest('Workspace owners and admins have access to every project. Change their workspace role instead.');
    }
    const removed = await db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, access.project.id), eq(projectMembers.userId, req.params.userId)))
      .returning();
    if (!removed.length) throw notFound('Member');
    await logActivity(db, {
      projectId: access.project.id,
      userId: req.userId,
      action: 'delete',
      entityType: 'members',
      entityId: req.params.userId,
      summary: self ? 'Left the project' : 'Removed a member from the project',
    });
    return { ok: true };
  });

  app.post<{ Params: { token: string } }>('/invites/:token/accept', async (req) => {
    const result = await acceptInvitation(db, req.params.token, req.userId);
    return { ok: true, ...result };
  });
}

/** Unauthenticated invitation preview for the accept page. */
export async function invitePublicRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.get<{ Params: { token: string } }>('/invites/:token', async (req): Promise<InvitePreview> => {
    const inv = await findInvitation(db, req.params.token);
    if (!inv) throw notFound('Invitation');
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, inv.orgId));
    const [project] = inv.projectId
      ? await db.select({ name: projects.name }).from(projects).where(eq(projects.id, inv.projectId))
      : [];
    const [inviter] = inv.invitedBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, inv.invitedBy)) : [];
    return {
      email: inv.email,
      role: inv.role as ProjectRole,
      projectName: project?.name ?? null,
      orgName: org?.name ?? '',
      invitedBy: inviter?.name ?? null,
      expired: inv.expiresAt.getTime() < Date.now(),
      accepted: Boolean(inv.acceptedAt),
    };
  });
}
