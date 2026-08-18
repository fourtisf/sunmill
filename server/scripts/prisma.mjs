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
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: process.env.DOTENV_CONFIG_PATH ?? resolve(here, '../../.env') });

// generate, format and validate only read the schema. They run during npm ci,
// before anyone has had a chance to write a .env, so failing there would break
// the install itself — but anything that touches the database must still fail.
const readsSchemaOnly = ['generate', 'format', 'validate'].includes(process.argv[2]);

if (!process.env.DATABASE_URL) {
  if (!readsSchemaOnly) {
    console.error('DATABASE_URL is not set, and no .env was found at the repo root.');
    console.error('Copy .env.example to .env and fill it in before running Prisma.');
    process.exit(1);
  }
  // The schema declares env("DATABASE_URL"), so validation needs *a* value.
  // Nothing connects during these commands, and a real .env replaces it.
  process.env.DATABASE_URL = 'postgresql://unset:unset@127.0.0.1:5432/unset?schema=public';
}

/**
 * npm puts node_modules/.bin on PATH for its own scripts, but this file is also
 * run directly. Walk up for the binary so both work, and fall back to PATH.
 */
function prismaBin() {
  let dir = here;
  for (let i = 0; i < 5; i += 1) {
    const candidate = resolve(dir, 'node_modules/.bin/prisma');
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, '..');
  }
  return 'prisma';
}

// Run from the package root so the CLI finds prisma/schema.prisma however
// this was invoked.
const child = spawn(prismaBin(), process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
  cwd: resolve(here, '..'),
});
child.on('error', (err) => {
  console.error(`could not run prisma: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
