/**
 * Closed-beta gate.
 *
 * The code never reaches the browser. The client posts a candidate, the server
 * compares it against INVITE_CODE and, on a match, sets a signed httpOnly
 * cookie; every route that can mint a session then demands that cookie. So a
 * client-side bypass buys nothing — reading the page source, deleting the
 * overlay or calling the API directly all still leave you without a session,
 * because the check that matters happens here.
 *
 * Unset INVITE_CODE means no gate at all, which is what local development and
 * the test suite want. Production says so out loud at boot.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env';
import { errors } from '../lib/errors';

const AUDIENCE = 'sunmil-invite';

export function inviteRequired(): boolean {
  return Boolean(env.INVITE_CODE);
}

/**
 * Constant-time compare. A short code is brute-forced long before it is timed,
 * so this is belt-and-braces — the rate limit on the route is the real
 * defence, and the code's own length is the real ceiling on both.
 */
export function codeMatches(candidate: string): boolean {
  const expected = env.INVITE_CODE;
  if (!expected) return true;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function signInvite(): string {
  return jwt.sign({ inv: true }, env.JWT_SECRET, {
    expiresIn: env.INVITE_TTL_SECONDS,
    issuer: 'sunmil',
    audience: AUDIENCE,
  });
}

function validInviteToken(token: string): boolean {
  try {
    jwt.verify(token, env.JWT_SECRET, { issuer: 'sunmil', audience: AUDIENCE });
    return true;
  } catch {
    return false;
  }
}

/** Has this browser already passed the gate (or is there no gate)? */
export function hasInvite(req: FastifyRequest): boolean {
  if (!inviteRequired()) return true;
  const token = req.cookies?.[env.INVITE_COOKIE_NAME];
  return typeof token === 'string' && token.length > 0 && validInviteToken(token);
}

/** Guard for anything that can open a session. */
export function requireInvite(req: FastifyRequest): void {
  if (!hasInvite(req)) throw errors.inviteRequired();
}

export function setInviteCookie(reply: FastifyReply): void {
  reply.setCookie(env.INVITE_COOKIE_NAME, signInvite(), {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: env.INVITE_TTL_SECONDS,
  });
}
