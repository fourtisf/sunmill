/**
 * A database failure must not reach a player as an anonymous 500.
 *
 * These are the two shapes that took the live site down without saying so:
 * an unreachable database, and a database whose migrations never ran. Both
 * arrived at the error handler as unknown errors, so the only button on the
 * landing page answered "Something went wrong" — which is indistinguishable
 * from a bug in the game and told nobody where to look.
 */
import { describe, expect, it } from 'vitest';
import { databaseError } from '../src/lib/db';

/** What Prisma actually throws: a P-code plus the client version. */
const prismaError = (code: string) =>
  Object.assign(new Error(`prisma failed: ${code}`), { code, clientVersion: '5.22.0' });

describe('databaseError', () => {
  it('names an unreachable database, retryably', () => {
    for (const code of ['P1001', 'P1002', 'P1017', 'P2024']) {
      const err = databaseError(prismaError(code));
      expect(err, code).not.toBeNull();
      expect(err!.code).toBe('db_unavailable');
      // 503, not 500: nothing is broken, something is down, and a client that
      // knows the difference can offer to try again.
      expect(err!.statusCode).toBe(503);
      expect(err!.details).toEqual({ prisma: code });
    }
  });

  it('names a database that is behind the code', () => {
    // P2022 is the exact error a missing migration produces on the login
    // route — the column the new build writes does not exist yet.
    for (const code of ['P2021', 'P2022']) {
      const err = databaseError(prismaError(code));
      expect(err, code).not.toBeNull();
      expect(err!.code).toBe('db_schema');
      expect(err!.statusCode).toBe(503);
    }
  });

  it('leaves everything else to the generic handler', () => {
    // A genuine bug must keep looking like one rather than being dressed up
    // as an outage that will clear on its own.
    expect(databaseError(new Error('boom'))).toBeNull();
    expect(databaseError(prismaError('P2002'))).toBeNull();   // unique constraint
    expect(databaseError(null)).toBeNull();
    expect(databaseError(undefined)).toBeNull();
    expect(databaseError('P1001')).toBeNull();
  });

  it('ignores a P-code on something that is not a Prisma error', () => {
    expect(databaseError(Object.assign(new Error('nope'), { code: 'P1001' }))).toBeNull();
  });
});
