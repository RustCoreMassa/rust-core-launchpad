/**
 * MAS sent with marketplace calls. The Launchpad refunds what it doesn't use (list, buy, cancel);
 * the collection keeps what an approval doesn't use as its storage reserve.
 * Measured on buildnet (2026-10-04): a listing stores ≈ 0.035 MAS, a purchase ≈ 0.056 MAS on top
 * of the price (sale record, stats, the buyer's entries in the collection).
 */
export const LIST_COINS = 100_000_000n; // 0.1 MAS
export const APPROVE_COINS = 20_000_000n; // 0.02 MAS
export const BUY_MARGIN = 150_000_000n; // 0.15 MAS

export function buyCoins(price: bigint): bigint {
  return price + BUY_MARGIN;
}

/** Royalty in nanoMAS for a price, like the contract computes it (rounded down). */
export function royaltyOf(price: bigint, bps: number): bigint {
  return (price * BigInt(bps)) / 10_000n;
}
