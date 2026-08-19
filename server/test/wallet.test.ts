/**
 * Base58 and ed25519, written here rather than pulled in — so they need
 * proving. The failure that matters is a signature that verifies when it
 * should not, so most of this is about what must be refused.
 */
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base58Decode, challengeMessage, isAddress, normaliseAddress, verifySignature,
} from '../src/auth/wallet';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(buf: Buffer): string {
  let n = BigInt('0x' + (buf.toString('hex') || '0'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; out = '1' + out; }
  return out || '1';
}

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  return {
    address: base58(raw),
    sign: (m: string) => base58(crypto.sign(null, Buffer.from(m, 'utf8'), privateKey)),
  };
}

describe('base58', () => {
  it('round-trips a 32-byte key', () => {
    const raw = crypto.randomBytes(32);
    expect(base58Decode(base58(raw))?.equals(raw)).toBe(true);
  });

  it('keeps leading zero bytes, which a naive implementation drops', () => {
    const raw = Buffer.concat([Buffer.alloc(3), crypto.randomBytes(29)]);
    const decoded = base58Decode(base58(raw));
    expect(decoded?.length).toBe(32);
    expect(decoded?.equals(raw)).toBe(true);
  });

  it('refuses characters base58 does not have', () => {
    // 0, O, I and l are excluded precisely because they are confusable.
    for (const bad of ['0', 'O', 'I', 'l']) {
      expect(base58Decode(`${bad}${'1'.repeat(31)}`)).toBeNull();
    }
  });
});

describe('addresses', () => {
  it('accepts a real public key', () => {
    expect(isAddress(keypair().address)).toBe(true);
  });

  it('rejects an Ethereum address, which is what this used to take', () => {
    expect(isAddress('0x71C7656EC7ab88b098defB751B7401B5f6d8976F')).toBe(false);
  });

  it('rejects the wrong length, empty input and rubbish', () => {
    expect(isAddress(base58(crypto.randomBytes(31)))).toBe(false);
    expect(isAddress('')).toBe(false);
    expect(isAddress('not an address')).toBe(false);
  });

  it('does not fold case, because base58 names a different key if it does', () => {
    const { address } = keypair();
    expect(normaliseAddress(` ${address} `)).toBe(address);
  });
});

describe('signatures', () => {
  const message = challengeMessage('anything', 'nonce-1');

  it('accepts the holder of the key', () => {
    const w = keypair();
    expect(verifySignature(message, w.sign(message), w.address)).toBe(true);
  });

  it('refuses somebody else signing for you', () => {
    const victim = keypair();
    const attacker = keypair();
    expect(verifySignature(message, attacker.sign(message), victim.address)).toBe(false);
  });

  it('refuses a signature over a different message', () => {
    const w = keypair();
    const other = challengeMessage('anything', 'nonce-2');
    expect(verifySignature(message, w.sign(other), w.address)).toBe(false);
  });

  it('refuses a tampered signature rather than throwing', () => {
    const w = keypair();
    const sig = w.sign(message);
    const bent = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(verifySignature(message, bent, w.address)).toBe(false);
  });

  it('refuses malformed input of every shape', () => {
    const w = keypair();
    for (const [sig, addr] of [
      ['', w.address], ['not-base58-0OIl', w.address], [w.sign(message), ''],
      [w.sign(message), 'still-not-an-address'], [base58(crypto.randomBytes(63)), w.address],
    ]) {
      expect(verifySignature(message, sig, addr)).toBe(false);
    }
  });
});
