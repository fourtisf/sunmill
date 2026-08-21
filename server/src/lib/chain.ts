/**
 * On-chain $HAY (HANDOFF §7), on Solana.
 *
 * The previous version of this file targeted an EVM chain — ethers, an ERC-20
 * contract, 0x addresses, a secp256k1 treasury key — because that is what the
 * handoff described. Wallet login moved to Solana and this did not follow, so
 * for a while the addresses it would have paid out to were not the addresses
 * players sign in with, and the token it would have transferred was not the
 * token. It is an SPL transfer now, against a Solana RPC, signed by a treasury
 * keypair, and deposits are read back out of Solana transactions.
 *
 * The interface is unchanged on purpose: `sendHay` and `verifyDeposit` are all
 * the routes ever call, and the ledger, refund, daily-cap and review-hold logic
 * around them is chain-agnostic and already tested.
 *
 * Nothing here runs unless HAY_ONCHAIN_ENABLED is set AND the RPC, mint,
 * treasury address and treasury key are all present. CLAUDE.md is explicit
 * that no real $HAY moves without ALFA's sign-off on emission and sinks, so
 * the flag stays off; the treasury key lives in the server environment and is
 * never sent to a client.
 */
import {
  Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction, createTransferCheckedInstruction,
  getAssociatedTokenAddress, getMint,
} from '@solana/spl-token';
import { env, onChainReady } from '../env';
import { errors } from './errors';

let connection: Connection | null = null;
let decimalsCache: number | null = null;
let treasuryCache: Keypair | null = null;

function requireEnabled(): void {
  if (!onChainReady()) throw errors.disabled('On-chain $HAY');
}

export function getConnection(): Connection {
  requireEnabled();
  if (!connection) {
    // Finalized: a deposit credited off a confirmed-but-not-finalized slot can
    // still be rolled back, and this credits real balance.
    connection = new Connection(env.CHAIN_RPC_URL as string, 'finalized');
  }
  return connection;
}

function mint(): PublicKey {
  requireEnabled();
  return new PublicKey(env.HAY_TOKEN_ADDRESS as string);
}

/**
 * The treasury keypair, from its base58 secret key — the format every Solana
 * wallet exports and `solana-keygen` writes. A JSON byte array works too,
 * because that is the other thing people paste.
 */
function treasury(): Keypair {
  requireEnabled();
  if (treasuryCache) return treasuryCache;
  const raw = (env.TREASURY_PRIVATE_KEY as string).trim();
  let secret: Uint8Array;
  if (raw.startsWith('[')) {
    secret = Uint8Array.from(JSON.parse(raw) as number[]);
  } else {
    secret = bs58Decode(raw);
  }
  if (secret.length !== 64) {
    throw new Error(`TREASURY_PRIVATE_KEY decoded to ${secret.length} bytes, expected 64`);
  }
  const pair = Keypair.fromSecretKey(secret);
  // A treasury address that is not the key's own address means a payout would
  // be signed by one account and audited against another.
  if (pair.publicKey.toBase58() !== (env.TREASURY_ADDRESS as string).trim()) {
    throw new Error('TREASURY_ADDRESS is not the address of TREASURY_PRIVATE_KEY');
  }
  treasuryCache = pair;
  return pair;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Same decoder auth/wallet.ts uses, for the same reason: no dependency. */
function bs58Decode(input: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of input) {
    const value = B58.indexOf(ch);
    if (value < 0) throw new Error('TREASURY_PRIVATE_KEY is not base58');
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8 }
  }
  for (const ch of input) { if (ch !== '1') break; bytes.push(0) }
  return Uint8Array.from(bytes.reverse());
}

export async function tokenDecimals(): Promise<number> {
  if (decimalsCache != null) return decimalsCache;
  const info = await getMint(getConnection(), mint());
  decimalsCache = info.decimals;
  return decimalsCache;
}

/** A decimal string to the token's base units, without floats. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ''] = String(amount).trim().split('.');
  if (frac.length > decimals) {
    throw new Error(`amount has more than ${decimals} decimal places`);
  }
  return BigInt(whole || '0') * 10n ** BigInt(decimals)
    + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/** And back, for what the ledger and the player see. */
export function fromBaseUnits(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * Treasury → player. Returns the transaction signature once it is confirmed.
 *
 * The recipient's associated token account is created if they have never held
 * $HAY, paid for by the treasury — a player who just won their first payout
 * does not have an account to receive it into, and refusing them would be the
 * wrong answer to the most common case.
 */
export async function sendHay(to: string, amount: string): Promise<string> {
  requireEnabled();
  const conn = getConnection();
  const payer = treasury();
  const m = mint();
  const decimals = await tokenDecimals();
  const units = toBaseUnits(amount, decimals);
  if (units <= 0n) throw errors.badRequest('Nothing to send');

  const recipient = new PublicKey(to);
  const fromAta = await getAssociatedTokenAddress(m, payer.publicKey);
  const toAta = await getAssociatedTokenAddress(m, recipient);

  const tx = new Transaction();
  if (!(await conn.getAccountInfo(toAta))) {
    tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, toAta, recipient, m));
  }
  tx.add(createTransferCheckedInstruction(
    fromAta, m, toAta, payer.publicKey, units, decimals,
  ));

  return sendAndConfirmTransaction(conn, tx, [payer], {
    commitment: 'finalized',
    maxRetries: 3,
  });
}

