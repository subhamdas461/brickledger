/**
 * Manages super admins from the command line. This is deliberately the only way to become one:
 * nothing on the website can grant it, and sign-ups don't verify email ownership, so an "admin email"
 * setting could be claimed by whoever registers that address first.
 *
 *   npm run admin -- grant you@example.com     make an existing account a super admin
 *   npm run admin -- revoke you@example.com    remove the rights
 *   npm run admin -- list                      show all super admins
 *   npm run admin -- reset-link you@example.com   print a one-hour link to set a new password
 *
 * Uses DATABASE_URL from the environment, otherwise from .env.vercel at the repo root.
 */
import { asc, eq } from 'drizzle-orm';
import { loadConfig } from '../config';
import { createDatabase } from '../db/client';
import { passwordResets, users } from '../db/schema';
import { randomToken, sha256 } from '../lib/crypto';

const [command, rawEmail] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();

function usage(): never {
  console.error('Usage:\n  npm run admin -- grant you@example.com\n  npm run admin -- revoke you@example.com\n  npm run admin -- list\n  npm run admin -- reset-link you@example.com');
  process.exit(1);
}
if (command !== 'list' && !((command === 'grant' || command === 'revoke' || command === 'reset-link') && email)) usage();

if (!process.env.DATABASE_URL) {
  delete process.env.DATABASE_URL; // an empty value would stop the file below from setting it
  try {
    process.loadEnvFile(new URL('../../../../.env.vercel', import.meta.url));
  } catch {
    /* no file: the local development database is used */
  }
}
if (process.env.DATABASE_URL?.includes('ep-XXXX')) {
  console.error('.env.vercel still has the placeholder DATABASE_URL. Paste your Neon connection string there first.');
  process.exit(1);
}

const config = loadConfig({ NODE_ENV: 'development' });
const database = await createDatabase({ url: config.DATABASE_URL || undefined, pgliteDir: config.PGLITE_DIR, poolMax: 1 });
const target = config.DATABASE_URL ? new URL(config.DATABASE_URL).hostname : `the LOCAL development database (${config.PGLITE_DIR}), not your live site`;
console.log(`Database: ${target}`);

let exitCode = 0;
try {
  await database.migrate(); // adds the admin columns if this runs before the first deploy with them
  const { db } = database;
  if (command === 'list') {
    const admins = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.isSuperAdmin, true)).orderBy(asc(users.email));
    console.log(admins.length ? admins.map((a) => `  ${a.email} (${a.name})`).join('\n') : '  No super admins yet.');
  } else if (command === 'reset-link') {
    // For when you can't sign in to the panel, whose "Reset link" button does the same.
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email!)).limit(1);
    if (!user) {
      console.error(`No account with the email ${email}.`);
      exitCode = 1;
    } else {
      const token = randomToken(32);
      await db.insert(passwordResets).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) });
      console.log(`Open this within an hour to choose a new password. It works once, so keep it private:\n${config.APP_URL}/reset-password?token=${encodeURIComponent(token)}`);
    }
  } else {
    const grant = command === 'grant';
    const [updated] = await db.update(users).set({ isSuperAdmin: grant, updatedAt: new Date() }).where(eq(users.email, email!)).returning({ email: users.email, bannedAt: users.bannedAt });
    if (!updated) {
      console.error(`No account with the email ${email}. Sign up on the site first, then run this again.`);
      exitCode = 1;
    } else {
      console.log(grant ? `${updated.email} is now a super admin. Sign in and open /admin.` : `${updated.email} is no longer a super admin.`);
      if (grant && updated.bannedAt) console.warn('Note: this account is banned, so it can’t sign in until unbanned.');
    }
  }
} finally {
  await database.close();
}
process.exit(exitCode);
