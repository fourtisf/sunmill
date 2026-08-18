import type { Tx } from '../lib/db';
import type { FarmState } from './farm';

/** The slice of an action context the board upkeep needs. */
export interface ActionLike {
  tx: Tx;
  now: Date;
  state: FarmState;
}
