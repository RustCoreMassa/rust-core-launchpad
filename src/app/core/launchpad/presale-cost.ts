/**
 * MAS sent with presale calls; the Launchpad refunds what it doesn't use. Measured on buildnet
 * (2026-10-05): a first contribution stores ≈ 0.0245 MAS; token transfers carry 0.01 MAS for
 * the receiver's balance entry in the token.
 */
export const ALLOWANCE_COINS = 20_000_000n; // 0.02 MAS, kept by the token for the allowance entry
export const CREATE_PRESALE_COINS = 200_000_000n; // 0.2 MAS
export const CONTRIBUTE_MARGIN = 50_000_000n; // 0.05 MAS on top of the amount
export const FINALIZE_COINS = 50_000_000n;
export const CLAIM_COINS = 50_000_000n;
export const WITHDRAW_COINS = 20_000_000n;
export const CANCEL_COINS = 50_000_000n;
