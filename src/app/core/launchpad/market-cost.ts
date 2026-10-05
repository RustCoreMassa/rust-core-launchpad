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

/** A share in basis points of a price (royalty, fee), like the contract computes it (rounded down). */
export function royaltyOf(price: bigint, bps: number): bigint {
  return (price * BigInt(bps)) / 10_000n;
}

/** What a sale splits into: the creator's royalty, the marketplace fee, the seller's part. */
export function saleSplit(
  price: bigint,
  royaltyBps: number,
  feeBps: number,
): { royalty: bigint; fee: bigint; seller: bigint } {
  const royalty = royaltyOf(price, royaltyBps);
  const fee = royaltyOf(price, feeBps);
  return { royalty, fee, seller: price - royalty - fee };
}
