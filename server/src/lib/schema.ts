/**
 * Is the database the shape this build expects?
 *
 * `SELECT 1` proves the socket, not the schema. A deploy that ships new code
 * without applying its migrations passes that check while every write path is
 * broken — and the first thing to notice is a player tapping the only button
 * on the landing page and getting a 500 with nothing to act on. That is the
 * worst possible place to learn it, so the check belongs here, at boot and on
 * the health endpoint, where a deploy can be stopped instead.
 *
 * The comparison is the same one `prisma migrate deploy` makes: the migration
 * folders this build carries, against the rows `_prisma_migrations` says have
 * finished. Nothing here reads the migration bodies — only their names — so it
 * stays cheap enough to run on every deep health check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './db';

export interface SchemaStatus {
  /** False only when a migration this build ships has definitely not run. */
  ok: boolean;
  /** Migrations shipped in this build that the database has not finished. */
  pending: string[];
  /** Set when the check could not be made — never treated as a failure. */
  unknown?: string;
}

/** Same relative path from `src/lib` (tsx) and `dist/lib` (node). */
function migrationsDir(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../prisma/migrations'),
    path.resolve(process.cwd(), 'prisma/migrations'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch { /* try the next one */ }
  }
  return null;
}

/** The migration folder names this build ships, in lexical (= apply) order. */
export function shippedMigrations(): string[] | null {
  const dir = migrationsDir();
  if (!dir) return null;
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'migration.sql')))
      .map((e) => e.name)
      .sort();
  } catch {
    return null;
  }
}

/**
 * Which shipped migrations the database has not finished applying.
 *
 * Deliberately one-directional. A database ahead of this build — a rollback,
 * or a second instance mid-deploy — is not this process's problem and must not
 * fail its health check; only a database *behind* the code breaks writes.
 */
export async function schemaStatus(): Promise<SchemaStatus> {
  const shipped = shippedMigrations();
  if (!shipped) return { ok: true, pending: [], unknown: 'no migrations directory in this build' };
  if (!shipped.length) return { ok: true, pending: [] };

  let applied: Set<string>;
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    applied = new Set(rows.map((r) => r.migration_name));
  } catch (err) {
    // No _prisma_migrations table at all means the database has never been
    // migrated — that IS the failure this check exists for, and it is worth
    // naming rather than shrugging at. Postgres calls that 42P01
    // (undefined_table), which Prisma passes through in `meta`; the message
    // test is a fallback for when it does not.
    const { code, meta } = err as { code?: string; meta?: { code?: string } };
    const noTable = meta?.code === '42P01'
      || /_prisma_migrations.*does not exist/i.test(String((err as Error)?.message));
    if (noTable) return { ok: false, pending: shipped };
    // Anything else — unreachable, no permission — is the connection check's
    // business. Guessing at drift from here would only cry wolf.
    return { ok: true, pending: [], unknown: `could not read _prisma_migrations: ${code ?? 'unknown'}` };
  }

  const pending = shipped.filter((name) => !applied.has(name));
  return { ok: pending.length === 0, pending };
}

/** The line an operator needs, in the log and nowhere else. */
export function pendingMigrationAdvice(pending: string[]): string {
  return `The database is behind this build — ${pending.length} migration(s) not applied: `
    + `${pending.join(', ')}. Every login and every farm write will fail until they are. `
    + 'Fix: npm run prisma:deploy --workspace=server (scripts/deploy.sh does this for you).';
}
