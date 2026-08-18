/** Content randomness — order boards and market listings. Not security. */
export function randInt(minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(Math.random() * (maxInclusive - minInclusive + 1));
}

export function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
