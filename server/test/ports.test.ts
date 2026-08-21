import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Which port SUNMIL binds, when the environment disagrees with .env.
 *
 * This VPS hosts more than one site, and a neighbouring project's PM2 config
 * reads API_PORT and WEB_PORT with the same 4000/3000 defaults SUNMIL uses.
 * Neither wrote its real numbers down — they lived only in PM2's daemon, which
 * hands the shell it inherited to every app it spawns. Clearing that daemon
 * dropped both projects onto 3000; the one that bound second died with
 * EADDRINUSE and its site went dark.
 *
 * ecosystem.config.js is a plain CommonJS module read by PM2 at spawn time, so
 * the only honest way to test it is to run it: a throwaway directory, a .env
 * we control, and an environment we control.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunmil-ports-'));
  fs.copyFileSync(path.join(root, 'ecosystem.config.js'), path.join(dir, 'ecosystem.config.js'));
  // The config requires dotenv, and creates logs/ next to itself.
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
});

afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) });

interface Ports { api: number; webArgs: string; webEnv: number }

/** Load the config with this .env and this environment, and report the ports. */
function load(dotenv: string | null, ambient: Record<string, string>): Ports {
  const file = path.join(dir, '.env');
  if (dotenv === null) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, dotenv);

  const out = execFileSync(process.execPath, ['-e', `
    const c = require(${JSON.stringify(path.join(dir, 'ecosystem.config.js'))});
    const api = c.apps.find(a => a.name === 'sunmil-api');
    const web = c.apps.find(a => a.name === 'sunmil-web');
    process.stdout.write(JSON.stringify({
      api: api.env_production.API_PORT,
      webArgs: web.args,
      webEnv: web.env_production.PORT,
    }));
  `], {
    // A clean slate, so the runner's own environment cannot decide the answer.
    env: { PATH: process.env.PATH ?? '', ...ambient },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out) as Ports;
}

describe('ecosystem.config.js port resolution', () => {
  it('takes the ports from .env when nothing else sets them', () => {
    const p = load('WEB_PORT=3000\nAPI_PORT=4000\n', {});
    expect(p.api).toBe(4000);
    expect(p.webArgs).toBe('start -p 3000');
  });

  it('lets .env win over an ambient value — the neighbour cannot move us', () => {
    // Exactly the shape of the outage: PM2's daemon holding the other
    // project's numbers under our names.
    const p = load('WEB_PORT=3000\nAPI_PORT=4000\n', { WEB_PORT: '3001', API_PORT: '4001' });
    expect(p.api).toBe(4000);
    expect(p.webArgs).toBe('start -p 3000');
    expect(p.webEnv).toBe(3000);
  });

  it('moves both apps when .env says a different port', () => {
    const p = load('WEB_PORT=3002\nAPI_PORT=4002\n', {});
    expect(p.api).toBe(4002);
    expect(p.webArgs).toBe('start -p 3002');
    expect(p.webEnv).toBe(3002);
  });

  it('still honours the environment for a port .env does not mention', () => {
    // Not a disagreement — a value that exists nowhere else is configuration.
    const p = load('FOO=bar\n', { WEB_PORT: '3001', API_PORT: '4001' });
    expect(p.api).toBe(4001);
    expect(p.webArgs).toBe('start -p 3001');
  });

  it('falls back to 3000/4000 when nobody says anything', () => {
    const p = load('FOO=bar\n', {});
    expect(p.api).toBe(4000);
    expect(p.webArgs).toBe('start -p 3000');
  });

  it('works with no .env file at all, as on a fresh checkout', () => {
    const p = load(null, {});
    expect(p.api).toBe(4000);
    expect(p.webArgs).toBe('start -p 3000');
  });

  it('pins the port into each app\'s own env, not just the argument', () => {
    // PM2 hands these to the spawned process, so a stale daemon value cannot
    // reach Next through PORT either.
    const p = load('WEB_PORT=3005\nAPI_PORT=4005\n', { PORT: '9999' });
    expect(p.webEnv).toBe(3005);
    expect(p.api).toBe(4005);
  });
});
