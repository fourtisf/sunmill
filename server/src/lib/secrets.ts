import crypto from 'node:crypto';

/**
 * Compare a caller-supplied secret against the expected one without leaking
 * where they diverge.
 *
 * auth/invite.ts has always done this for the invite code, where the honest
 * note in the comment is that the rate limit is the real defence and a short
 * code is guessed long before it is timed. The admin token is the other case:
 * it is the second factor on releasing treasury $HAY, it is long, and it is
 * compared on a route an operator hits rarely enough that timing noise from
 * other traffic cannot be relied on to hide anything. It was using `!==`.
 *
 * Length is not secret — an attacker learns it from a refusal either way — so
 * comparing lengths first is safe, and it is what lets timingSafeEqual run at
 * all: it throws on buffers of different sizes.
 */
export function secretMatches(candidate: string | undefined, expected: string | undefined): boolean {
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
