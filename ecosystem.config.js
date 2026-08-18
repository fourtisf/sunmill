/**
 * PM2 process definitions for the Hostinger VPS.
 *
 *   pm2 start ecosystem.config.js
 *   pm2 logs sunmill-api
 *   pm2 reload ecosystem.config.js --env production
 *
 * Secrets come from the repo-root .env (never committed); both apps read it.
 */
const path = require('path');

const root = __dirname;
const envFile = path.join(root, '.env');
require('dotenv').config({ path: envFile });

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
      name: 'sunmill-api',
      cwd: path.join(root, 'server'),
      script: 'dist/index.js',
      out_file: path.join(root, 'logs/api.out.log'),
      error_file: path.join(root, 'logs/api.err.log'),
      env: { NODE_ENV: 'development', DOTENV_CONFIG_PATH: envFile },
      env_production: { NODE_ENV: 'production', DOTENV_CONFIG_PATH: envFile },
    },
    {
      ...shared,
      name: 'sunmill-web',
      cwd: path.join(root, 'frontend'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p ' + (process.env.WEB_PORT || 3000),
      out_file: path.join(root, 'logs/web.out.log'),
      error_file: path.join(root, 'logs/web.err.log'),
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
