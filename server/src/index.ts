import { buildApp } from './app';
import { env } from './env';
import { TIME_SCALE } from './config/gamedata';
import { prisma } from './lib/db';
import { redis } from './lib/redis';

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
    'sunmill-api ready',
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('failed to start sunmill-api', err);
  process.exit(1);
});
