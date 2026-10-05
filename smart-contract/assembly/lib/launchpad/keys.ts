// Datastore keys of the Launchpad SC. Ids are written big-endian so that listing keys by prefix
// returns them in order. A ':' closes every variable-length part (addresses, symbols), so one
// address can never be a prefix of another.
import { stringToBytes } from '@massalabs/as-types';

export const KIND_TOKEN: u8 = 0;
export const KIND_COLLECTION: u8 = 1;

export const ADMIN_KEY = stringToBytes('admin');
export const CONFIG_KEY = stringToBytes('cfg');
export const FEES_KEY = stringToBytes('fees');
export const UPGRADE_KEY = stringToBytes('upg');
/** Address named by transferAdmin, until it calls acceptAdmin. */
export const PENDING_ADMIN_KEY = stringToBytes('padm');

const TEMPLATE_VERSION = stringToBytes('tplv:');
const TEMPLATE_CODE = stringToBytes('tpl:');
const TEMPLATE_HASH = stringToBytes('tplh:');
const COUNT = stringToBytes('n:');
const PROJECT = stringToBytes('p:');
const BY_ADDRESS = stringToBytes('a:');
const BY_CREATOR = stringToBytes('o:');
const BY_CATEGORY = stringToBytes('c:');
const SYMBOL = stringToBytes('s:');

/** Bytes as a StaticArray (array literals are typed as Array in concat calls). */
export function bytes(a: u8, b: i32 = -1): StaticArray<u8> {
  const out = new StaticArray<u8>(b < 0 ? 1 : 2);
  out[0] = a;
  if (b >= 0) out[1] = u8(b);
  return out;
}

/** 8 bytes, most significant first. */
export function u64BE(value: u64): StaticArray<u8> {
  const out = new StaticArray<u8>(8);
  for (let i = 0; i < 8; i++) out[i] = u8((value >> (u64(7 - i) * 8)) & 0xff);
  return out;
}

export function u64FromBE(bytes: StaticArray<u8>, offset: i32): u64 {
  let value: u64 = 0;
  for (let i = 0; i < 8; i++) value = (value << 8) | u64(bytes[offset + i]);
  return value;
}

function u32BE(value: u32): StaticArray<u8> {
  return [u8(value >> 24), u8(value >> 16), u8(value >> 8), u8(value)];
}

export function templateVersionKey(kind: u8): StaticArray<u8> {
  return TEMPLATE_VERSION.concat(bytes(kind));
}

export function templateCodeKey(kind: u8, version: u32): StaticArray<u8> {
  return TEMPLATE_CODE.concat(bytes(kind)).concat(u32BE(version));
}

export function templateHashKey(kind: u8, version: u32): StaticArray<u8> {
  return TEMPLATE_HASH.concat(bytes(kind)).concat(u32BE(version));
}

export function countKey(kind: u8): StaticArray<u8> {
  return COUNT.concat(bytes(kind));
}

/** kind + id: the 9-byte reference stored by the indexes. */
export function projectRef(kind: u8, id: u64): StaticArray<u8> {
  return bytes(kind).concat(u64BE(id));
}

export function projectKey(kind: u8, id: u64): StaticArray<u8> {
  return PROJECT.concat(projectRef(kind, id));
}

export function addressKey(address: string): StaticArray<u8> {
  return BY_ADDRESS.concat(stringToBytes(address + ':'));
}

export function creatorPrefix(creator: string, kind: u8): StaticArray<u8> {
  return BY_CREATOR.concat(stringToBytes(creator + ':')).concat(bytes(kind));
}

export function creatorKey(creator: string, kind: u8, id: u64): StaticArray<u8> {
  return creatorPrefix(creator, kind).concat(u64BE(id));
}

export function categoryPrefix(kind: u8, category: u8): StaticArray<u8> {
  return BY_CATEGORY.concat(bytes(kind, category));
}

export function categoryKey(kind: u8, category: u8, id: u64): StaticArray<u8> {
  return categoryPrefix(kind, category).concat(u64BE(id));
}

export function symbolKey(symbol: string): StaticArray<u8> {
  return SYMBOL.concat(stringToBytes(symbol + ':'));
}

// Keys the standard MRC20 / MRC721 contracts use, read on import and for ownership checks.
export const STD_OWNER_KEY = stringToBytes('OWNER');
export const MRC20_NAME_KEY = stringToBytes('NAME');
export const MRC20_SYMBOL_KEY = stringToBytes('SYMBOL');
export const MRC20_DECIMALS_KEY = stringToBytes('DECIMALS');
export const MRC20_TOTAL_SUPPLY_KEY = stringToBytes('TOTAL_SUPPLY');
export const MRC721_NAME_KEY: StaticArray<u8> = [0x01];
export const MRC721_SYMBOL_KEY: StaticArray<u8> = [0x02];

