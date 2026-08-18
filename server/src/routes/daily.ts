/**
 * Daily tasks and the login streak — the reasons to come back tomorrow.
 *
 * Progress is bumped by the action routes themselves (see _context.bump), so
 * nothing here can advance a task. These endpoints only pay out, and they read
 * the reward from gamedata rather than from the row, the same rule the order
 * board follows.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DAILY, dayKey, TASK_TEMPLATES } from '../config/gamedata';
import { requireAuth } from '../auth/plugin';
import { errors } from '../lib/errors';
import { rateLimit } from '../lib/ratelimit';
import {
  allTasksClaimed, streakAfterClaim, streakState, templateFor,
} from '../engine/dailyTasks';
import { addCoins, addHay, grantXp, ledger, runAction, saveFarm } from './_context';

const claimBody = z.object({
  kind: z.enum(TASK_TEMPLATES.map((t) => t.key) as [string, ...string[]]),
}).strict();

export default async function dailyRoutes(app: FastifyInstance) {
  /** POST /api/tasks/claim — take the reward for a finished task. */
  app.post('/api/tasks/claim', { preHandler: rateLimit('task-claim') }, async (req) => {
    const { kind } = claimBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const day = dayKey(ctx.now);
      const task = ctx.state.tasks.find((t) => t.kind === kind && t.day === day);
      if (!task) throw errors.notFound('Task');
      if (task.claimed) throw errors.badRequest('Already claimed');
      if (task.progress < task.target) throw errors.badRequest('That task is not finished yet');

      // Pay what config says this task is worth, not what the row says.
      const template = templateFor(kind);
      if (!template) throw errors.badRequest('That task no longer exists');

      const claimed = await ctx.tx.dailyTask.updateMany({
        where: { id: task.id, claimed: false },
        data: { claimed: true },
      });
      if (claimed.count !== 1) throw errors.badRequest('Already claimed');
      task.claimed = true;

      addCoins(ctx, BigInt(template.coins));
      addHay(ctx, template.hay);
      await grantXp(ctx, template.xp);
      await ledger(ctx, 'task_reward', { kind, target: template.target }, {
        coins: BigInt(template.coins), hay: template.hay, xp: template.xp,
      });

      // Finishing all three pays a bonus on top.
      let message = `Task done — +${template.coins} coins`;
      if (allTasksClaimed(ctx.state.tasks)) {
        const bonus = DAILY.allDoneBonus;
        addCoins(ctx, BigInt(bonus.coins));
        addHay(ctx, bonus.hay);
        await grantXp(ctx, bonus.xp);
        await ledger(ctx, 'task_bonus', { day, tasks: ctx.state.tasks.length }, {
          coins: BigInt(bonus.coins), hay: bonus.hay, xp: bonus.xp,
        });
        message = `All tasks done — +${template.coins + bonus.coins} coins and ${bonus.hay} $HAY bonus`;
      }

      await saveFarm(ctx);
      return { notice: { message, icon: 'coin' } };
    });
  });

  /** POST /api/daily/claim — the login streak reward, once per UTC day. */
  app.post('/api/daily/claim', { preHandler: rateLimit('daily-claim') }, async (req) => {
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const state = streakState(
        ctx.state.farm.streakDays,
        ctx.state.farm.streakClaimedOn,
        ctx.state.farm.lastSeenAt,
        ctx.now,
      );
      if (state.claimedToday) throw errors.badRequest('Already claimed today');

      const next = streakAfterClaim(state, ctx.now);
      const written = await ctx.tx.farm.updateMany({
        where: { id: ctx.state.farm.id, streakClaimedOn: ctx.state.farm.streakClaimedOn },
        data: next,
      });
      if (written.count !== 1) throw errors.badRequest('Already claimed today');

      ctx.state.farm.streakDays = next.streakDays;
      ctx.state.farm.streakClaimedOn = next.streakClaimedOn;

      addCoins(ctx, BigInt(state.coins));
      addHay(ctx, state.hay);
      await saveFarm(ctx);
      await ledger(ctx, 'streak', { day: state.day }, {
        coins: BigInt(state.coins), hay: state.hay,
      });

      return {
        notice: {
          message: `Day ${state.day} — +${state.coins} coins, +${state.hay} $HAY`,
          icon: 'coin',
        },
      };
    });
  });
}
