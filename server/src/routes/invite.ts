import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errors } from '../lib/errors';
import { LIMITS, consume } from '../lib/ratelimit';
import { codeMatches, hasInvite, inviteRequired, setInviteCookie } from '../auth/invite';

const body = z.object({ code: z.string().min(1).max(64) }).strict();

export default async function inviteRoutes(app: FastifyInstance) {
  /**
   * GET /api/invite — does this deployment gate, and is this browser through?
   * Deliberately says nothing about the code itself.
   */
  app.get('/api/invite', async (req) => ({
    required: inviteRequired(),
    ok: hasInvite(req),
  }));

  /** POST /api/invite — spend one attempt against the configured code. */
  app.post('/api/invite', async (req, reply) => {
    if (!inviteRequired()) return { ok: true, required: false };

    const { code } = body.parse(req.body);

    // Keyed by IP, because there is no user yet. This bucket is much tighter
    // than the auth ones: it is the only thing between a short code and a
    // brute force, so a wrong guess has to cost something.
    await consume(`ip:${req.ip}`, 'invite', LIMITS.invite);

    if (!codeMatches(code.trim())) throw errors.inviteInvalid();

    setInviteCookie(reply);
    return { ok: true, required: true };
  });
}
