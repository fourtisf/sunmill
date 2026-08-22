import { describe, expect, it } from 'vitest';
import { secretMatches } from '../src/lib/secrets';

/**
 * The admin token is the second factor on releasing treasury $HAY. It was
 * compared with `!==`, which returns as soon as two bytes differ; the invite
 * code next door had used timingSafeEqual since it was written.
 */
describe('secretMatches', () => {
  it('accepts the right secret', () => {
    expect(secretMatches('s3cret-token', 's3cret-token')).toBe(true);
  });

  it('rejects a wrong secret of the same length', () => {
    expect(secretMatches('s3cret-tokes', 's3cret-token')).toBe(false);
  });

  it('rejects a prefix, which is what a timing attack builds', () => {
    expect(secretMatches('s3cret', 's3cret-token')).toBe(false);
  });

  it('rejects a longer candidate rather than throwing', () => {
    // timingSafeEqual throws on mismatched lengths; the length check is what
    // keeps that from becoming a 500 on every wrong guess.
    expect(() => secretMatches('s3cret-token-and-more', 's3cret-token')).not.toThrow();
    expect(secretMatches('s3cret-token-and-more', 's3cret-token')).toBe(false);
  });

  it('refuses when nothing is configured, rather than letting everyone in', () => {
    expect(secretMatches('anything', undefined)).toBe(false);
    expect(secretMatches('anything', '')).toBe(false);
  });

  it('refuses when the caller sent nothing', () => {
    expect(secretMatches(undefined, 's3cret-token')).toBe(false);
    expect(secretMatches('', 's3cret-token')).toBe(false);
  });
});
