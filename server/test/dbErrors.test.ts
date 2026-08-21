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
import { dbFault, databaseError, prismaCode } from '../src/lib/db';

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

describe('prismaCode', () => {
  it('reads the P-code off a Prisma error', () => {
    expect(prismaCode(prismaError('P1000'))).toBe('P1000');
    expect(prismaCode(prismaError('P2021'))).toBe('P2021');
  });

  it('refuses anything that is not one', () => {
    // No clientVersion: some other library's `code`, not Prisma's.
    expect(prismaCode(Object.assign(new Error('nope'), { code: 'ECONNREFUSED' }))).toBeNull();
    expect(prismaCode(Object.assign(new Error('nope'), { code: 'P1', clientVersion: '5.22.0' }))).toBeNull();
    expect(prismaCode(new Error('plain'))).toBeNull();
    expect(prismaCode(null)).toBeNull();
  });
});

/**
 * What Prisma actually throws when it cannot open a connection — verbatim from
 * a live 5.22 client against a wrong port and a missing database. The point of
 * these being real strings: the class carries no `code` and no `errorCode` on
 * this version, so the message is the only thing left to read, and a message
 * that changes shape must fail here rather than in production.
 */
const initError = (message: string) =>
  Object.assign(new Error(message), {
    name: 'PrismaClientInitializationError',
    clientVersion: '5.22.0',
  });

const UNREACHABLE = "Invalid `prisma.$queryRaw()` invocation:\n\n\nCan't reach database server at "
  + '`127.0.0.1:5999`\n\nPlease make sure your database server is running at `127.0.0.1:5999`.';
const NO_DATABASE = 'Invalid `prisma.$queryRaw()` invocation:\n\n\nDatabase `sunmil` does not exist'
  + ' on the database server at `127.0.0.1:5433`.';
const AUTH_FAILED = 'Authentication failed against database server at `127.0.0.1`, the provided'
  + ' database credentials for `sunmil` are not valid.';

describe('a database the client cannot connect to', () => {
  it('is not reachable through the P-code at all', () => {
    // The bug this exists to stop coming back: PrismaClientInitializationError
    // declares `code` and `errorCode` and leaves both undefined, so the P-code
    // mapping could never classify the one failure it was written for, and a
    // dead database answered `Something went wrong` on the landing page.
    expect(prismaCode(initError(UNREACHABLE))).toBeNull();
    expect(prismaCode(initError(NO_DATABASE))).toBeNull();
  });

  it('is classified from the message instead', () => {
    expect(dbFault(initError(UNREACHABLE))).toBe('unreachable');
    expect(dbFault(initError(NO_DATABASE))).toBe('no_such_database');
    expect(dbFault(initError(AUTH_FAILED))).toBe('auth_failed');
    // Recognised as a connection failure even when the wording is new.
    expect(dbFault(initError('something nobody has seen before'))).toBe('unknown');
  });

  it('is not claimed by anything that is not one', () => {
    expect(dbFault(prismaError('P2021'))).toBeNull();
    expect(dbFault(new Error('plain'))).toBeNull();
    expect(dbFault(null)).toBeNull();
    // Right name, no clientVersion: someone else's error class, not Prisma's.
    expect(dbFault(Object.assign(new Error('x'), { name: 'PrismaClientInitializationError' }))).toBeNull();
  });

  it('reaches the player as a named, retryable 503', () => {
    for (const message of [UNREACHABLE, NO_DATABASE, AUTH_FAILED]) {
      const err = databaseError(initError(message));
      expect(err, message).not.toBeNull();
      expect(err!.code).toBe('db_unavailable');
      expect(err!.statusCode).toBe(503);
    }
  });

  it('tells the operator which of the three it is', () => {
    expect(databaseError(initError(AUTH_FAILED))!.details).toEqual({ prisma: 'auth_failed' });
    // And says nothing about the role, host or database it named.
    const body = JSON.stringify(databaseError(initError(AUTH_FAILED))!.details);
    expect(body).not.toContain('127.0.0.1');
    expect(body).not.toContain('sunmil');
  });
});
