import { StorageCost } from '@massalabs/massa-web3';

/**
 * Upper bound for the record, its indexes and the event of a launch or import — a few hundred
 * bytes at 0.0001 MAS each. Whatever isn't used comes back: the Launchpad refunds the excess.
 */
export const RECORD_MARGIN = 300_000_000n; // 0.3 MAS

export interface LaunchCost {
  /** Platform fee, nanoMAS. */
  fee: bigint;
  /** Storage of the new contract: its bytecode + account, nanoMAS. */
  contract: bigint;
  /** Given to the new contract for its own storage, nanoMAS. */
  deposit: bigint;
  /** Record + indexes, upper bound (refunded if unused), nanoMAS. */
  margin: bigint;
  /** What the transaction sends. */
  total: bigint;
}

export function launchCost(fee: bigint, deposit: bigint, templateBytes: number): LaunchCost {
  const contract = StorageCost.smartContractDeploy(templateBytes);
  return {
    fee,
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
