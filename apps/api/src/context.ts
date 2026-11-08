import type { Config } from './config';
import type { DB, Database } from './db/client';
import type { TokenService } from './lib/crypto';
import type { Mailer } from './lib/mailer';
import type { Storage } from './lib/storage';
import type { BillingProvider } from './modules/billing/providers';

export interface AppContext {
  config: Config;
  database: Database;
  db: DB;
  tokens: TokenService;
  storage: Storage;
  mailer: Mailer;
  billing: BillingProvider;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}
