/**
 * MAS to send with NFT mints. The collection pays the storage of every new entry from its own
 * balance, so the call brings it. Per NFT: its owner entry (33-byte key + address) and its
 * Enumerable index entry (≈ 96-byte key) ≈ 190 bytes → 0.02 MAS. Once per holder: the balance
 * entry and the publicMint counter ≈ 160 bytes → 0.02 MAS. At 0.0001 MAS/byte, rounded up.
 * publicMint refunds what it doesn't use; for owner mints the rest stays in the collection as a
 * storage reserve (it pays for later transfers to new holders).
 */
export const STORAGE_PER_NFT = 20_000_000n; // 0.02 MAS
export const STORAGE_PER_HOLDER = 20_000_000n; // 0.02 MAS
const BYTE = 100_000n; // 0.0001 MAS

export function nftStorage(count: number): bigint {
  return STORAGE_PER_NFT * BigInt(count) + STORAGE_PER_HOLDER;
}

/** publicMint: price × count + storage (the contract refunds the excess). */
export function publicMintCoins(price: bigint, count: number): bigint {
  return price * BigInt(count) + nftStorage(count);
}

/** ownerMintWithURI: one NFT + its own URI entry (9 + 32 + URI bytes + 4). */
export function mintWithUriCoins(uri: string): bigint {
  return nftStorage(1) + BigInt(45 + new TextEncoder().encode(uri).length) * BYTE;
}

/** A setting rewritten in the collection (base URI, mint config): room for a longer value. */
export function settingCoins(text = ''): bigint {
  return 10_000_000n + BigInt(new TextEncoder().encode(text).length) * BYTE;
}
