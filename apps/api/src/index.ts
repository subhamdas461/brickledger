import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = await createApp(config);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(`BrickLedger API ready on http://localhost:${config.PORT} (db: ${app.ctx.database.driver}, billing: ${app.ctx.billing.name})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
