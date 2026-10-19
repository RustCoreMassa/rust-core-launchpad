// The holder discount's arithmetic (Launchpad v1.4.0, lib/launchpad/discount.ts), kept free of
// Angular so the node scripts in smart-contract/src can use it too.

/** A fee in nanoMAS less `bps` of it, like the contract (the discount is rounded down). */
export function lessDiscount(fee: bigint, bps: number): bigint {
  return fee - (fee * BigInt(bps)) / 10_000n;
}

/** A fee in basis points less `bps` of it, like the contract (the discount is rounded down). */
export function lessDiscountBps(feeBps: number, bps: number): number {
  return feeBps - Math.floor((feeBps * bps) / 10_000);
}
