import { buildApp } from './app';
import { env } from './env';
import { TIME_SCALE } from './config/gamedata';
import { prisma } from './lib/db';
import { redis } from './lib/redis';
import { pendingMigrationAdvice, schemaStatus } from './lib/schema';

async function main() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await prisma.$disconnect();
      redis.disconnect();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(
    { timeScale: TIME_SCALE, hayOnChain: env.HAY_ONCHAIN_ENABLED },
    'sunmil-api ready',
  );

  /**
   * Say it here rather than letting a player find it.
   *
   * A database behind the code breaks every login and every write while the
   * pages a visitor loads first — /api/config, /api/invite — keep answering
   * 200, so the site looks alive and is not. This is the one place an operator
   * is already looking after a deploy. It does not stop the server: staying up
   * is what lets /api/health?deep=1 report the reason, and deploy.sh fails on
   * that. Backgrounded so a slow database cannot delay listening.
   */
  void schemaStatus()
    .then((status) => {
      if (!status.ok) app.log.error({ pending: status.pending }, pendingMigrationAdvice(status.pending));
      else if (status.unknown) app.log.warn({ reason: status.unknown }, 'could not verify the database schema');
    })
    .catch((err) => app.log.warn({ err }, 'could not verify the database schema'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('failed to start sunmil-api', err);
  process.exit(1);
});
