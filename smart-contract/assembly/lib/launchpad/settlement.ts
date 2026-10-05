// Money in and out of a Launchpad call. Every write is paid by its caller: the MAS sent must
// cover the platform fee plus whatever the call consumed from the contract's balance (storage
// of new entries, a new contract's bytecode, the deposit given to it). The rest is refunded.
// Storage freed by the call (a deleted entry) is refunded too.
//
// Escrow moves are not the caller's cost: `kept` is MAS the caller sent on purpose to stay in
// the contract (a presale contribution), `released` is MAS the call paid out of escrow (a
// refund, the raised MAS to the presale owner).
//
// `before` is read at the very start of the call, when the coins sent are already credited.
import { bytesToU64, u64ToBytes } from '@massalabs/as-types';
import { Context, Storage, balance, transferCoins } from '@massalabs/massa-as-sdk';
import { FEES_KEY } from './keys';

export function settle(before: u64, fee: u64, kept: u64 = 0, released: u64 = 0): void {
  // Recorded first, so the fee counter's own storage is part of what the caller pays.
  if (fee > 0) Storage.set(FEES_KEY, u64ToBytes(accruedFees() + fee));
  const after = balance();
  const sent = i64(Context.transferredCoins());
  // What the call itself consumed (negative when it freed storage).
  const consumed = i64(before) - i64(after) - i64(released);
  const owed = consumed + i64(fee) + i64(kept);
  assert(sent >= owed, 'Not enough MAS for the fee and storage');
  const refund = sent - owed;
  if (refund > 0) transferCoins(Context.caller(), u64(refund));
}

/** Platform fees collected and not yet withdrawn — the only MAS the admin may take out. */
export function accruedFees(): u64 {
  return Storage.has(FEES_KEY) ? bytesToU64(Storage.get(FEES_KEY)) : 0;
}

/** Adds a fee taken out of escrow (not paid by the caller), e.g. the presale fee. */
export function addFee(fee: u64): void {
  if (fee > 0) Storage.set(FEES_KEY, u64ToBytes(accruedFees() + fee));
}
