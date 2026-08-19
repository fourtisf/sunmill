/**
 * Wallet login on Solana.
 *
 * The server issues a one-time nonce, the wallet signs it with the account's
 * ed25519 key, and the server checks that signature against the public key the
 * client claims to be. The nonce is single-use and short-lived, so a captured
 * signature cannot be replayed — and unlike secp256k1 there is nothing to
 * recover: a signature that verifies against the address IS the proof.
 *
 * Base58 and ed25519 are both done here rather than pulled in. Node verifies
 * ed25519 natively once the raw 32-byte key is wrapped in its SPKI header, and
 * base58 is twenty lines. A dependency for either would be supply-chain risk
 * taken for no gain, on the one path that decides who a player is.
 */
import crypto from 'node:crypto';

export const NONCE_TTL_SECONDS = 300;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Ed25519 SubjectPublicKeyInfo prefix: the fixed 12 bytes before the key. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function base58Decode(input: string): Buffer | null {
  if (!input) return null;
  const bytes: number[] = [0];
  for (const ch of input) {
    const value = B58.indexOf(ch);
    if (value < 0) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  // Every leading '1' encodes a leading zero byte.
  for (const ch of input) { if (ch !== '1') break; bytes.push(0); }
  return Buffer.from(bytes.reverse());
}

/** A Solana address is a base58 ed25519 public key — 32 bytes, nothing else. */
export function isAddress(value: string): boolean {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  const decoded = base58Decode(value.trim());
  return decoded !== null && decoded.length === 32;
}

/**
 * Base58 is case-sensitive, so unlike a hex address this must NOT be
 * lowercased — that would name a different key.
 */
export function normaliseAddress(value: string): string {
  return value.trim();
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

/**
 * Does this signature prove ownership of this address?
 *
 * `signature` is base58, as the wallet standard hands it back. Anything
 * malformed is a no rather than a throw — this runs on unauthenticated input.
 */
export function verifySignature(message: string, signature: string, address: string): boolean {
  try {
    const key = base58Decode(address);
    const sig = base58Decode(signature);
    if (!key || key.length !== 32 || !sig || sig.length !== 64) return false;
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, key]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(message, 'utf8'), publicKey, sig);
  } catch {
    return false;
  }
}
