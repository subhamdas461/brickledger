import { randomUUID } from 'node:crypto';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  type AuthResponse,
} from '@brickledger/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Executor } from '../../db/client';
import { passwordResets, sessions, users } from '../../db/schema';
import { getDummyHash, hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { badRequest, conflict, unauthorized } from '../../lib/errors';
import { emails } from '../../lib/mailer';
import { parse } from '../../lib/validate';
import { buildMe, createWorkspace } from '../account/service';
import { acceptInvitation } from '../members/service';

export const REFRESH_COOKIE = 'bl_rt';
const COOKIE_PATH = '/api/v1/auth';
/** A rotated refresh token may be replayed within this window (parallel tabs/requests) without tripping reuse detection. */
const ROTATION_GRACE_MS = 30_000;

export async function issueSession(
  app: FastifyInstance,
  db: Executor,
  userId: string,
  req: FastifyRequest,
  familyId: string = randomUUID(),
) {
  const { config, tokens } = app.ctx;
  const refreshToken = randomToken(32);
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(refreshToken),
      familyId,
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      ip: req.ip,
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    })
    .returning({ id: sessions.id });
  return {
    sessionId: session!.id,
    refreshToken,
    accessToken: await tokens.signAccess(userId),
    expiresIn: tokens.accessTtlSeconds,
  };
}

function setRefreshCookie(app: FastifyInstance, reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: app.ctx.config.NODE_ENV === 'production',
    path: COOKIE_PATH,
    maxAge: app.ctx.config.REFRESH_TOKEN_TTL_DAYS * 86_400,
  });
}

async function authResponse(app: FastifyInstance, userId: string, tokens: { accessToken: string; refreshToken: string; expiresIn: number }): Promise<AuthResponse> {
  const me = await buildMe(app.ctx.db, userId);
  if (!me) throw unauthorized();
  return { ...me, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn };
}

export async function authRoutes(app: FastifyInstance) {
  const { db, config, mailer } = app.ctx;
  // Credential endpoints are strict (brute-force protection); token refresh happens on every page load and is looser.
  const limited = { config: { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } } };
  const refreshLimited = { config: { rateLimit: { max: Math.max(120, config.AUTH_RATE_LIMIT_PER_MIN), timeWindow: '1 minute' } } };

  app.post('/register', limited, async (req, reply) => {
    const input = parse(registerSchema, req.body);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) throw conflict('An account with this email already exists. Try signing in.');

    const passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning();
      await createWorkspace(tx, {
        ownerId: u!.id,
        ownerName: u!.name,
        name: input.company,
        currency: config.PRICING_CURRENCY === 'INR' ? 'INR' : 'USD',
      });
      return u!;
    });

    if (input.inviteToken) {
      try {
        await acceptInvitation(db, input.inviteToken, user.id);
      } catch (err) {
        req.log.warn({ err }, 'invite acceptance during registration failed');
      }
    }

    const tokens = await issueSession(app, db, user.id, req);
    setRefreshCookie(app, reply, tokens.refreshToken);
    reply.code(201);
    return authResponse(app, user.id, tokens);
  });

  app.post('/login', limited, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !ok) throw unauthorized('Incorrect email or password.');
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const tokens = await issueSession(app, db, user.id, req);
    setRefreshCookie(app, reply, tokens.refreshToken);
    return authResponse(app, user.id, tokens);
  });

  app.post('/refresh', refreshLimited, async (req, reply) => {
    const input = parse(refreshSchema, req.body ?? {});
    const token = input.refreshToken ?? req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized('Session expired. Please sign in again.');

    const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token))).limit(1);
    if (!session || session.expiresAt.getTime() < Date.now()) throw unauthorized('Session expired. Please sign in again.');

    if (session.revokedAt) {
      const withinGrace = session.replacedById && Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!withinGrace) {
        // Refresh-token reuse: someone replayed an old token. Kill the whole family.
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.familyId, session.familyId), isNull(sessions.revokedAt)));
        reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
        throw unauthorized('Session expired. Please sign in again.');
      }
    }

    const tokens = await db.transaction(async (tx) => {
      const next = await issueSession(app, tx, session.userId, req, session.familyId);
      if (!session.revokedAt) {
        await tx
          .update(sessions)
          .set({ revokedAt: new Date(), replacedById: next.sessionId, lastUsedAt: new Date() })
          .where(eq(sessions.id, session.id));
      }
      return next;
    });
    setRefreshCookie(app, reply, tokens.refreshToken);
    return authResponse(app, session.userId, tokens);
  });

  app.post('/logout', async (req, reply) => {
    const input = parse(refreshSchema, req.body ?? {});
    const token = input.refreshToken ?? req.cookies[REFRESH_COOKIE];
    if (token) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
    }
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    return { ok: true };
  });

  app.post('/forgot-password', limited, async (req) => {
    const input = parse(forgotPasswordSchema, req.body);
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (user) {
      const token = randomToken(32);
      await db.insert(passwordResets).values({
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 3600_000),
      });
      const url = `${config.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await mailer.send({ to: user.email, ...emails.resetPassword(user.name, url) }).catch((err) => req.log.error({ err }, 'reset email failed'));
    }
    // Same response either way - don't reveal which emails have accounts.
    return { ok: true };
  });

  app.post('/reset-password', limited, async (req) => {
    const input = parse(resetPasswordSchema, req.body);
    const [reset] = await db.select().from(passwordResets).where(eq(passwordResets.tokenHash, sha256(input.token))).limit(1);
    if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) {
      throw badRequest('This reset link is invalid or has expired. Request a new one.');
    }
    const passwordHash = await hashPassword(input.password);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, reset.userId));
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, reset.userId), isNull(sessions.revokedAt)));
    });
    return { ok: true };
  });
}
