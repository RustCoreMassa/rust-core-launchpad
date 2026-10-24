import { MintInfo } from './collection-reader';
import { lessDiscount } from './discount';
import { LaunchpadConfig } from './records';

/** How far the mint of a collection is: for the progress bar on the home page. */
export interface MintProgress {
  minted: bigint;
  maxSupply: bigint;
  /** 0-100, two decimals, rounded down (100 only when sold out). */
  percent: number;
  left: bigint;
  soldOut: boolean;
}

export function mintProgress(mint: MintInfo): MintProgress {
  const { minted, maxSupply } = mint;
  const percent = maxSupply ? Number((minted * 10_000n) / maxSupply) / 100 : 0;
  const left = maxSupply > minted ? maxSupply - minted : 0n;
  return { minted, maxSupply, percent, left, soldOut: left === 0n };
}

/** A fee with and without the holder discount, for the benefits list. */
export interface FeeSaving {
  label: string;
  full: bigint;
  held: bigint;
}

/** What a holder pays on the fixed fees, given the Launchpad's config and the discount. */
export function feeSavings(config: LaunchpadConfig, bps: number): FeeSaving[] {
  return [
    { label: 'Token launch', full: config.tokenFee },
    { label: 'Collection launch', full: config.collectionFee },
    { label: 'Import', full: config.importFee },
  ].map((fee) => ({ ...fee, held: lessDiscount(fee.full, bps) }));
}
