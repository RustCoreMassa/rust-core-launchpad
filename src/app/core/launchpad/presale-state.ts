import {
  PRESALE_CANCELLED,
  PRESALE_FAILED,
  PRESALE_OPEN,
  PRESALE_SUCCESS,
  Presale,
} from './records';

/**
 * Where a presale stands at `now`. The contract stores only open / success / failed /
 * cancelled; upcoming, live and "ended, waiting to be finalized" follow from the clock.
 */
export type PresalePhase = 'upcoming' | 'live' | 'ended' | 'success' | 'failed' | 'cancelled';

export function presalePhase(p: Presale, now = Date.now()): PresalePhase {
  if (p.status === PRESALE_SUCCESS) return 'success';
  if (p.status === PRESALE_FAILED) return 'failed';
  if (p.status === PRESALE_CANCELLED) return 'cancelled';
  if (p.status !== PRESALE_OPEN) return 'ended';
  if (now < p.start) return 'upcoming';
  if (now >= p.end || p.raised >= p.hardCap) return 'ended';
  return 'live';
}

export const PHASE_LABELS: Record<PresalePhase, string> = {
  upcoming: 'Upcoming',
  live: 'Live',
  ended: 'Ended — awaiting finalization',
  success: 'Successful',
  failed: 'Failed — refunds open',
  cancelled: 'Cancelled — refunds open',
};

/** Raised / hard cap, 0-100, with one decimal. */
export function progressPercent(p: Presale): number {
  if (p.hardCap === 0n) return 0;
  return Number((p.raised * 1_000n) / p.hardCap) / 10;
}

/** Will finalize call it a success (soft cap reached)? */
export function reachesSoftCap(p: Presale): boolean {
  return p.raised > 0n && p.raised >= p.softCap;
}

/** The most MAS `contributed`-so-far wallet may still add now, in nanoMAS. */
export function maxContribution(p: Presale, contributed: bigint): bigint {
  const left = p.hardCap - p.raised;
  const walletLeft = p.maxBuy === 0n ? left : p.maxBuy - contributed;
  return left < walletLeft ? left : walletLeft > 0n ? walletLeft : 0n;
}

/** Why `amount` can't be contributed now, or null — the contract's rules, for the form. */
export function contributionError(
  p: Presale,
  contributed: bigint,
  amount: bigint,
  now = Date.now(),
): string | null {
  if (presalePhase(p, now) !== 'live') return 'This presale is not live.';
  if (amount <= 0n) return 'Enter an amount.';
  const left = p.hardCap - p.raised;
  if (amount > left) return 'Above the amount left before the hard cap.';
  if (p.maxBuy !== 0n && contributed + amount > p.maxBuy) return 'Above the maximum per wallet.';
  if (contributed + amount < p.minBuy && amount !== left) return 'Below the minimum contribution.';
  return null;
}

/** "2d 4h", "3h 12m", "45m" — time left until `target`. */
export function timeLeft(target: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((target - now) / 60_000));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
