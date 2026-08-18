import { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin';
import { LIMITS, rateLimit } from '../lib/ratelimit';
import { runAction } from './_context';

export default async function farmRoutes(app: FastifyInstance) {
  /**
   * GET /api/farm — the resolved snapshot the client mirrors. Resolving here
   * is what settles finished crafts and animal cycles; nothing is auto-collected.
   */
  app.get('/api/farm', { preHandler: rateLimit('farm', LIMITS.read) }, async (req) => {
    const { userId } = await requireAuth(req);
    return runAction(userId, async () => {});
  });
}
