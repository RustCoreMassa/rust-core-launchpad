import { Args } from '@massalabs/massa-web3';
import {
  MAX_COLLECTION_SUPPLY,
  MAX_ROYALTY_BPS,
  categoryError,
  infoErrors,
  nameError,
  urlError,
} from '../../core/launchpad/launch-rules';
import { EMPTY_INFO, KIND_COLLECTION, ProjectInfo, writeInfo } from '../../core/launchpad/records';
import { toUnits } from '../../core/utils/token-amount';

/** 'folder': one IPFS folder with 1.json, 2.json…; 'perToken': each NFT gets its URI at mint. */
export type MetadataMode = 'folder' | 'perToken';

export interface CollectionDraft {
  name: string;
  symbol: string;
  /** Whole number, as typed. */
  maxSupply: string;
  metadataMode: MetadataMode;
  baseURI: string;
  publicMint: boolean;
  /** MAS per NFT, as typed. */
  mintPrice: string;
  /** As typed; empty or 0 = no limit. */
  maxPerWallet: string;
  /** Percent, as typed ("5", "2.5"). */
  royalty: string;
  /** Empty = the creator. */
  royaltyReceiver: string;
  mutable: boolean;
  category: number;
  info: ProjectInfo;
}

export const EMPTY_COLLECTION_DRAFT: CollectionDraft = {
  name: '',
  symbol: '',
  maxSupply: '',
  metadataMode: 'folder',
  baseURI: '',
  publicMint: false,
  mintPrice: '',
  maxPerWallet: '',
  royalty: '5',
  royaltyReceiver: '',
  mutable: false,
  category: 0,
  info: EMPTY_INFO,
};

export const COLLECTION_STEPS = [
  'Identity',
  'Supply & metadata',
  'Mint & royalty',
  'Presentation',
  'Review',
] as const;

export type CollectionField =
  | 'name'
  | 'symbol'
  | 'maxSupply'
  | 'baseURI'
  | 'mintPrice'
  | 'maxPerWallet'
  | 'royalty'
  | 'royaltyReceiver'
  | 'category';
export type CollectionErrors = Partial<Record<CollectionField, string>>;

const STEP_FIELDS: CollectionField[][] = [
  ['name', 'symbol'],
  ['maxSupply', 'baseURI'],
  ['mintPrice', 'maxPerWallet', 'royalty', 'royaltyReceiver'],
  ['category'],
  [],
];

const ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;
const U32_MAX = 4_294_967_295;

/** Collection symbols follow the format rule only (reserved symbols concern tokens). */
function collectionSymbolError(symbol: string): string | null {
  if (symbol.length < 2 || symbol.length > 10) return 'Use 2 to 10 characters.';
  if (!/^[A-Z0-9]+$/.test(symbol)) return 'Use only letters A-Z and digits 0-9.';
  return null;
}

export function maxSupplyValue(text: string): number | null {
  const clean = text.trim().replace(/[ _,]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  return Number(clean);
}

/** Percent with up to 2 decimals → basis points; null when invalid. */
export function royaltyBps(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (clean === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** MAS with up to 9 decimals → nanoMAS; null when invalid. */
export function priceNano(text: string): bigint | null {
  const clean = text.trim().replace(',', '.');
  if (clean === '') return 0n;
  if (!/^\d+(\.\d{1,9})?$/.test(clean)) return null;
  const value = toUnits(clean, 9);
  return value < 2n ** 64n ? value : null;
}

export function maxPerWalletValue(text: string): number | null {
  const clean = text.trim();
  if (clean === '') return 0;
  if (!/^\d+$/.test(clean)) return null;
  const value = Number(clean);
  return value <= U32_MAX ? value : null;
}

export function collectionErrors(d: CollectionDraft): CollectionErrors {
  const errors: CollectionErrors = {};
  const set = (field: CollectionField, error: string | null) => error && (errors[field] = error);
  set('name', nameError(d.name));
  set('symbol', collectionSymbolError(d.symbol));
  const max = maxSupplyValue(d.maxSupply);
  set(
    'maxSupply',
    max === null || max < 1 || max > MAX_COLLECTION_SUPPLY
      ? 'Use a whole number from 1 to 100,000.'
      : null,
  );
  if (d.metadataMode === 'folder') {
    set('baseURI', d.baseURI === '' ? 'Enter the folder link.' : urlError(d.baseURI));
  }
  if (d.publicMint) {
    set(
      'mintPrice',
      priceNano(d.mintPrice) === null ? 'Enter a price in MAS, like 2 or 0.5.' : null,
    );
    set(
      'maxPerWallet',
      maxPerWalletValue(d.maxPerWallet) === null ? 'Enter a whole number.' : null,
    );
  }
  const bps = royaltyBps(d.royalty);
  set('royalty', bps === null || bps > MAX_ROYALTY_BPS ? 'Use 0 to 10, up to 2 decimals.' : null);
  set(
    'royaltyReceiver',
    d.royaltyReceiver !== '' && !ADDRESS.test(d.royaltyReceiver) ? 'Enter a Massa address.' : null,
  );
  set('category', categoryError(KIND_COLLECTION, d.category));
  return errors;
}

export function collectionStepValid(step: number, d: CollectionDraft): boolean {
  const errors = collectionErrors(d);
  if (STEP_FIELDS[step]?.some((field) => errors[field])) return false;
  if (step === 3) return Object.keys(infoErrors(d.info)).length === 0;
  if (step === 4) return [0, 1, 2, 3].every((s) => collectionStepValid(s, d));
  return true;
}

/** Public mint needs a base URI: per-NFT metadata is set by the owner at each mint. */
export function canMintPublicly(d: CollectionDraft): boolean {
  return d.metadataMode === 'folder';
}

/**
 * createCollection arguments, in the contract's order: name, symbol, maxSupply, baseURI,
 * mintPrice, maxPerWallet, publicMint, mutable, royaltyBps, royaltyReceiver, category, info.
 */
export function createCollectionArgs(d: CollectionDraft): Args {
  const max = maxSupplyValue(d.maxSupply);
  const bps = royaltyBps(d.royalty);
  const publicMint = d.publicMint && canMintPublicly(d);
  const price = publicMint ? priceNano(d.mintPrice) : 0n;
  const perWallet = publicMint ? maxPerWalletValue(d.maxPerWallet) : 0;
  if (max === null || bps === null || price === null || perWallet === null)
    throw new Error('The draft is not valid.');
  return writeInfo(
    new Args()
      .addString(d.name)
      .addString(d.symbol)
      .addU256(BigInt(max))
      .addString(d.metadataMode === 'folder' ? d.baseURI : '')
      .addU64(price)
      .addU32(BigInt(perWallet))
      .addBool(publicMint)
      .addBool(d.mutable)
      .addU16(BigInt(bps))
      .addString(d.royaltyReceiver)
      .addU8(BigInt(d.category)),
    d.info,
  );
}
