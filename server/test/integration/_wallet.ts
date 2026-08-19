/**
 * A throwaway Solana keypair for tests.
 *
 * The public key IS the address, so this signs exactly as Phantom does: raw
 * ed25519 over the message bytes, key and signature both carried as base58.
 * Real signatures rather than a stub, because the signature check is the only
 * thing standing between a wallet address and somebody else's farm.
 */
import crypto from 'node:crypto';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(buf: Buffer): string {
  let n = BigInt('0x' + (buf.toString('hex') || '0'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; out = '1' + out; }
  return out || '1';
}

export interface TestWallet {
  address: string;
  sign(message: string): string;
}

export function createWallet(): TestWallet {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  return {
    address: base58(raw),
    sign: (message: string) => base58(crypto.sign(null, Buffer.from(message, 'utf8'), privateKey)),
  };
}
