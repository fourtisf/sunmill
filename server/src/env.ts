/**
 * Environment loading + validation. Fails fast at boot rather than at the
 * first request, and never exposes a secret beyond this module.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? path.resolve(__dirname, '../../.env') });

const bool = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .refine((v) => ['true', 'false', '1', '0', 'yes', 'no', ''].includes(v), 'must be a boolean')
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
  COOKIE_NAME: z.string().default('sunmill_session'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool.default('false'),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  TIME_SCALE: z.coerce.number().positive().default(1),

  HAY_ONCHAIN_ENABLED: bool.default('false'),
  HAY_WITHDRAW_DAILY_CAP: z.coerce.number().positive().default(50),
  HAY_WITHDRAW_REVIEW_THRESHOLD: z.coerce.number().positive().default(25),
  CHAIN_RPC_URL: z.string().optional(),
  CHAIN_ID: z.string().optional(),
  HAY_TOKEN_ADDRESS: z.string().optional(),
  TREASURY_ADDRESS: z.string().optional(),
  TREASURY_PRIVATE_KEY: z.string().optional(),
  CHAIN_MIN_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(12),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment:\n${lines.join('\n')}`);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
};

/**
 * On-chain $HAY needs more than the flag: without an RPC, a token address and
 * a treasury key the endpoints stay off however the flag is set (HANDOFF §7).
 */
export function onChainReady(): boolean {
  return Boolean(
    env.HAY_ONCHAIN_ENABLED
    && env.CHAIN_RPC_URL
    && env.HAY_TOKEN_ADDRESS
    && env.TREASURY_ADDRESS
    && env.TREASURY_PRIVATE_KEY,
  );
}

if (env.isProd && !env.COOKIE_SECURE) {
  // Loud, but not fatal — someone may be terminating TLS elsewhere.
  // eslint-disable-next-line no-console
  console.warn('[sunmill] COOKIE_SECURE=false in production — the session cookie will be sent over plain HTTP.');
}
