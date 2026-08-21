/**
 * Subscribing a browser to "your farm is ready".
 *
 * The endpoint the browser hands over is the identity — one row per browser,
 * so a phone and a laptop both ring — and re-subscribing the same endpoint
 * updates it rather than piling up rows, because browsers re-issue the same
 * endpoint after a service worker update.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { errors } from '../lib/errors';
import { LIMITS, rateLimit } from '../lib/ratelimit';
import { requireAuth } from '../auth/plugin';
import { pushEnabled } from '../lib/push';

const subscribeBody = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }).strict(),
}).strict();

const unsubscribeBody = z.object({ endpoint: z.string().url().max(2048) }).strict();

export default async function pushRoutes(app: FastifyInstance) {
  /** POST /api/push/subscribe — remember this browser. */
  app.post('/api/push/subscribe', {
    preHandler: rateLimit('push-subscribe', LIMITS.auth),
  }, async (req) => {
    const { userId } = await requireAuth(req);
    if (!pushEnabled()) throw errors.disabled('Notifications');
    const body = subscribeBody.parse(req.body);

    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      // A browser can be handed to a different farm — a shared laptop, a farm
      // key restored — so the owner is updated, not assumed.
      update: { userId, p256dh: body.keys.p256dh, auth: body.keys.auth, failures: 0 },
      create: { userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth },
    });
    return { ok: true };
  });

  /** POST /api/push/unsubscribe — forget it. */
  app.post('/api/push/unsubscribe', {
    preHandler: rateLimit('push-unsubscribe', LIMITS.auth),
  }, async (req) => {
    const { userId } = await requireAuth(req);
    const { endpoint } = unsubscribeBody.parse(req.body);
    // Scoped to the caller: an endpoint is not a secret, and deleting by
    // endpoint alone would let anyone silence anyone.
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
    return { ok: true };
  });
}
