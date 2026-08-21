import { PrismaClient } from '@prisma/client';
import { env } from '../env';
import { GameError } from './errors';

export const prisma = new PrismaClient({
  log: env.isProd ? ['warn', 'error'] : ['warn', 'error'],
});

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Turn a Prisma failure into something the player and the operator can both
 * act on.
 *
 * Left alone these arrive at the error handler as anonymous 500s — which is
 * how "the database is unreachable" and "the schema is behind the code" both
 * reached players as `Something went wrong` on the one button the landing page
 * has. Neither is the player's fault and neither is permanent, so both are a
 * 503 with a name: the client can then say something true and offer a retry,
 * and the log line carries the Prisma code for whoever is on call.
 *
 * Recognised by shape rather than `instanceof`: every Prisma error class
 * carries a P-code and a clientVersion, and duck-typing survives a second copy
 * of @prisma/client in the tree, which instanceof does not.
 */
const DB_UNREACHABLE = new Set([
  'P1000', // authentication failed
  'P1001', // cannot reach the database server
  'P1002', // the database server timed out
  'P1003', // the database does not exist
  'P1008', // operation timed out
  'P1010', // access denied
  'P1011', // TLS error
  'P1017', // the server closed the connection
  'P2024', // timed out fetching a connection from the pool
]);

/** The database is up but is not the shape this build was compiled against. */
const DB_SCHEMA_STALE = new Set([
  'P2021', // the table does not exist
  'P2022', // the column does not exist
]);

export function prismaCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const { code, clientVersion } = err as { code?: unknown; clientVersion?: unknown };
  if (typeof clientVersion !== 'string') return null;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null;
}

/**
 * Why the client could not start talking to the database at all.
 *
 * Prisma throws PrismaClientInitializationError for every one of these, and on
 * 5.22 that object carries neither `code` nor `errorCode` — both are declared
 * and left undefined, so a P-code lookup finds nothing and the failure reaches
 * the error handler as an anonymous 500. Which is the whole bug: the mapping
 * below was written for exactly this case and could never see it, so a
 * database the API cannot connect to still answered `Something went wrong` on
 * the one button the landing page has.
 *
 * The reason is only in the message, so it is classified here, once, and what
 * leaves this module is a short token. The messages name hosts, ports, role
 * names and database names, and /api/health is unauthenticated.
 */
export type DbFault = 'unreachable' | 'auth_failed' | 'no_such_database' | 'tls' | 'unknown';

/** Prisma's class for "could not open a connection", whatever the reason. */
function isInitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, clientVersion } = err as { name?: unknown; clientVersion?: unknown };
  return name === 'PrismaClientInitializationError' && typeof clientVersion === 'string';
}

export function dbFault(err: unknown): DbFault | null {
  if (!isInitError(err)) return null;
  const message = String((err as Error).message ?? '');
  if (/does not exist on the database server/i.test(message)) return 'no_such_database';
  if (/authentication failed/i.test(message)) return 'auth_failed';
  if (/can't reach database server|connection (refused|timed out)|timed out/i.test(message)) return 'unreachable';
  if (/\btls\b|\bssl\b/i.test(message)) return 'tls';
  return 'unknown';
}

/** A GameError for a database failure, or null if this is not one. */
export function databaseError(err: unknown): GameError | null {
  // Every initialisation failure is the same answer to a player — the server
  // cannot reach its database, it is nobody's fault here, and it is not
  // permanent — so they share one branch and differ only in what the operator
  // reads.
  const fault = dbFault(err);
  if (fault) {
    return new GameError(
      'db_unavailable',
      'The farm server cannot reach its database',
      503,
      { prisma: fault },
    );
  }

  const code = prismaCode(err);
  if (!code) return null;
  if (DB_UNREACHABLE.has(code)) {
    return new GameError(
      'db_unavailable',
      'The farm server cannot reach its database',
      503,
      { prisma: code },
    );
  }
  if (DB_SCHEMA_STALE.has(code)) {
    return new GameError(
      'db_schema',
      'The farm server is running ahead of its database',
      503,
      { prisma: code },
    );
  }
  return null;
}
