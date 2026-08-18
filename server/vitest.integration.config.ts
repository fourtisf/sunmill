import { defineConfig } from 'vitest/config';

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
    env: { NODE_ENV: 'test', INVITE_CODE: '' },
  },
});
