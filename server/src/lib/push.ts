/**
 * Web Push delivery.
 *
 * Off unless VAPID keys are configured, like every other optional thing here:
 * a deployment with no keys simply never sends, and nothing else in the game
 * behaves differently. The public key reaches the browser through /api/config
 * so the client can subscribe without a second round trip; the private key
 * never leaves this module.
 */
import webpush from 'web-push';
import { env } from '../env';
import { prisma } from './db';

export function pushEnabled(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

let configured = false;
let broken = false;

/**
 * Hand the keys to web-push, once. A pair that does not decode is a typo in
 * .env, and it must switch notifications off rather than throw on every sweep
 * for the life of the process — nothing else in the game should notice.
 */
function configure(): boolean {
  if (broken) return false;
  if (configured) return true;
  try {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT,
      env.VAPID_PUBLIC_KEY as string,
      env.VAPID_PRIVATE_KEY as string,
    );
    configured = true;
  } catch (err) {
    broken = true;
    // eslint-disable-next-line no-console
    console.error('[sunmil] VAPID keys are not usable, notifications are off:',
      (err as Error).message);
  }
  return configured;
}

/** How many consecutive refusals before a subscription is treated as dead. */
const MAX_FAILURES = 3;

export interface PushPayload {
  title: string;
  body: string;
  /** Where a click should land. */
  url?: string;
  tag?: string;
}

/**
 * Send to every browser this player registered. Returns how many landed.
 *
 * A push service answering 404 or 410 has revoked the subscription — that is
 * the browser telling us it is gone, and the row goes with it. Anything else
 * is counted; a subscription that keeps refusing is dropped too, so a dead
 * endpoint cannot be retried forever on every sweep.
 */
export async function pushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushEnabled() || !configure()) return 0;

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 60 * 60 },
      );
      sent += 1;
      await prisma.pushSubscription.update({
        where: { id: sub.id },
        data: { lastSentAt: new Date(), failures: 0 },
      }).catch(() => undefined);
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      const gone = status === 404 || status === 410 || sub.failures + 1 >= MAX_FAILURES;
      if (gone) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
      } else {
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { failures: { increment: 1 } },
        }).catch(() => undefined);
      }
    }
  }));

  return sent;
}
