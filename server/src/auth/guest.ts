/**
 * Passcode-only play.
 *
 * With wallet login off, the invite code is what gets a player *in* — but it is
 * shared by every beta tester, so it cannot be what tells them apart. Each
 * browser therefore gets a farm key: 24 random bytes minted by the server,
 * handed back exactly once and kept by the client.
 *
 * Only its SHA-256 lives in the database, for the same reason a password hash
 * does — a dump of the users table must not be a pile of working logins. That
 * also means a lost key is a lost farm: there is no wallet and no email to
 * recover from, which is the honest cost of asking for nothing but a code.
 */
import crypto from 'node:crypto';

/** URL-safe, no padding, no ambiguity when a player copies it by hand. */
const KEY_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function makeGuestKey(): string {
  return crypto.randomBytes(24).toString('base64url'); // 32 chars, 192 bits
}

export function hashGuestKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Shape check only — a well-formed key still has to match a stored hash. It
 * exists so a junk value from localStorage is refused before it costs a query.
 */
export function isGuestKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_RE.test(value);
}
