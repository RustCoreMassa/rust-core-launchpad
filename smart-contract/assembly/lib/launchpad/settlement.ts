// Money in and out of a Launchpad call. Every write is paid by its caller: the MAS sent must
// cover the platform fee plus whatever the call consumed from the contract's balance (storage
// of new entries, a new contract's bytecode, the deposit given to it). The rest is refunded.
// Storage freed by the call (a deleted entry) is refunded too.
//
// `before` is read at the very start of the call, when the coins sent are already credited.
import { bytesToU64, u64ToBytes } from '@massalabs/as-types';
import { Context, Storage, balance, transferCoins } from '@massalabs/massa-as-sdk';
import { FEES_KEY } from './keys';

export function settle(before: u64, fee: u64): void {
  // Recorded first, so the fee counter's own storage is part of what the caller pays.
  if (fee > 0) Storage.set(FEES_KEY, u64ToBytes(accruedFees() + fee));
  const after = balance();
  const sent = Context.transferredCoins();
  let refund: u64;
  if (after <= before) {
    const spent = before - after;
    assert(sent >= spent && sent - spent >= fee, 'Not enough MAS for the fee and storage');
    refund = sent - spent - fee;
  } else {
    const freed = after - before;
    assert(sent + freed >= fee, 'Not enough MAS for the fee');
    refund = sent + freed - fee;
  }
  if (refund > 0) transferCoins(Context.caller(), refund);
}

/** Platform fees collected and not yet withdrawn — the only MAS the admin may take out. */
export function accruedFees(): u64 {
  return Storage.has(FEES_KEY) ? bytesToU64(Storage.get(FEES_KEY)) : 0;
}
