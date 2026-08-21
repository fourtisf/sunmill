/**
 * The two things in the chain module that can be wrong without anyone noticing
 * until real money is gone: turning a decimal string into base units, and
 * deciding whose deposit a transaction was.
 *
 * The RPC itself is not under test — that needs a chain. What is under test is
 * everything that decides how much and for whom, which is the part a bug would
 * make expensive.
 */
import { describe, expect, it } from 'vitest';
import { fromBaseUnits, readTransfer, toBaseUnits } from '../src/lib/chain';

describe('base units', () => {
  it('converts without floats', () => {
    expect(toBaseUnits('1', 9)).toBe(1_000_000_000n);
    expect(toBaseUnits('0.1', 9)).toBe(100_000_000n);
    expect(toBaseUnits('12.345678901', 9)).toBe(12_345_678_901n);
    // The one 0.1 + 0.2 would get wrong.
    expect(toBaseUnits('0.3', 9)).toBe(toBaseUnits('0.1', 9) + toBaseUnits('0.2', 9));
  });

  it('handles the shapes a ledger actually holds', () => {
    expect(toBaseUnits('0', 6)).toBe(0n);
    expect(toBaseUnits('0.000001', 6)).toBe(1n);
    expect(toBaseUnits('  2.50  ', 6)).toBe(2_500_000n);
    expect(toBaseUnits('.5', 6)).toBe(500_000n);
  });

  it('refuses precision the token cannot hold', () => {
    // Silently truncating here is how a withdrawal pays out less than the
    // ledger says it did.
    expect(() => toBaseUnits('0.0000001', 6)).toThrow(/decimal places/);
  });

  it('round-trips', () => {
    for (const [amount, decimals] of [['1', 9], ['0.1', 9], ['1234.56789', 6], ['0', 6]] as const) {
      expect(fromBaseUnits(toBaseUnits(amount, decimals), decimals))
        .toBe(String(Number(amount)));
    }
  });

  it('prints without trailing zeros or a bare point', () => {
    expect(fromBaseUnits(1_000_000_000n, 9)).toBe('1');
    expect(fromBaseUnits(1_500_000_000n, 9)).toBe('1.5');
    expect(fromBaseUnits(1n, 9)).toBe('0.000000001');
    expect(fromBaseUnits(0n, 9)).toBe('0');
  });
});

/* ================= WHOSE DEPOSIT WAS IT ================= */

const HAY = 'HAYmint1111111111111111111111111111111111111';
const OTHER = 'OTHERmint111111111111111111111111111111111111';
const TREASURY = 'Treasury11111111111111111111111111111111111';
const ALICE = 'Alice1111111111111111111111111111111111111';
const BOB = 'Bob111111111111111111111111111111111111111';

const row = (accountIndex: number, owner: string, amount: string, mint = HAY) =>
  ({ accountIndex, mint, owner, uiTokenAmount: { amount } });

const who = { mint: HAY, treasury: TREASURY, sender: ALICE };

describe('readTransfer', () => {
  it('reads a plain deposit off the balance deltas', () => {
    const moved = readTransfer({
      preTokenBalances: [row(1, ALICE, '5000000'), row(2, TREASURY, '0')],
      postTokenBalances: [row(1, ALICE, '2000000'), row(2, TREASURY, '3000000')],
    }, who);
    expect(moved.gained).toBe(3_000_000n);
    expect(moved.lost).toBe(-3_000_000n);
  });

  it('ignores every other token in the transaction', () => {
    // A swap that happens to touch the treasury in some other mint must not
    // read as a $HAY deposit.
    const moved = readTransfer({
      preTokenBalances: [row(1, ALICE, '1000', OTHER), row(2, TREASURY, '0', OTHER)],
      postTokenBalances: [row(1, ALICE, '0', OTHER), row(2, TREASURY, '1000', OTHER)],
    }, who);
    expect(moved.gained).toBe(0n);
    expect(moved.lost).toBe(0n);
  });

  it('will not let one player claim another player\'s deposit', () => {
    // Bob paid the treasury; Alice submits his signature. The treasury gained,
    // so gained alone would have credited her — lost is what stops it.
    const moved = readTransfer({
      preTokenBalances: [row(1, BOB, '5000000'), row(2, TREASURY, '0')],
      postTokenBalances: [row(1, BOB, '0'), row(2, TREASURY, '5000000')],
    }, who);
    expect(moved.gained).toBe(5_000_000n);
    expect(moved.lost).toBe(0n);   // caller refuses on this
  });

  it('sees an account that did not exist before the transaction', () => {
    // The treasury's token account created in the same transaction: no pre row
    // at all, and treating a missing row as anything but zero loses the whole
    // deposit.
    const moved = readTransfer({
      preTokenBalances: [row(1, ALICE, '900')],
      postTokenBalances: [row(1, ALICE, '0'), row(2, TREASURY, '900')],
    }, who);
    expect(moved.gained).toBe(900n);
    expect(moved.lost).toBe(-900n);
  });

  it('sums an owner who holds more than one account for the mint', () => {
    const moved = readTransfer({
      preTokenBalances: [row(1, ALICE, '400'), row(2, ALICE, '600'), row(3, TREASURY, '0')],
      postTokenBalances: [row(1, ALICE, '0'), row(2, ALICE, '0'), row(3, TREASURY, '1000')],
    }, who);
    expect(moved.gained).toBe(1000n);
    expect(moved.lost).toBe(-1000n);
  });

  it('reports a withdrawal as the treasury losing, not gaining', () => {
    // A player replaying the signature of their own payout as a deposit.
    const moved = readTransfer({
      preTokenBalances: [row(1, TREASURY, '1000'), row(2, ALICE, '0')],
      postTokenBalances: [row(1, TREASURY, '0'), row(2, ALICE, '1000')],
    }, who);
    expect(moved.gained).toBe(-1000n);
    expect(moved.lost).toBe(1000n);
  });

  it('survives a transaction with no token balances at all', () => {
    expect(readTransfer({}, who)).toEqual({ gained: 0n, lost: 0n });
    expect(readTransfer({ preTokenBalances: null, postTokenBalances: null }, who))
      .toEqual({ gained: 0n, lost: 0n });
  });
});
