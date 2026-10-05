// u256 helpers that as-bignum 0.3 lacks (its u256 has no division).
import { u128, u256 } from 'as-bignum/assembly';

/** a / d, rounded down: long division over the four 64-bit limbs, using u128 steps. */
export function divU256ByU64(a: u256, d: u64): u256 {
  assert(d > 0, 'Division by zero');
  const divisor = u128.fromU64(d);
  const limbs: u64[] = [a.hi2, a.hi1, a.lo2, a.lo1]; // most significant first
  const quotient: u64[] = [0, 0, 0, 0];
  let remainder: u64 = 0;
  for (let i = 0; i < 4; i++) {
    // remainder < d < 2^64, so (remainder:limb) / d fits in 64 bits.
    const current = new u128(limbs[i], remainder);
    quotient[i] = u128.div(current, divisor).lo;
    remainder = u128.rem(current, divisor).lo;
  }
  return new u256(quotient[3], quotient[2], quotient[1], quotient[0]);
}