// ---- marketplace (phase 5) ----------------------------------------------------------------
/** Counters share `n:<kind>` with projects: kinds 2 and 3 count listings and sales. */
export const COUNTER_LISTING: u8 = 2;
export const COUNTER_SALE: u8 = 3;
export const LOCK_KEY = stringToBytes('lock');

const LISTING = stringToBytes('l:');
const LISTING_BY_COLLECTION = stringToBytes('lc:');
const LISTING_BY_SELLER = stringToBytes('ls:');
const LISTING_BY_TOKEN = stringToBytes('lt:');
const SALE = stringToBytes('sa:');
const STATS = stringToBytes('st:');

export function listingPrefix(): StaticArray<u8> {
  return LISTING;
}

export function listingKey(id: u64): StaticArray<u8> {
  return LISTING.concat(u64BE(id));
}

export function listingByCollectionPrefix(collectionId: u64): StaticArray<u8> {
  return LISTING_BY_COLLECTION.concat(u64BE(collectionId));
}

export function listingByCollectionKey(collectionId: u64, id: u64): StaticArray<u8> {
  return listingByCollectionPrefix(collectionId).concat(u64BE(id));
}

export function listingBySellerPrefix(seller: string): StaticArray<u8> {
  return LISTING_BY_SELLER.concat(stringToBytes(seller + ':'));
}

export function listingBySellerKey(seller: string, id: u64): StaticArray<u8> {
  return listingBySellerPrefix(seller).concat(u64BE(id));
}

/** One active listing per NFT: collection id + token id (32 bytes LE) → listing id. */
export function listingByTokenKey(collectionId: u64, tokenId: StaticArray<u8>): StaticArray<u8> {
  return LISTING_BY_TOKEN.concat(u64BE(collectionId)).concat(tokenId);
}

export function salePrefix(collectionId: u64): StaticArray<u8> {
  return SALE.concat(u64BE(collectionId));
}

export function saleKey(collectionId: u64, id: u64): StaticArray<u8> {
  return salePrefix(collectionId).concat(u64BE(id));
}

export function statsKey(collectionId: u64): StaticArray<u8> {
  return STATS.concat(u64BE(collectionId));
}

// Standard MRC721 storage of the collection, read directly (no code runs): owner of a token,
// its single approval, and operator approvals.
export const MRC721_OWNER_PREFIX: u8 = 0x04;
export const MRC721_APPROVED_PREFIX: u8 = 0x05;
export const MRC721_OPERATOR_PREFIX: u8 = 0x06;

// ---- presale (phase 6) --------------------------------------------------------------------
export const COUNTER_PRESALE: u8 = 4;

const PRESALE = stringToBytes('pr:');
const PRESALE_ACTIVE = stringToBytes('pa:');
const CONTRIBUTION = stringToBytes('cb:');
const CONTRIBUTIONS_OF = stringToBytes('cu:');
const ESCROWED = stringToBytes('esc:');

export function presaleKey(id: u64): StaticArray<u8> {
  return PRESALE.concat(u64BE(id));
}

/** The open presale of a token (one at a time): token address → presale id. */
export function presaleActiveKey(token: string): StaticArray<u8> {
  return PRESALE_ACTIVE.concat(stringToBytes(token + ':'));
}

export function contributionKey(presaleId: u64, contributor: string): StaticArray<u8> {
  return CONTRIBUTION.concat(u64BE(presaleId)).concat(stringToBytes(contributor));
}

export function contributionsOfPrefix(contributor: string): StaticArray<u8> {
  return CONTRIBUTIONS_OF.concat(stringToBytes(contributor + ':'));
}

export function contributionsOfKey(contributor: string, presaleId: u64): StaticArray<u8> {
  return contributionsOfPrefix(contributor).concat(u64BE(presaleId));
}

/** Token units the Launchpad holds in escrow for a token, across its presales. */
export function escrowedKey(token: string): StaticArray<u8> {
  return ESCROWED.concat(stringToBytes(token + ':'));
}

/** The standard MRC20 balance key of an address ('BALANCE' + address). */
export function mrc20BalanceKey(address: string): StaticArray<u8> {
  return stringToBytes('BALANCE' + address);
}
