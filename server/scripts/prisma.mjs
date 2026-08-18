#!/usr/bin/env node
/**
 * Run the Prisma CLI with the repo-root .env loaded.
 *
 * The CLI looks for a .env next to the schema or in its own working directory,
 * but this repo keeps one .env at the root that every process shares. Without
 * this shim the CLI cannot see DATABASE_URL and dies with P1012 anywhere the
 * variable has not already been exported by hand — which is every server,
 * because only the dev helper scripts source it.
 *
 * Loading through dotenv rather than sourcing the file in a shell also parses
 * values properly. A DATABASE_URL carrying a query string breaks `. .env` on
 * the first unquoted ampersand, long before it ever reaches Prisma.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: process.env.DOTENV_CONFIG_PATH ?? resolve(here, '../../.env') });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set, and no .env was found at the repo root.');
  console.error('Copy .env.example to .env and fill it in before running Prisma.');
  process.exit(1);
}

// npm puts node_modules/.bin on PATH for scripts, which is how `prisma` resolves.
const child = spawn('prisma', process.argv.slice(2), { stdio: 'inherit', env: process.env });
child.on('error', (err) => {
  console.error(`could not run prisma: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
