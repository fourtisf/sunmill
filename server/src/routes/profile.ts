/**
 * Player identity, tutorial progress, and the leaderboard.
 *
 * The name matters beyond decoration: order boards draw from real players'
 * names, so naming yourself puts you into other people's games.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin';
import { prisma } from '../lib/db';
import { errors } from '../lib/errors';
import { LIMITS, rateLimit } from '../lib/ratelimit';
import { runAction } from './_context';

/** Letters, digits, spaces and a few marks. No control characters, no markup. */
const NAME = z.string().trim().min(2).max(20).regex(
  /^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u,
  'use letters, numbers, spaces, and . _ \' -',
);

const profileBody = z.object({
  name: NAME.optional(),
  farmName: NAME.optional(),
}).strict().refine((b) => b.name || b.farmName, 'nothing to change');

const tutorialBody = z.object({
  step: z.number().int().min(0).max(64).optional(),
  done: z.boolean().optional(),
}).strict();

export default async function profileRoutes(app: FastifyInstance) {
  /** POST /api/profile — set the player name and/or the farm name. */
  app.post('/api/profile', { preHandler: rateLimit('profile') }, async (req) => {
    const body = profileBody.parse(req.body);
    const { userId } = await requireAuth(req);

    if (body.name) {
      const taken = await prisma.user.findFirst({
        where: { name: { equals: body.name, mode: 'insensitive' }, id: { not: userId } },
        select: { id: true },
      });
      if (taken) throw errors.conflict('That name is taken');
      await prisma.user.update({ where: { id: userId }, data: { name: body.name } });
    }

    return runAction(userId, async (ctx) => {
      if (body.farmName) {
        ctx.state.farm.name = body.farmName;
        await ctx.tx.farm.update({
          where: { id: ctx.state.farm.id }, data: { name: body.farmName },
        });
      }
      if (body.name) ctx.state.playerName = body.name;
      return { notice: { code: 'profile_saved', message: 'Saved', icon: 'coin' } };
    });
  });

  /** POST /api/tutorial — remember how far through the guide the player is. */
  app.post('/api/tutorial', { preHandler: rateLimit('tutorial') }, async (req) => {
    const body = tutorialBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const data: { tutorialStep?: number; tutorialDone?: boolean } = {};
      if (body.step != null) {
        // Never go backwards: a stale client must not reopen a finished guide.
        data.tutorialStep = Math.max(ctx.state.farm.tutorialStep, body.step);
        ctx.state.farm.tutorialStep = data.tutorialStep;
      }
      if (body.done != null && body.done) {
        data.tutorialDone = true;
        ctx.state.farm.tutorialDone = true;
      }
      if (Object.keys(data).length) {
        await ctx.tx.farm.update({ where: { id: ctx.state.farm.id }, data });
      }
    });
  });

  /**
   * GET /api/leaderboard — who else is out there. Read-only and public to any
   * signed-in player; it exposes a name and a level, nothing more.
   */
  app.get('/api/leaderboard', { preHandler: rateLimit('leaderboard', LIMITS.read) }, async (req) => {
    const { userId } = await requireAuth(req);

    const top = await prisma.farm.findMany({
      where: { user: { name: { not: null } } },
      select: {
        level: true, xp: true, name: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: [{ level: 'desc' }, { xp: 'desc' }],
      take: 25,
    });

    const mine = await prisma.farm.findUnique({
      where: { userId },
      select: { level: true, xp: true, name: true, user: { select: { name: true } } },
    });

    // Rank over the same population the list shows — named players only.
    // Counting every farm, including the unnamed ones, put a player at rank
    // 158 in a board of one.
    const ahead = mine
      ? await prisma.farm.count({
        where: {
          user: { name: { not: null } },
          OR: [
            { level: { gt: mine.level } },
            { level: mine.level, xp: { gt: mine.xp } },
          ],
        },
      })
      : 0;

    return {
      top: top.map((f, i) => ({
        rank: i + 1,
        // So a row can be tapped and visited. It is the same id the visit
        // route takes, and it is already public to any signed-in player.
        id: f.user.id,
        name: f.user.name,
        farmName: f.name,
        level: f.level,
        xp: f.xp,
        you: f.user.id === userId,
      })),
      you: mine
        ? { rank: ahead + 1, name: mine.user.name, farmName: mine.name, level: mine.level, xp: mine.xp }
        : null,
    };
  });
}
