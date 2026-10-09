// Product rules the Launchpad enforces before it deploys or records anything. The templates only
// check basic sanity themselves.
import { validateAddress } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import { KIND_COLLECTION, KIND_TOKEN } from './keys';
import { Allocation, ProjectInfo } from './records';

export const NAME_MIN = 3;
export const NAME_MAX = 32;
export const SYMBOL_MIN = 2;
export const SYMBOL_MAX = 10;
export const DESCRIPTION_MAX = 500;
export const URL_MAX = 256;
export const MAX_COLLECTION_SUPPLY: u64 = 100_000;
export const MAX_ROYALTY_BPS: u16 = 1_000; // 10 %
/** Cap on the presale fee the admin may set (fixed in each presale when it's created). */
export const MAX_PRESALE_FEE_BPS: u16 = 1_000; // 10 %
/** Cap on the marketplace fee the admin may set (fixed in each listing when it's created). */
export const MAX_MARKET_FEE_BPS: u16 = 500; // 5 %
export const MAX_PAGE: u32 = 50;
/** Tokenomics: a safety limit, so one call can't fill the storage or run out of gas. */
export const MAX_ALLOCATIONS = 30;
export const PURPOSE_MAX = 40;
export const ALLOCATION_DESCRIPTION_MAX = 140;

/** meme, utility, gaming, DeFi, community, other */
export const TOKEN_CATEGORIES: u8 = 6;
/** art, PFP, gaming, music, photography, collectibles, other */
export const COLLECTION_CATEGORIES: u8 = 7;

/** Reserved at deploy: well-known Massa symbols nobody may launch again. */
export const RESERVED_SYMBOLS: string[] = [
  'MAS',
  'WMAS',
  'USDC',
  'USDT',
  'DAI',
  'WETH',
  'ETH',
  'WBTC',
  'BTC',
  'DUSA',
  'PUR',
];

export function assertName(name: string): void {
  assert(name.length >= NAME_MIN && name.length <= NAME_MAX, 'Name must be 3-32 characters');
  assert(name.trim() == name, 'Name must not start or end with a space');
  assertPrintable(name, false, 'Name');
}

/** 2-10 characters, A-Z and 0-9 (the app upper-cases before sending). */
export function assertSymbol(symbol: string): void {
  assert(
    symbol.length >= SYMBOL_MIN && symbol.length <= SYMBOL_MAX,
    'Symbol must be 2-10 characters',
  );
  for (let i = 0; i < symbol.length; i++) {
    const c = symbol.charCodeAt(i);
    assert((c >= 65 && c <= 90) || (c >= 48 && c <= 57), 'Symbol may only use A-Z and 0-9');
  }
}

export function assertCategory(kind: u8, category: u8): void {
  const count = kind == KIND_TOKEN ? TOKEN_CATEGORIES : COLLECTION_CATEGORIES;
  assert(kind <= KIND_COLLECTION && category < count, 'Unknown category');
}

export function assertInfo(info: ProjectInfo): void {
  assert(info.description.length <= DESCRIPTION_MAX, 'Description is too long (500 max)');
  assertPrintable(info.description, true, 'Description');
  assertUrl(info.logoUrl, 'Logo');
  assertUrl(info.bannerUrl, 'Banner');
  assertUrl(info.website, 'Website');
  assertUrl(info.twitter, 'X / Twitter');
  assertUrl(info.telegram, 'Telegram');
  assertUrl(info.discord, 'Discord');
}

/**
 * Empty, or an https:// / ipfs:// URL without spaces or control characters. http:// only for the
 * developer's own machine (localhost, 127.0.0.1, [::1]): the app accepts those while running
 * with `ng serve`; the published app never loads them.
 */
export function assertUrl(url: string, what: string): void {
  if (url.length == 0) return;
  assert(url.length <= URL_MAX, what + ' URL is too long (256 max)');
  assert(
    url.startsWith('https://') || url.startsWith('ipfs://') || isLocalHttp(url),
    what + ' URL must start with https:// or ipfs://',
  );
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    assert(c > 32 && c != 127, what + ' URL must not contain spaces');
  }
}

/**
 * A declared supply split: 1-30 parts, each with a purpose, an amount above zero, an optional
 * one-line description and an optional valid address; the amounts add up exactly to `supply`.
 */
export function assertAllocations(allocations: Allocation[], supply: u256): void {
  assert(allocations.length > 0 && allocations.length <= MAX_ALLOCATIONS, 'Use 1-30 parts');
  let sum = u256.Zero;
  for (let i = 0; i < allocations.length; i++) {
    const part = allocations[i];
    assert(
      part.purpose.length > 0 && part.purpose.length <= PURPOSE_MAX,
      'Each part needs a purpose of 1-40 characters',
    );
    assert(part.purpose.trim() == part.purpose, 'A purpose must not start or end with a space');
    assertPrintable(part.purpose, false, 'A purpose');
    assert(
      part.description.length <= ALLOCATION_DESCRIPTION_MAX,
      'A part description is too long (140 max)',
    );
    assertPrintable(part.description, false, 'A part description');
    assert(part.holder.length == 0 || validateAddress(part.holder), 'Invalid part address');
    assert(part.amount > u256.Zero, 'Each part needs an amount above zero');
    // sum ≤ supply holds at every step, so the subtraction can't wrap.
    assert(part.amount <= supply - sum, 'The parts add up to more than the supply');
    sum = sum + part.amount;
  }
  assert(sum == supply, 'The parts must add up to the whole supply');
}

export function assertRoyalty(bps: u16): void {
  assert(bps <= MAX_ROYALTY_BPS, 'Royalty must be at most 10%');
}

function assertPrintable(text: string, allowNewLines: bool, what: string): void {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const control = c < 32 || c == 127;
    assert(!control || (allowNewLines && c == 10), what + ' contains invalid characters');
  }
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** http://<local host> followed by the end, a port or a path. */
export function isLocalHttp(url: string): bool {
  if (!url.startsWith('http://')) return false;
  for (let i = 0; i < LOCAL_HOSTS.length; i++) {
    const prefix = 'http://' + LOCAL_HOSTS[i];
    if (!url.startsWith(prefix)) continue;
    if (url.length == prefix.length) return true;
    const next = url.charAt(prefix.length);
    if (next == ':' || next == '/') return true;
  }
  return false;
}
