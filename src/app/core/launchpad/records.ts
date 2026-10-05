import { Args } from '@massalabs/massa-web3';

/**
 * TypeScript mirror of the Launchpad SC records (smart-contract/assembly/lib/launchpad/
 * records.ts). Field order and types must match the contract exactly: Args has no field names.
 */

export const KIND_TOKEN = 0;
export const KIND_COLLECTION = 1;
export type ProjectKind = typeof KIND_TOKEN | typeof KIND_COLLECTION;

export const SOURCE_LAUNCHED = 0;
export const SOURCE_IMPORTED = 1;

/** Category labels, by index — the contract stores the index (rules.ts there). */
export const TOKEN_CATEGORIES = ['Meme', 'Utility', 'Gaming', 'DeFi', 'Community', 'Other'];
export const COLLECTION_CATEGORIES = [
  'Art',
  'PFP',
  'Gaming',
  'Music',
  'Photography',
  'Collectibles',
  'Other',
];

export function categoryLabel(kind: ProjectKind, category: number): string {
  const labels = kind === KIND_TOKEN ? TOKEN_CATEGORIES : COLLECTION_CATEGORIES;
  return labels[category] ?? 'Other';
}

export interface ProjectInfo {
  description: string;
  logoUrl: string;
  bannerUrl: string;
  website: string;
  twitter: string;
  telegram: string;
  discord: string;
}

export const EMPTY_INFO: ProjectInfo = {
  description: '',
  logoUrl: '',
  bannerUrl: '',
  website: '',
  twitter: '',
  telegram: '',
  discord: '',
};

export interface Project {
  kind: ProjectKind;
  id: bigint;
  address: string;
  source: number;
  creator: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  /** 0 for imports. */
  templateVersion: number;
  /** sha256 of the code at launch or import. */
  codeHash: Uint8Array;
  name: string;
  symbol: string;
  decimals: number;
  mutable: boolean;
  category: number;
  verified: boolean;
  hidden: boolean;
  royaltyBps: number;
  royaltyReceiver: string;
  info: ProjectInfo;
}

export interface LaunchpadConfig {
  /** nanoMAS */
  tokenFee: bigint;
  collectionFee: bigint;
  importFee: bigint;
  presaleFeeBps: number;
  /** MAS given to each new contract for its own storage, nanoMAS. */
  deployDeposit: bigint;
  paused: boolean;
}

export function writeInfo(args: Args, info: ProjectInfo): Args {
  return args
    .addString(info.description)
    .addString(info.logoUrl)
    .addString(info.bannerUrl)
    .addString(info.website)
    .addString(info.twitter)
    .addString(info.telegram)
    .addString(info.discord);
}

export function readInfo(args: Args): ProjectInfo {
  return {
    description: args.nextString(),
    logoUrl: args.nextString(),
    bannerUrl: args.nextString(),
    website: args.nextString(),
    twitter: args.nextString(),
    telegram: args.nextString(),
    discord: args.nextString(),
  };
}

export function readProject(args: Args): Project {
  return {
    kind: Number(args.nextU8()) as ProjectKind,
    id: args.nextU64(),
    address: args.nextString(),
    source: Number(args.nextU8()),
    creator: args.nextString(),
    createdAt: Number(args.nextU64()),
    templateVersion: Number(args.nextU32()),
    codeHash: args.nextUint8Array(),
    name: args.nextString(),
    symbol: args.nextString(),
    decimals: Number(args.nextU8()),
    mutable: args.nextBool(),
    category: Number(args.nextU8()),
    verified: args.nextBool(),
    hidden: args.nextBool(),
    royaltyBps: Number(args.nextU16()),
    royaltyReceiver: args.nextString(),
    info: readInfo(args),
  };
}

/** Inverse of readProject; the app never writes a Project, tests use it to build fixtures. */
export function writeProject(args: Args, p: Project): Args {
  args
    .addU8(BigInt(p.kind))
    .addU64(p.id)
    .addString(p.address)
    .addU8(BigInt(p.source))
    .addString(p.creator)
    .addU64(BigInt(p.createdAt))
    .addU32(BigInt(p.templateVersion))
    .addUint8Array(p.codeHash)
    .addString(p.name)
    .addString(p.symbol)
    .addU8(BigInt(p.decimals))
    .addBool(p.mutable)
    .addU8(BigInt(p.category))
    .addBool(p.verified)
    .addBool(p.hidden)
    .addU16(BigInt(p.royaltyBps))
    .addString(p.royaltyReceiver);
  return writeInfo(args, p.info);
}

