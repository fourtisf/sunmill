/**
 * Session handling. The JWT lives in an httpOnly, sameSite cookie — it is
 * never readable from JavaScript and never sent in a response body.
 */
import { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env';
import { errors } from '../lib/errors';
import { verifySession } from './tokens';
import type { SessionClaims } from './tokens';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionClaims;
  }
}

export function attachSession(req: FastifyRequest): void {
  const token = req.cookies?.[env.COOKIE_NAME];
  if (!token) return;
  const claims = verifySession(token);
  if (claims) req.user = claims;
}

/** preHandler for every route that touches a farm. */
export async function requireAuth(req: FastifyRequest): Promise<SessionClaims> {
  if (!req.user) throw errors.unauthorized();
  return req.user;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(env.COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: env.JWT_TTL_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env.COOKIE_NAME, {
    path: '/',
    domain: env.COOKIE_DOMAIN || undefined,
  });
}
