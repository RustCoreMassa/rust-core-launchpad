import { u256 } from 'as-bignum/assembly';
import { divU256ByU64 } from '../lib/launchpad/math';

/** q = a / d is right when q·d ≤ a < (q + 1)·d. */
function exact(a: u256, d: u64): bool {
  const q = divU256ByU64(a, d);
  const D = u256.fromU64(d);
  return q * D <= a && a - q * D < D;
}

describe('divU256ByU64', () => {
  test('small numbers', () => {
    expect(divU256ByU64(u256.fromU64(10), 3)).toBe(u256.fromU64(3));
    expect(divU256ByU64(u256.fromU64(999_999_999), 1_000_000_000)).toBe(u256.Zero);
    expect(divU256ByU64(u256.Zero, 7)).toBe(u256.Zero);
  });

  test('large numbers across every limb', () => {
    expect(exact(new u256(123, 456, 789, 0xffff_ffff), 1_000_000_000)).toBe(true);
    expect(exact(u256.Max, 1_000_000_000)).toBe(true);
    expect(exact(u256.Max, 0xffff_ffff_ffff_ffff)).toBe(true);
    expect(exact(new u256(0, 0, 0, 1), 3)).toBe(true);
  });

  test('a token amount: 2.5 MAS at 1 000 tokens/MAS with 18 decimals', () => {
    const rate = u256.fromU64(1_000) * u256.fromU64(1_000_000_000_000_000_000);
    const tokens = divU256ByU64(u256.fromU64(2_500_000_000) * rate, 1_000_000_000);
    expect(tokens).toBe(u256.fromU64(2_500) * u256.fromU64(1_000_000_000_000_000_000));
  });

  throws('a division by zero', () => {
    divU256ByU64(u256.One, 0);
  });
});