export function readConfig(args: Args): LaunchpadConfig {
  return {
    tokenFee: args.nextU64(),
    collectionFee: args.nextU64(),
    importFee: args.nextU64(),
    presaleFeeBps: Number(args.nextU16()),
    deployDeposit: args.nextU64(),
    paused: args.nextBool(),
  };
}

/** `getProjects` result: total count, then a length-prefixed array of Project records. */
export function readProjectPage(bytes: Uint8Array): { total: bigint; projects: Project[] } {
  const args = new Args(bytes);
  const total = args.nextU64();
  const array = new Args(args.nextUint8Array());
  const projects: Project[] = [];
  while (array.getOffset() < array.serialize().length) projects.push(readProject(array));
  return { total, projects };
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- marketplace (phase 5) ------------------------------------------------------------------

/** An active marketplace listing (it disappears when sold or cancelled). */
export interface Listing {
  id: bigint;
  collectionId: bigint;
  collection: string;
  tokenId: bigint;
  seller: string;
  /** nanoMAS */
  price: bigint;
  createdAt: number;
  /** ms since the epoch; 0 = never expires. */
  expiresAt: number;
}

export interface Sale {
  id: bigint;
  listingId: bigint;
  collectionId: bigint;
  tokenId: bigint;
  seller: string;
  buyer: string;
  /** nanoMAS, royalty included. */
  price: bigint;
  royalty: bigint;
  soldAt: number;
}

export interface MarketStats {
  /** nanoMAS */
  volume: bigint;
  sales: bigint;
  lastPrice: bigint;
}

export function readListing(args: Args): Listing {
  return {
    id: args.nextU64(),
    collectionId: args.nextU64(),
    collection: args.nextString(),
    tokenId: args.nextU256(),
    seller: args.nextString(),
    price: args.nextU64(),
    createdAt: Number(args.nextU64()),
    expiresAt: Number(args.nextU64()),
  };
}

export function readSale(args: Args): Sale {
  return {
    id: args.nextU64(),
    listingId: args.nextU64(),
    collectionId: args.nextU64(),
    tokenId: args.nextU256(),
    seller: args.nextString(),
    buyer: args.nextString(),
    price: args.nextU64(),
    royalty: args.nextU64(),
    soldAt: Number(args.nextU64()),
  };
}

export function readStats(args: Args): MarketStats {
  return { volume: args.nextU64(), sales: args.nextU64(), lastPrice: args.nextU64() };
}

/** A page of records: total (u64), then a length-prefixed run of records. */
export function readPage<T>(
  bytes: Uint8Array,
  read: (args: Args) => T,
): { total: number; items: T[] } {
  const args = new Args(bytes);
  const total = Number(args.nextU64());
  const array = new Args(args.nextUint8Array());
  const items: T[] = [];
  while (array.getOffset() < array.serialize().length) items.push(read(array));
  return { total, items };
}

// ---- presale (phase 6) ----------------------------------------------------------------------

export const PRESALE_OPEN = 0;
export const PRESALE_SUCCESS = 1;
export const PRESALE_FAILED = 2;
export const PRESALE_CANCELLED = 3;

export interface Presale {
  id: bigint;
  /** Registry id of the token. */
  tokenId: bigint;
  token: string;
  creator: string;
  /** Token units escrowed for sale. */
  tokensForSale: bigint;
  /** Token units per 1 MAS. */
  rate: bigint;
  /** nanoMAS */
  softCap: bigint;
  hardCap: bigint;
  minBuy: bigint;
  /** 0 = no limit. */
  maxBuy: bigint;
  /** ms since the epoch */
  start: number;
  end: number;
  /** nanoMAS */
  raised: bigint;
  contributors: number;
  status: number;
  withdrawn: boolean;
}

export function readPresale(args: Args): Presale {
  return {
    id: args.nextU64(),
    tokenId: args.nextU64(),
    token: args.nextString(),
    creator: args.nextString(),
    tokensForSale: args.nextU256(),
    rate: args.nextU256(),
    softCap: args.nextU64(),
    hardCap: args.nextU64(),
    minBuy: args.nextU64(),
    maxBuy: args.nextU64(),
    start: Number(args.nextU64()),
    end: Number(args.nextU64()),
    raised: args.nextU64(),
    contributors: Number(args.nextU32()),
    status: Number(args.nextU8()),
    withdrawn: args.nextBool(),
  };
}

/** Token units a contribution buys: amount (nanoMAS) × rate / 1 MAS, rounded down. */
export function tokensFor(amount: bigint, rate: bigint): bigint {
  return (amount * rate) / 1_000_000_000n;
}
