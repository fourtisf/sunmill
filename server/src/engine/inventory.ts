/**
 * Pure inventory maths. The silo holds crops, the barn holds goods; an item can
 * only be added when its store has room (HANDOFF §6).
 */
import { storeOf } from '../config/gamedata';

export type Inventory = Record<string, number>;
export type Store = 'silo' | 'barn';

export interface Caps {
  siloCap: number;
  barnCap: number;
}

export function used(inv: Inventory, store: Store): number {
  let n = 0;
  for (const id of Object.keys(inv)) {
    const qty = inv[id];
    if (qty > 0 && storeOf(id) === store) n += qty;
  }
  return n;
}

export function capOf(caps: Caps, store: Store): number {
  return store === 'silo' ? caps.siloCap : caps.barnCap;
}

/** Free units left in the store this item belongs to. */
export function spaceFor(inv: Inventory, caps: Caps, itemId: string): number {
  const store = storeOf(itemId);
  return Math.max(0, capOf(caps, store) - used(inv, store));
}

export function qtyOf(inv: Inventory, itemId: string): number {
  return inv[itemId] ?? 0;
}

export function hasAll(inv: Inventory, need: Record<string, number>): boolean {
  for (const id of Object.keys(need)) {
    if (qtyOf(inv, id) < need[id]) return false;
  }
  return true;
}

/**
 * Add up to `n` units, clamped by remaining space. Mutates `inv`.
 * Returns how many actually fit — callers must treat a short add as a
 * partial success (the prototype's "silo nearly full" behaviour).
 */
export function give(inv: Inventory, caps: Caps, itemId: string, n: number): number {
  if (n <= 0) return 0;
  const add = Math.min(n, spaceFor(inv, caps, itemId));
  if (add > 0) inv[itemId] = qtyOf(inv, itemId) + add;
  return add;
}

/** Remove exactly `n` units. Mutates `inv`. Returns false and changes nothing
 *  when the player does not have them. */
export function take(inv: Inventory, itemId: string, n: number): boolean {
  if (n <= 0) return true;
  if (qtyOf(inv, itemId) < n) return false;
  inv[itemId] -= n;
  if (inv[itemId] <= 0) delete inv[itemId];
  return true;
}

/** Atomically consume a whole ingredient map, or nothing at all. */
export function takeAll(inv: Inventory, need: Record<string, number>): boolean {
  if (!hasAll(inv, need)) return false;
  for (const id of Object.keys(need)) take(inv, id, need[id]);
  return true;
}

export function cloneInventory(inv: Inventory): Inventory {
  return { ...inv };
}

/** Item ids whose quantity differs between two snapshots (for minimal writes). */
export function inventoryDiff(before: Inventory, after: Inventory): string[] {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const id of ids) {
    if ((before[id] ?? 0) !== (after[id] ?? 0)) changed.push(id);
  }
  return changed;
}
