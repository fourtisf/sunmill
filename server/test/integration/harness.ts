import { it } from 'vitest';

/**
 * A test that needs the database, and says so when it does not get one.
 *
 * These suites are meant to stay green on a machine with no infrastructure, so
 * each file probes the database in beforeAll and every test consults the
 * result. That much is right. What was wrong was the consulting: ten copies of
 * the same helper each wrote `if (!reachable) return`, and a test body that
 * returns is a test that PASSED. Point DATABASE_URL at a closed port and the
 * social suite reported 11 passing in 190ms, having connected to nothing.
 *
 * That is the worst possible way to be green — it is indistinguishable from
 * the real thing in every summary line, and it is exactly the failure this
 * project has already shipped once: a check that could only ever say yes.
 *
 * ctx.skip() marks the test skipped instead, so the run reports what actually
 * happened. It has to be the runtime context rather than it.skipIf, because
 * skipIf is evaluated at collection time — before beforeAll has had a chance
 * to find out whether the database is there.
 */
export function dbTest(isReachable: () => boolean, timeout = 30_000) {
  return (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
      if (!isReachable()) ctx.skip();
      await fn();
    }, timeout);
}
