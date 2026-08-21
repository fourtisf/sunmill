/**
 * The deploy check that was missing.
 *
 * `SELECT 1` passes against a database whose migrations were never applied, so
 * a deploy that shipped the code and skipped the schema looked green on
 * /api/health?deep=1 while every login 500'd — a landing page whose only
 * button could not open a farm, and no signal anywhere that said why.
 *
 * These drive the real thing: a live database, one migration row removed to
 * make it genuinely behind the build, and the health endpoint asked what it
 * thinks. The row is put back whatever happens.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const dbUrl = process.env.DATABASE_URL;

let app: FastifyInstance;
let prisma: import('@prisma/client').PrismaClient;
let redis: import('ioredis').Redis;
let schemaStatus: typeof import('../../src/lib/schema')['schemaStatus'];
let shippedMigrations: typeof import('../../src/lib/schema')['shippedMigrations'];
let reachable = false;

beforeAll(async () => {
  if (!dbUrl) return;
  try {
    ({ prisma } = await import('../../src/lib/db'));
    ({ redis } = await import('../../src/lib/redis'));
    ({ schemaStatus, shippedMigrations } = await import('../../src/lib/schema'));
    await prisma.$queryRaw`SELECT 1`;
    const { buildApp } = await import('../../src/app');
    app = await buildApp();
    await app.ready();
    reachable = true;
  } catch {
    reachable = false;
  }
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
  if (redis) redis.disconnect();
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) return;
    await fn();
  });

/** Take a migration row out, run the body, and always put it back. */
async function withMigrationMissing(name: string, body: () => Promise<void>) {
  const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    'SELECT * FROM "_prisma_migrations" WHERE migration_name = $1', name,
  );
  if (!row) throw new Error(`${name} is not applied to this database`);
  await prisma.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE migration_name = $1', name);
  try {
    await body();
  } finally {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations"
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      row.id, row.checksum, row.finished_at, row.migration_name,
      row.logs, row.rolled_back_at, row.started_at, row.applied_steps_count,
    );
  }
}

describe('schema drift', () => {
  maybe('a fully migrated database reports no drift', async () => {
    const status = await schemaStatus();
    expect(status.pending).toEqual([]);
    expect(status.ok).toBe(true);
  });

  maybe('the build knows which migrations it ships', async () => {
    const shipped = shippedMigrations();
    expect(shipped).not.toBeNull();
    expect(shipped!.length).toBeGreaterThan(0);
    // Lexical order is apply order — the check depends on reading them all,
    // not on any one name, so assert the set is real rather than a fixed list.
    expect([...shipped!].sort()).toEqual(shipped);
  });

  maybe('deep health goes red, and names the migration, when the database is behind', async () => {
    const shipped = shippedMigrations()!;
    const newest = shipped[shipped.length - 1];

    // Green before, so the assertions below are about the drift and not about
    // some unrelated dependency being down on this box.
    const before = await app.inject({ method: 'GET', url: '/api/health?deep=1' });
    expect(before.statusCode).toBe(200);
    expect(before.json().ok).toBe(true);

    await withMigrationMissing(newest, async () => {
      const status = await schemaStatus();
      expect(status.ok).toBe(false);
      expect(status.pending).toContain(newest);

      const res = await app.inject({ method: 'GET', url: '/api/health?deep=1' });
      // 503 is what scripts/deploy.sh fails the deploy on.
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.postgres).toBe(true);   // the connection was never the problem
      expect(body.schema).toBe(false);
      expect(body.pendingMigrations).toContain(newest);
    });

    // And back to green once the migration is accounted for again.
    const after = await app.inject({ method: 'GET', url: '/api/health?deep=1' });
    expect(after.statusCode).toBe(200);
    expect(after.json().ok).toBe(true);
  });

  maybe('deep health names the reason Postgres refused, not just that it did', async () => {
    // The live incident: postgres online, listening, pg_isready green, and the
    // API still reporting `"postgres":false` with nothing to act on. The
    // endpoint had the P-code and threw it away.
    const refused = Object.assign(
      new Error('Authentication failed against database server'),
      { code: 'P1000', clientVersion: '5.22.0' },
    );
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(refused);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health?deep=1' });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.postgres).toBe(false);
      expect(body.postgresCode).toBe('P1000');
      // The code and nothing else — /api/health is unauthenticated, and the
      // message names the role the credentials were rejected for.
      expect(JSON.stringify(body)).not.toContain('Authentication failed');
    } finally {
      spy.mockRestore();
    }

    // Green again, and carrying no code, once the database answers.
    const after = await app.inject({ method: 'GET', url: '/api/health?deep=1' });
    expect(after.statusCode).toBe(200);
    expect(after.json()).not.toHaveProperty('postgresCode');
  });

  maybe('shallow health stays cheap and says nothing about the schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, time: expect.any(String) });
  });
});
