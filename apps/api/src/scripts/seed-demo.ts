/**
 * Creates (or refreshes) a demo login with a fully populated sample project:
 *   email: demo@brickledger.app   password: demo12345
 * Usage: npm run seed:demo
 */
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config';
import { createDatabase } from '../db/client';
import { orgMembers, users } from '../db/schema';
import { hashPassword } from '../lib/crypto';
import { createWorkspace } from '../modules/account/service';
import { createDemoProject } from '../modules/projects/demo';

const EMAIL = process.env.DEMO_EMAIL ?? 'demo@brickledger.app';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo12345';

const config = loadConfig();
const database = await createDatabase({ url: config.DATABASE_URL || undefined, pgliteDir: config.PGLITE_DIR });
await database.migrate();
const db = database.db;

let [user] = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);
if (!user) {
  [user] = await db.insert(users).values({ email: EMAIL, name: 'Demo Owner', passwordHash: await hashPassword(PASSWORD) }).returning();
  await createWorkspace(db, { ownerId: user!.id, ownerName: 'Demo Owner', name: 'Demo Homes', currency: config.PRICING_CURRENCY === 'INR' ? 'INR' : 'USD' });
}
const [membership] = await db.select().from(orgMembers).where(eq(orgMembers.userId, user!.id)).limit(1);
const projectId = await createDemoProject(db, { orgId: membership!.orgId, userId: user!.id, currency: config.PRICING_CURRENCY === 'INR' ? 'INR' : 'USD' });
console.log(`Demo ready -> ${EMAIL} / ${PASSWORD} (project ${projectId})`);
await database.close();
