/**
 * PM2 process definitions for the Hostinger VPS.
 *
 *   pm2 start ecosystem.config.js
 *   pm2 logs sunmil-api
 *   pm2 reload ecosystem.config.js --env production
 *
 * Secrets come from the repo-root .env (never committed); both apps read it.
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;

// PM2 will not create the log directory itself, and a missing one stops both
// apps from starting on a fresh box.
fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
const envFile = path.join(root, '.env');
require('dotenv').config({ path: envFile });

// Ports come from THIS repo's .env, not from whatever the environment happens
// to be holding. PM2's daemon inherits the shell that first started it and
// hands that on to every app it spawns, and dotenv never overwrites a variable
// that is already set — so an ambient WEB_PORT outlives every deploy and
// reload, and the file quietly loses.
//
// That matters here because this VPS hosts more than one site, and the
// neighbour's PM2 config reads these same two names with these same two
// defaults. Nothing writes the real numbers down; they live only in PM2's
// memory. Clear that memory — `pm2 delete`, a reboot, a daemon restart — and
// both projects fall back to 3000, whoever binds second dies with EADDRINUSE,
// and the site that lost is down until somebody reads the logs.
//
// So the file wins, the same way it does for DATABASE_URL — see
// server/src/lib/envfile.ts for why that rule exists.
const fileEnv = fs.existsSync(envFile)
  ? require('dotenv').parse(fs.readFileSync(envFile))
  : {};

function port(key, fallback) {
  const chosen = fileEnv[key] || process.env[key] || String(fallback);
  const live = process.env[key];
  if (fileEnv[key] && live && live !== fileEnv[key]) {
    console.warn(
      `[sunmil] ${key}: .env says ${fileEnv[key]}, this environment says ${live}. ` +
      'Using .env. That stale value is usually PM2 handing its daemon\'s ' +
      `environment to every app it starts — unset ${key} to be rid of it.`,
    );
  }
  return Number(chosen);
}

const API_PORT = port('API_PORT', 4000);
const WEB_PORT = port('WEB_PORT', 3000);

const shared = {
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 10,
  min_uptime: '20s',
  max_memory_restart: '512M',
  merge_logs: true,
  time: true,
};

module.exports = {
  apps: [
    {
      ...shared,
      name: 'sunmil-api',
      cwd: path.join(root, 'server'),
      script: 'dist/index.js',
      out_file: path.join(root, 'logs/api.out.log'),
      error_file: path.join(root, 'logs/api.err.log'),
      env: { NODE_ENV: 'development', DOTENV_CONFIG_PATH: envFile, API_PORT },
      env_production: { NODE_ENV: 'production', DOTENV_CONFIG_PATH: envFile, API_PORT },
    },
    {
      ...shared,
      name: 'sunmil-web',
      cwd: path.join(root, 'frontend'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p ' + WEB_PORT,
      out_file: path.join(root, 'logs/web.out.log'),
      error_file: path.join(root, 'logs/web.err.log'),
      env: { NODE_ENV: 'development', WEB_PORT, PORT: WEB_PORT },
      env_production: { NODE_ENV: 'production', WEB_PORT, PORT: WEB_PORT },
    },
  ],
};
