import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../env';
import { prisma } from '../lib/db';
import { errors } from '../lib/errors';
import { LIMITS, consume } from '../lib/ratelimit';
import { createFarm, ensureFarmShape } from '../engine/bootstrap';
import {
  clearSessionCookie, requireAuth, setSessionCookie,
} from '../auth/plugin';
import { signSession } from '../auth/tokens';
import {
  NONCE_TTL_SECONDS, challengeMessage, isAddress, makeNonce,
  normaliseAddress, recoverSigner,
} from '../auth/wallet';

const nonceBody = z.object({ address: z.string().min(1) }).strict();
const walletBody = z.object({
  address: z.string().min(1),
  signature: z.string().min(1),
}).strict();

export default async function authRoutes(app: FastifyInstance) {
  /** POST /api/auth/nonce — issue a one-time challenge for a wallet. */
  app.post('/api/auth/nonce', async (req) => {
    const { address } = nonceBody.parse(req.body);
    if (!isAddress(address)) throw errors.badRequest('Not a wallet address');
    const wallet = normaliseAddress(address);

    // Rate-limited by address so an unauthenticated caller cannot mint nonces.
    await consume(`addr:${wallet}`, 'auth-nonce', LIMITS.auth);

    const nonce = makeNonce();
    const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000);
    await prisma.authNonce.create({ data: { address: wallet, nonce, expiresAt } });

    return { nonce, message: challengeMessage(wallet, nonce), expiresAt: expiresAt.toISOString() };
  });

  /** POST /api/auth/wallet — verify the signature, open a session. */
  app.post('/api/auth/wallet', async (req, reply) => {
    const body = walletBody.parse(req.body);
    if (!isAddress(body.address)) throw errors.badRequest('Not a wallet address');
    const wallet = normaliseAddress(body.address);
    await consume(`addr:${wallet}`, 'auth-wallet', LIMITS.auth);

    const now = new Date();
    const candidates = await prisma.authNonce.findMany({
      where: { address: wallet, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    let matched: { id: string; nonce: string } | null = null;
    for (const c of candidates) {
      const signer = recoverSigner(challengeMessage(wallet, c.nonce), body.signature);
      if (signer && signer === wallet) { matched = c; break; }
    }
    if (!matched) throw errors.unauthorized();

    // Burn the nonce first — a replay of the same signature finds nothing.
    const burned = await prisma.authNonce.updateMany({
      where: { id: matched.id, usedAt: null },
      data: { usedAt: now },
    });
    if (burned.count !== 1) throw errors.unauthorized();

    const userId = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { wallet }, include: { farm: true } });
      if (!user) {
        user = await tx.user.create({ data: { wallet }, include: { farm: true } });
      }
      if (!user.farm) {
        await createFarm(tx, user.id);
      } else {
        await ensureFarmShape(tx, user.farm.id);
      }
      return user.id;
    });

    setSessionCookie(reply, signSession({ userId, wallet }));
    return { ok: true, wallet };
  });

  /**
   * POST /api/auth/dev — a signature-free login for local QA. Refused outright
   * in production; there is no way to enable it there.
   */
  app.post('/api/auth/dev', async (req, reply) => {
    if (env.isProd) throw errors.notFound('Route');
    const { handle } = z.object({ handle: z.string().min(1).max(64) }).strict().parse(req.body);
    const email = `${handle.toLowerCase()}@dev.local`;

    const userId = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email }, include: { farm: true } });
      if (!user) user = await tx.user.create({ data: { email }, include: { farm: true } });
      if (!user.farm) await createFarm(tx, user.id);
      else await ensureFarmShape(tx, user.farm.id);
      return user.id;
    });

    setSessionCookie(reply, signSession({ userId }));
    return { ok: true, handle };
  });

  /** GET /api/auth/me — who the cookie says you are. */
  app.get('/api/auth/me', async (req) => {
    if (!req.user) return { authenticated: false };
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, wallet: true, email: true, createdAt: true },
    });
    if (!user) return { authenticated: false };
    return { authenticated: true, user };
  });

  /** POST /api/auth/logout */
  app.post('/api/auth/logout', async (req, reply) => {
    await requireAuth(req).catch(() => null);
    clearSessionCookie(reply);
    return { ok: true };
  });
}
