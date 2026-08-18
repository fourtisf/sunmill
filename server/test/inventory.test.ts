import { describe, expect, it } from 'vitest';
import { give, hasAll, spaceFor, take, takeAll, used } from '../src/engine/inventory';

const caps = { siloCap: 10, barnCap: 5 };

describe('inventory', () => {
  it('counts crops against the silo and goods against the barn', () => {
    const inv = { wheat: 4, corn: 2, bread: 3 };
    expect(used(inv, 'silo')).toBe(6);
    expect(used(inv, 'barn')).toBe(3);
    expect(spaceFor(inv, caps, 'wheat')).toBe(4);
    expect(spaceFor(inv, caps, 'bread')).toBe(2);
  });

  it('clamps a give to the space left and reports the short add', () => {
    const inv = { wheat: 8 };
    expect(give(inv, caps, 'wheat', 5)).toBe(2);
    expect(inv.wheat).toBe(10);
    expect(give(inv, caps, 'corn', 1)).toBe(0);
  });

  it('take is all-or-nothing and prunes empty stacks', () => {
    const inv: Record<string, number> = { wheat: 2 };
    expect(take(inv, 'wheat', 3)).toBe(false);
    expect(inv.wheat).toBe(2);
    expect(take(inv, 'wheat', 2)).toBe(true);
    expect(inv.wheat).toBeUndefined();
  });

  it('takeAll consumes a whole recipe or nothing', () => {
    const inv: Record<string, number> = { wheat: 3, corn: 1 };
    expect(takeAll(inv, { wheat: 2, corn: 2 })).toBe(false);
    expect(inv).toEqual({ wheat: 3, corn: 1 });
    expect(takeAll(inv, { wheat: 2, corn: 1 })).toBe(true);
    expect(inv).toEqual({ wheat: 1 });
  });

  it('hasAll checks every ingredient', () => {
    expect(hasAll({ wheat: 2 }, { wheat: 2 })).toBe(true);
    expect(hasAll({ wheat: 2 }, { wheat: 2, corn: 1 })).toBe(false);
  });
});
