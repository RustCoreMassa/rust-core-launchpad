import { StorageCost } from '@massalabs/massa-web3';
import { lessDiscount } from './discount';

/**
 * Upper bound for the record, its indexes and the event of a launch or import — a few hundred
 * bytes at 0.0001 MAS each. Whatever isn't used comes back: the Launchpad refunds the excess.
 */
export const RECORD_MARGIN = 300_000_000n; // 0.3 MAS

export interface LaunchCost {
  /** Platform fee the caller pays (after the holder discount), nanoMAS. */
  fee: bigint;
  /** Platform fee without the discount, nanoMAS. */
  fullFee: bigint;
  /** Holder discount applied to the fee, basis points (0 = none). */
  discountBps: number;
  /** Storage of the new contract: its bytecode + account, nanoMAS. */
  contract: bigint;
  /** Given to the new contract for its own storage, nanoMAS. */
  deposit: bigint;
  /** Record + indexes, upper bound (refunded if unused), nanoMAS. */
  margin: bigint;
  /** What the transaction sends. */
  total: bigint;
}

export function launchCost(
  fullFee: bigint,
  deposit: bigint,
  templateBytes: number,
  discountBps = 0,
): LaunchCost {
  const contract = StorageCost.smartContractDeploy(templateBytes);
  const fee = lessDiscount(fullFee, discountBps);
  return {
    fee,
    fullFee,
    discountBps,
    contract,
    deposit,
    margin: RECORD_MARGIN,
    total: fee + contract + deposit + RECORD_MARGIN,
  };
}

/** An import or an edit: the fee (0 for edits) plus the record margin. */
export function recordCost(fee: bigint): bigint {
  return fee + RECORD_MARGIN;
}
