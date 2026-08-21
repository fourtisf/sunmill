import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

/**
 * Each file in this suite skips itself when DATABASE_URL is unset — right for
 * CI, wrong on a machine that has the database, because vitest does not read
 * the repo's .env and the server does. The suite then reported 112 passing
 * having run none of them, which is the worst possible way to be green: it is
 * the login path these tests cover, and a login that 500s is what this project
 * has already shipped once. Load the same file the API loads, so "has a
 * database" means the same thing to the tests as it does to the server.
 */
loadEnv({ path: path.resolve(__dirname, '../.env') });

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    // These share one database, so they must not run concurrently.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Silences the API's request logger — see buildApp().
    // INVITE_CODE is cleared so the suite exercises the game rather than the
    // beta gate; invite.test.ts sets its own code before importing the app.
    // WALLET_LOGIN is forced on because the suite covers the signature flow;
    // the deployed default is off, and guest.test.ts covers that side.
    env: {
      NODE_ENV: 'test',
      INVITE_CODE: '',
      WALLET_LOGIN: 'true',
      // '' when there is genuinely no database, which still skips.
      DATABASE_URL: process.env.DATABASE_URL ?? '',
    },
  },
});
