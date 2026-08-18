import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Next only reads .env files from its own directory, but this repo keeps a
 * single .env at the root that both apps share. Without this, `next build` on
 * a server misses NEXT_PUBLIC_API_URL and bakes the localhost fallback into
 * the client bundle — the deployed site would ask the player's own machine for
 * the farm. Read by hand rather than via dotenv so the frontend keeps no
 * dependency it does not otherwise need.
 */
function fromRootEnv(key, fallback) {
  if (process.env[key]) return process.env[key];
  try {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
    const line = readFileSync(path, 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith(`${key}=`));
    if (line) {
      const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
      if (value) return value;
    }
  } catch {
    // No .env on this box — CI, or a build that sets the variable directly.
  }
  return fallback;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The game is one canvas; there is nothing to statically optimise.
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_API_URL: fromRootEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000'),
  },
};

export default nextConfig;
