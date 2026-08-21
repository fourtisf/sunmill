/**
 * The audit trail. Every economic mutation writes exactly one row, inside the
 * same transaction as the mutation (CLAUDE.md golden rule 3) — if the ledger
 * write fails, the whole action rolls back.
 */
import { Prisma } from '@prisma/client';
import type { Tx } from './db';
import { decimal } from './money';

export type LedgerKind =
  | 'plant' | 'harvest' | 'craft' | 'collect' | 'feed' | 'produce'
  | 'sell' | 'buy' | 'order' | 'order_skip' | 'expand' | 'levelup'
  | 'speedup' | 'upgrade' | 'task_reward' | 'task_bonus' | 'streak'
  | 'hay_withdraw' | 'hay_deposit'
  | 'gift_send' | 'gift_claim';

export interface LedgerInput {
  userId: string;
  kind: LedgerKind;
  detail: Prisma.InputJsonValue;
  coinsDelta?: bigint;
  hayDelta?: string;
  xpDelta?: number;
  status?: 'pending' | 'settled' | 'failed';
}

export async function writeLedger(tx: Tx, input: LedgerInput) {
  return tx.ledger.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      detail: input.detail,
      coinsDelta: input.coinsDelta ?? 0n,
      hayDelta: decimal(input.hayDelta ?? '0'),
      xpDelta: input.xpDelta ?? 0,
      status: input.status ?? 'settled',
    },
  });
}
