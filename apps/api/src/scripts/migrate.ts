import { loadConfig } from '../config';
import { createDatabase } from '../db/client';

const config = loadConfig();
const database = await createDatabase({ url: config.DATABASE_URL || undefined, pgliteDir: config.PGLITE_DIR });
await database.migrate();
console.log(`Migrations applied (${database.driver}).`);
await database.close();
