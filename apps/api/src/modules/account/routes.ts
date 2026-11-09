import { changePasswordSchema, updateProfileSchema } from '@brickledger/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sessions, users } from '../../db/schema';
import { hashPassword, verifyPassword } from '../../lib/crypto';
import { badRequest, notFound, unauthorized } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { REFRESH_COOKIE, issueSession } from '../auth/routes';
import { buildMe, deleteUserAccount } from './service';

export async function accountRoutes(app: FastifyInstance) {
  const { db, storage } = app.ctx;

  app.get('/me', async (req) => {
    const me = await buildMe(db, req.userId);
    if (!me) throw unauthorized();
    return me;
  });

  app.patch('/me', async (req) => {
    const input = parse(updateProfileSchema, req.body);
    await db
      .update(users)
      .set({ ...(input.name !== undefined && { name: input.name }), ...(input.phone !== undefined && { phone: input.phone }), updatedAt: new Date() })
      .where(eq(users.id, req.userId));
    return buildMe(db, req.userId);
  });

  /** Changing the password signs out every other device and returns fresh tokens for this one. */
  app.post('/me/password', async (req, reply) => {
    const input = parse(changePasswordSchema, req.body);
    const [user] = await db.select().from(users).where(eq(users.id, req.userId)).limit(1);
    if (!user) throw notFound('User');
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect.');
    const passwordHash = await hashPassword(input.newPassword);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
    });
    const tokens = await issueSession(app, db, user.id, req);
    reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.ctx.config.NODE_ENV === 'production',
      path: '/api/v1/auth',
      maxAge: app.ctx.config.REFRESH_TOKEN_TTL_DAYS * 86_400,
    });
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn };
  });

  /**
   * Permanently deletes the account (required by app-store policies). Workspaces the
   * user owns are deleted with all their projects and files.
   */
  app.delete('/me', async (req, reply) => {
    const input = parse(z.object({ password: z.string().min(1) }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, req.userId)).limit(1);
    if (!user) throw notFound('User');
    if (!(await verifyPassword(input.password, user.passwordHash))) throw badRequest('Password is incorrect.');

    await deleteUserAccount(db, storage, user.id);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return { ok: true };
  });
}
