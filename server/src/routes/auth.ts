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
import { requireInvite } from '../auth/invite';
import { makeGuestKey, hashGuestKey, isGuestKey } from '../auth/guest';
import { signSession } from '../auth/tokens';
import {
  NONCE_TTL_SECONDS, challengeMessage, isAddress, makeNonce,
  normaliseAddress, verifySignature,
} from '../auth/wallet';

const nonceBody = z.object({ address: z.string().min(1) }).strict();
const walletBody = z.object({
  address: z.string().min(1),
  signature: z.string().min(1),
}).strict();
// Absent key = "open me a new farm"; present key = "give me the one I own".
const guestBody = z.object({ key: z.string().min(1).max(64).optional() }).strict();

export default async function authRoutes(app: FastifyInstance) {
  /**
   * Wallet login is a deployment choice, and turning it off removes the routes
   * rather than hiding a button: a client that still posts a signature gets a
   * 404, not a session. `features.walletLogin` in /api/config is what the UI
   * reads, so the two can never drift apart.
   */
  if (env.WALLET_LOGIN) registerWalletAuth(app);

  /**
   * POST /api/auth/guest — the passcode-only path.
   *
   * The invite cookie says this browser is allowed in; the farm key says which
   * farm is theirs. Posting no key opens a new farm and returns a key, which is
   * the only time the server ever utters it. Posting a key that matches nothing
   * is refused rather than silently turned into a fresh farm — a player whose
   * key went stale needs to be told, not handed an empty field.
   */
  app.post('/api/auth/guest', async (req, reply) => {
    if (!env.GUEST_LOGIN) throw errors.notFound('Route');
    requireInvite(req);
    const { key } = guestBody.parse(req.body ?? {});

    if (key !== undefined) {
      if (!isGuestKey(key)) throw errors.guestUnknown();
      const hashed = hashGuestKey(key);
      // Keyed by the key, not the caller's IP. Coming back to a farm you can
      // already prove you own is not the abusable direction, and a whole
      // Discord server behind one NAT must not be each other's problem.
      await consume(`gk:${hashed}`, 'auth-resume', LIMITS.auth);

      const user = await prisma.user.findUnique({
        where: { guestKey: hashed },
        include: { farm: true },
      });
      if (!user) throw errors.guestUnknown();
      if (!user.farm) await prisma.$transaction((tx) => createFarm(tx, user.id));
      else await prisma.$transaction((tx) => ensureFarmShape(tx, user.farm!.id));
      setSessionCookie(reply, signSession({ userId: user.id }));
      return { ok: true, created: false };
    }

    // Creating is the direction worth limiting: it is the only thing an
    // anonymous caller can do that writes rows. Keyed by IP, because a farm
    // that does not exist yet has nothing else to key on.
    await consume(`ip:${req.ip}`, 'auth-guest', LIMITS.auth);

    const fresh = makeGuestKey();
    const userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { guestKey: hashGuestKey(fresh) } });
      await createFarm(tx, user.id);
      return user.id;
    });

    setSessionCookie(reply, signSession({ userId }));
    // Said once. We store only the hash, so we could not repeat it if we tried.
    return { ok: true, created: true, key: fresh };
  });

  /**
   * POST /api/auth/dev — a signature-free login for local QA and the test
   * suite, keyed by a handle so a script can come back as the same farmer.
   * Refused outright in production; there is no way to enable it there.
   */
  app.post('/api/auth/dev', async (req, reply) => {
    if (env.isProd) throw errors.notFound('Route');
    requireInvite(req);
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

function registerWalletAuth(app: FastifyInstance) {
  /** POST /api/auth/nonce — issue a one-time challenge for a wallet. */
  app.post('/api/auth/nonce', async (req) => {
    requireInvite(req);
    const { address } = nonceBody.parse(req.body);
    if (!isAddress(address)) throw errors.badRequest('Not a Solana address');
    const wallet = normaliseAddress(address);

    // Rate-limited by address so an unauthenticated caller cannot mint nonces.
    await consume(`addr:${wallet}`, 'auth-nonce', LIMITS.auth);

    const nonce = makeNonce();
    const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000);
    await prisma.authNonce.create({ data: { address: wallet, nonce, expiresAt } });

    // Opportunistic sweep — keeps the challenge table from growing forever
    // without needing a cron. Bounded to this wallet, so it stays cheap.
    void prisma.authNonce
      .deleteMany({ where: { address: wallet, expiresAt: { lt: new Date() } } })
      .catch(() => undefined);

    return { nonce, message: challengeMessage(wallet, nonce), expiresAt: expiresAt.toISOString() };
  });

  /** POST /api/auth/wallet — verify the signature, open a session. */
  app.post('/api/auth/wallet', async (req, reply) => {
    requireInvite(req);
    const body = walletBody.parse(req.body);
    if (!isAddress(body.address)) throw errors.badRequest('Not a Solana address');
    const wallet = normaliseAddress(body.address);
    await consume(`addr:${wallet}`, 'auth-wallet', LIMITS.auth);

    const now = new Date();
    const candidates = await prisma.authNonce.findMany({
      where: { address: wallet, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    // Ed25519 verifies against a claimed key rather than recovering one, so
    // each outstanding nonce is checked against the address the caller named.
    // A signature over a different nonce, or by a different key, matches none.
    let matched: { id: string; nonce: string } | null = null;
    for (const c of candidates) {
      if (verifySignature(challengeMessage(wallet, c.nonce), body.signature, wallet)) {
        matched = c;
        break;
      }
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

}