export interface DepositCheck {
  ok: boolean;
  reason?: string;
  from?: string;
  amount?: string;
  confirmations?: number;
}

/** The token-balance rows Solana attaches to a transaction. */
export interface TokenBalanceRow {
  accountIndex: number;
  mint: string;
  owner?: string | null;
  uiTokenAmount: { amount: string };
}

export interface TransferMeta {
  preTokenBalances?: TokenBalanceRow[] | null;
  postTokenBalances?: TokenBalanceRow[] | null;
}

/**
 * How much of one mint the treasury gained and the claimed sender lost.
 *
 * Read off balance deltas rather than by decoding instructions: a transfer can
 * arrive through a CPI, a router or a multi-hop swap, and the balances are
 * what actually happened either way. Both sides are reported so the caller can
 * insist on both — otherwise a player could point at somebody else's deposit
 * and claim it.
 *
 * Summed across accounts, because one owner can hold several token accounts
 * for the same mint and a transaction is free to touch more than one.
 */
export function readTransfer(
  meta: TransferMeta,
  who: { mint: string; treasury: string; sender: string },
): { gained: bigint; lost: bigint } {
  const amountsBy = (list: TokenBalanceRow[] | null | undefined) => {
    const out = new Map<number, bigint>();
    for (const b of list ?? []) {
      if (b.mint !== who.mint) continue;
      out.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
    }
    return out;
  };
  const pre = amountsBy(meta.preTokenBalances);
  const post = amountsBy(meta.postTokenBalances);

  // An account that was emptied appears only in pre, one that was created only
  // in post — so the owners come from both sides.
  const ownerOf = new Map<number, string>();
  for (const b of [...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])]) {
    if (b.mint === who.mint && b.owner) ownerOf.set(b.accountIndex, b.owner);
  }

  let gained = 0n;
  let lost = 0n;
  for (const [index, owner] of ownerOf) {
    const delta = (post.get(index) ?? 0n) - (pre.get(index) ?? 0n);
    if (owner === who.treasury) gained += delta;
    if (owner === who.sender) lost += delta;
  }
  return { gained, lost };
}

/**
 * Confirm that `signature` really moved $HAY from `expectedFrom` into the
 * treasury.
 *
 * The amount comes from readTransfer, which insists both sides agree: the
 * treasury gained and the claimed sender lost.
 */
export async function verifyDeposit(signature: string, expectedFrom: string): Promise<DepositCheck> {
  requireEnabled();
  const conn = getConnection();

  const [status] = (await conn.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  })).value;
  if (!status) return { ok: false, reason: 'Transaction not found yet' };
  if (status.err) return { ok: false, reason: 'Transaction failed on chain' };

  // On Solana the meaningful bar is finalisation, not a block count — a
  // finalized slot cannot be rolled back, so the count stops being reported.
  // CHAIN_MIN_CONFIRMATIONS only decides how impatient we are before that.
  const confirmations = status.confirmations ?? undefined;
  const finalized = status.confirmationStatus === 'finalized';
  if (!finalized && (confirmations ?? 0) < env.CHAIN_MIN_CONFIRMATIONS) {
    return { ok: false, reason: 'Not enough confirmations yet', confirmations };
  }

  const tx = await conn.getTransaction(signature, {
    commitment: finalized ? 'finalized' : 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta) return { ok: false, reason: 'Transaction not found yet', confirmations };

  const mintAddress = (env.HAY_TOKEN_ADDRESS as string).trim();
  const treasuryAddress = (env.TREASURY_ADDRESS as string).trim();
  const sender = expectedFrom.trim();

  const decimals = await tokenDecimals();
  const moved = readTransfer(tx.meta, {
    mint: mintAddress, treasury: treasuryAddress, sender,
  });

  if (moved.gained <= 0n) {
    return { ok: false, reason: 'No $HAY transfer to the treasury in that transaction', confirmations };
  }
  if (moved.lost >= 0n) {
    return { ok: false, reason: 'That transaction did not come from your wallet', confirmations };
  }

  return {
    ok: true,
    from: sender,
    // The smaller of the two: whatever the sender actually parted with, and
    // whatever the treasury actually received.
    amount: fromBaseUnits(moved.gained < -moved.lost ? moved.gained : -moved.lost, decimals),
    confirmations,
  };
}
