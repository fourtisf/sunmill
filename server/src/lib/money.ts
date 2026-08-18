/**
 * Money helpers. Coins are BigInt, hay is a fixed-point Decimal carried as a
 * string with 2 decimal places — never a float (CLAUDE.md golden rule 6).
 */
import { Prisma } from '@prisma/client';

export const HAY_DP = 2;
const SCALE = 100n;

/** Parse any hay-ish value into hundredths of a hay. Throws on nonsense. */
export function hayToUnits(value: string | number | Prisma.Decimal): bigint {
  const s = typeof value === 'string' ? value.trim() : String(value);
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`invalid hay amount: ${s}`);
  const neg = s.startsWith('-');
  const [intPart, fracPart = ''] = (neg ? s.slice(1) : s).split('.');
  const frac = (fracPart + '00').slice(0, HAY_DP);
  const units = BigInt(intPart) * SCALE + BigInt(frac || '0');
  return neg ? -units : units;
}

export function unitsToHay(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(HAY_DP, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** Round a computed hay reward the way the prototype does: 2 decimal places. */
export function roundHay(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`invalid hay reward: ${value}`);
  return (Math.round(value * 100) / 100).toFixed(HAY_DP);
}

export function decimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(typeof value === 'number' ? value.toFixed(HAY_DP) : value);
}

export function hayString(value: Prisma.Decimal | string | number): string {
  return unitsToHay(hayToUnits(value));
}
