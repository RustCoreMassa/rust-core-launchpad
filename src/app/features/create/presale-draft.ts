import { Args } from '@massalabs/massa-web3';
import { parseSupply } from '../../core/launchpad/launch-rules';
import { tokensFor } from '../../core/launchpad/records';
import { priceNano } from './collection-draft';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** What the presale form collects; amounts as typed, in whole tokens and MAS. */
export interface PresaleDraft {
  /** Tokens per 1 MAS. */
  rate: string;
  softCap: string;
  hardCap: string;
  minBuy: string;
  /** Empty = no limit. */
  maxBuy: string;
  /** 'now' or a datetime-local value. */
  start: 'now' | string;
  /** Duration in hours (1 to 720). */
  hours: number;
}

export const EMPTY_PRESALE_DRAFT: PresaleDraft = {
  rate: '',
  softCap: '',
  hardCap: '',
  minBuy: '',
  maxBuy: '',
  start: 'now',
  hours: 72,
};

export type PresaleField = 'rate' | 'softCap' | 'hardCap' | 'minBuy' | 'maxBuy' | 'start' | 'hours';

export interface PresaleTerms {
  /** Token units per 1 MAS. */
  rate: bigint;
  softCap: bigint;
  hardCap: bigint;
  minBuy: bigint;
  maxBuy: bigint;
  /** ms; 0 = start now (the contract starts it when the transaction runs). */
  start: number;
  end: number;
  /** Token units to escrow: exactly what the hard cap sells. */
  tokensForSale: bigint;
}

/** The draft as contract values, or the errors per field. */
export function presaleTerms(
  d: PresaleDraft,
  decimals: number,
  now = Date.now(),
): { terms: PresaleTerms | null; errors: Partial<Record<PresaleField, string>> } {
  const errors: Partial<Record<PresaleField, string>> = {};
  const rate = parseSupply(d.rate, decimals);
  if (rate === null || rate <= 0n) errors.rate = 'Enter how many tokens 1 MAS buys.';
  const soft = priceNano(d.softCap);
  const hard = priceNano(d.hardCap);
  const min = priceNano(d.minBuy);
  const max = d.maxBuy.trim() === '' ? 0n : priceNano(d.maxBuy);
  if (hard === null || hard <= 0n) errors.hardCap = 'Enter the most MAS to raise.';
  if (soft === null) errors.softCap = 'Enter the MAS needed for success (0 allowed).';
  else if (hard !== null && soft > hard) errors.softCap = 'Must not exceed the hard cap.';
  if (min === null) errors.minBuy = 'Enter a number (0 allowed).';
  else if (hard !== null && min > hard) errors.minBuy = 'Must not exceed the hard cap.';
  if (max === null) errors.maxBuy = 'Enter a number, or leave it empty.';
  else if (max !== 0n && min !== null && min > max) errors.maxBuy = 'Must be at least the minimum.';
  let start = 0;
  if (d.start !== 'now') {
    start = new Date(d.start).getTime();
    if (!Number.isFinite(start) || start <= now) errors.start = 'Pick a moment in the future.';
    else if (start - now > 90 * DAY) errors.start = 'Start within the next 90 days.';
  }
  if (!Number.isInteger(d.hours) || d.hours < 1 || d.hours > 720)
    errors.hours = 'From 1 hour to 30 days (720 hours).';
  if (Object.keys(errors).length || rate === null || hard === null || soft === null) {
    return { terms: null, errors };
  }
  const begin = start || now;
  // A few minutes of slack when starting now: the transaction runs a little later.
  const end = begin + d.hours * HOUR + (start ? 0 : 10 * 60_000);
  return {
    terms: {
      rate,
      softCap: soft,
      hardCap: hard,
      minBuy: min ?? 0n,
      maxBuy: max ?? 0n,
      start,
      end,
      tokensForSale: tokensFor(hard, rate),
    },
    errors,
  };
}

/** createPresale arguments, in the contract's order. */
export function createPresaleArgs(token: string, t: PresaleTerms): Args {
  return new Args()
    .addString(token)
    .addU256(t.tokensForSale)
    .addU256(t.rate)
    .addU64(t.softCap)
    .addU64(t.hardCap)
    .addU64(t.minBuy)
    .addU64(t.maxBuy)
    .addU64(BigInt(t.start))
    .addU64(BigInt(t.end));
}
