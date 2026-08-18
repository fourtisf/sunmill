import { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin';
import { LIMITS, rateLimit } from '../lib/ratelimit';
import { refillBoard } from '../engine/orderBoard';
import { runAction } from './_context';

export default async function farmRoutes(app: FastifyInstance) {
  /**
   * GET /api/farm — the resolved snapshot the client mirrors. Resolving here
   * is what settles finished crafts and animal cycles; nothing is auto-collected.
   */
  app.get('/api/farm', { preHandler: rateLimit('farm', LIMITS.read) }, async (req) => {
    const { userId } = await requireAuth(req);
    return runAction(userId, async (ctx) => {
      // The board tops up here too, so the truck shows waiting orders whether
      // or not the player has opened the Orders panel.
      await refillBoard(ctx);
    });
  });
}
