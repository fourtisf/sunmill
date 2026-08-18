/**
 * Wallet login: the server issues a one-time nonce, the player signs it, and
 * the server recovers the address from the signature. The nonce is single-use
 * and short-lived, so a captured signature cannot be replayed.
 */
import crypto from 'node:crypto';
import { verifyMessage } from 'ethers';

export const NONCE_TTL_SECONDS = 300;

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function normaliseAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function makeNonce(): string {
  return crypto.randomBytes(24).toString('hex');
}

/** The exact text the wallet is asked to sign. */
export function challengeMessage(address: string, nonce: string): string {
  return [
    'SUNMIL — sign in',
    '',
    `Wallet: ${normaliseAddress(address)}`,
    `Nonce: ${nonce}`,
    '',
    'Signing this proves you own the wallet. It costs nothing and moves no funds.',
  ].join('\n');
}

/** Returns the recovered address (lowercased) when the signature matches. */
export function recoverSigner(message: string, signature: string): string | null {
  try {
    return normaliseAddress(verifyMessage(message, signature));
  } catch {
    return null;
  }
}
