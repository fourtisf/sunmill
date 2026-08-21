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

function prismaCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const { code, clientVersion } = err as { code?: unknown; clientVersion?: unknown };
  if (typeof clientVersion !== 'string') return null;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null;
}

/** A GameError for a database failure, or null if this is not one. */
export function databaseError(err: unknown): GameError | null {
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
