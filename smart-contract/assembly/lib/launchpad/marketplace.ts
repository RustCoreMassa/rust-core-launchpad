// Marketplace. No custody: the NFT stays with the seller, who approves the Launchpad for it;
// `buy` moves it to the buyer and pays the seller and the creator's royalty in the same call.
// No platform fee.
//
// Checks read the collection's standard MRC721 storage directly (owner, approvals), so no
// foreign code runs except the single transferFrom in `buy` — done after this contract's own
// state is final, under a lock, and verified afterwards.
import {
  Args,
  byteToBool,
  bytesToString,
  bytesToU64,
  stringToBytes,
  u256ToBytes,
  u64ToBytes,
} from '@massalabs/as-types';
import {
  Address,
  Context,
  Storage,
  balance,
  call,
  createEvent,
  generateEvent,
  transferCoins,
} from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import { _activeConfig, _isAdmin, _nextId, _projectByAddress } from './common';
import {
  COUNTER_LISTING,
  COUNTER_SALE,
  KIND_COLLECTION,
  LOCK_KEY,
  MRC721_APPROVED_PREFIX,
  MRC721_OPERATOR_PREFIX,
  MRC721_OWNER_PREFIX,
  bytes,
  listingByCollectionKey,
  listingByCollectionPrefix,
  listingBySellerKey,
  listingBySellerPrefix,
  listingByTokenKey,
  listingKey,
  listingPrefix,
  saleKey,
  salePrefix,
  statsKey,
  u64FromBE,
} from './keys';
import { Listing, MarketStats, Project, Sale } from './records';
import { MAX_PAGE } from './rules';
import { settle } from './settlement';

/** A listing may run for a year at most. */
export const MAX_LISTING_MS: u64 = 365 * 24 * 60 * 60 * 1000;
/**
 * Sent along with transferFrom: the collection pays the buyer's new entries (balance, owner
 * index) from its own balance. Unused coins stay there as its storage reserve.
 */
export const NFT_TRANSFER_DEPOSIT: u64 = 30_000_000; // 0.03 MAS

// ==================================================== //
// ====                   WRITES                   ==== //
// ==================================================== //

/**
 * Lists an NFT the caller owns, after they approved the Launchpad for it (approve or
 * setApprovalForAll on the collection). Args: collection (string), tokenId (u256),
 * price (u64, nanoMAS), expiresAt (u64, ms; 0 = never). Coins: the listing's storage.
 */
export function list(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _activeConfig();
  _notLocked();
  const args = new Args(binaryArgs);
  const collection = args.nextString().expect('collection is missing or invalid');
  const tokenId = args.nextU256().expect('tokenId is missing or invalid');
  const price = args.nextU64().expect('price is missing or invalid');
  const expiresAt = args.nextU64().expect('expiresAt is missing or invalid');
  const project = _marketCollection(collection);
  const seller = Context.caller().toString();
  const now = Context.timestamp();
  assert(price > 0, 'The price must be greater than zero');
  assert(
    expiresAt == 0 || (expiresAt > now && expiresAt - now <= MAX_LISTING_MS),
    'The expiry must be in the next 365 days',
  );
  const contract = new Address(collection);
  assert(_tokenOwner(contract, tokenId) == seller, 'You do not own this NFT');
  assert(_approved(contract, seller, tokenId), 'Approve the Launchpad for this NFT first');

  const tokenKey = listingByTokenKey(project.id, u256ToBytes(tokenId));
  if (Storage.has(tokenKey)) {
    // A listing left by a previous owner: remove it, its storage goes back to that seller.
    const old = _load(bytesToU64(Storage.get(tokenKey)));
    assert(old.seller != seller, 'Already listed — change its price instead');
    _removeAndRefund(old);
  }

  const id = _nextId(COUNTER_LISTING);
  const listing = new Listing(id, project.id, collection, tokenId, seller, price, now, expiresAt);
  Storage.set(listingKey(id), listing.serialize());
  Storage.set(listingByCollectionKey(project.id, id), new StaticArray<u8>(0));
  Storage.set(listingBySellerKey(seller, id), new StaticArray<u8>(0));
  Storage.set(tokenKey, u64ToBytes(id));
  generateEvent(
    createEvent('LISTED', [id.toString(), collection, tokenId.toString(), price.toString()]),
  );
  settle(before, 0);
}

/** Args: listingId (u64), price (u64, nanoMAS). Seller only. */
export function updatePrice(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _activeConfig();
  _notLocked();
  const args = new Args(binaryArgs);
  const listing = _load(args.nextU64().expect('listingId is missing or invalid'));
  const price = args.nextU64().expect('price is missing or invalid');
  assert(Context.caller().toString() == listing.seller, 'Only the seller can change the price');
  assert(price > 0, 'The price must be greater than zero');
  listing.price = price;
  Storage.set(listingKey(listing.id), listing.serialize());
  generateEvent(createEvent('PRICE_UPDATED', [listing.id.toString(), price.toString()]));
  settle(before, 0);
}

/**
 * Args: listingId (u64). The seller cancels anytime; the admin, or anyone once the listing is no
 * longer valid (sold elsewhere, approval withdrawn, expired, hidden), can clean it up. The
 * listing's storage always goes back to the seller. Works while paused.
 */
export function cancel(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _notLocked();
  const listing = _load(new Args(binaryArgs).nextU64().expect('listingId is missing or invalid'));
  const caller = Context.caller().toString();
  if (caller == listing.seller) {
    _remove(listing);
  } else {
    assert(_isAdmin(caller) || !_isValid(listing), 'Only the seller can cancel a valid listing');
    _removeAndRefund(listing);
  }
  generateEvent(createEvent('CANCELLED', [listing.id.toString()]));
  settle(before, 0);
}

/**
 * Buys a listed NFT. Args: listingId (u64), price (u64, nanoMAS: the price the buyer saw — a
 * seller can't raise it under them). Coins: the price + storage of the sale record and the
 * buyer's entries in the collection (≈ 0.1 MAS); the rest is refunded.
 */
export function buy(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _activeConfig();
  _notLocked();
  Storage.set(LOCK_KEY, bytes(1));

  const args = new Args(binaryArgs);
  const listing = _load(args.nextU64().expect('listingId is missing or invalid'));
  const price = args.nextU64().expect('price is missing or invalid');
  assert(price == listing.price, 'The price changed, check it again');
  const buyer = Context.caller().toString();
  const seller = listing.seller;
  const problem = _buyProblem(listing, buyer);
  assert(problem == '', problem);
  const project = _projectByAddress(listing.collection)!;
  const contract = new Address(listing.collection);

  // This contract's state first: the listing goes, the sale is recorded.
  const beforeRemove = balance();
  _remove(listing);
  const freed = balance() - beforeRemove; // the listing's storage, back to the seller
  const royalty = _royalty(listing.price, project.royaltyBps);
  const sale = new Sale(
    _nextId(COUNTER_SALE),
    listing.id,
    project.id,
    listing.tokenId,
    seller,
    buyer,
    listing.price,
    royalty,
    Context.timestamp(),
  );
  Storage.set(saleKey(project.id, sale.id), sale.serialize());
  const stats = _stats(project.id);
  stats.volume += listing.price;
  stats.sales += 1;
  stats.lastPrice = listing.price;
  Storage.set(statsKey(project.id), stats.serialize());

  // Then the NFT moves, and must really have moved.
  call(
    contract,
    'transferFrom',
    new Args().add(seller).add(buyer).add(listing.tokenId),
    NFT_TRANSFER_DEPOSIT,
  );
  assert(_tokenOwner(contract, listing.tokenId) == buyer, 'The NFT was not transferred');

  if (royalty > 0) transferCoins(new Address(project.royaltyReceiver), royalty);
  transferCoins(new Address(seller), listing.price - royalty + freed);
  Storage.del(LOCK_KEY);
  generateEvent(
    createEvent('SOLD', [
      listing.id.toString(),
      sale.id.toString(),
      listing.collection,
      listing.tokenId.toString(),
      buyer,
      listing.price.toString(),
    ]),
  );
  settle(before, 0);
}

// ==================================================== //
// ====                   READS                    ==== //
// ==================================================== //

/** Args: listingId (u64). Returns Listing. */
export function getListing(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const id = new Args(binaryArgs).nextU64().expect('listingId is missing or invalid');
  assert(Storage.has(listingKey(id)), 'This listing is no longer active');
  return Storage.get(listingKey(id));
}

/**
 * Active listings, newest first. Args: collectionId (u64, 0 = every collection), offset (u64),
 * limit (u32, ≤ 50). Returns Args: total (u64), listings (Listing[]). Listings may be stale
 * (the NFT moved): check isListingValid, or the owner and approval, before showing a Buy button.
 */
export function getListings(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const collectionId = args.nextU64().expect('collectionId is missing or invalid');
  const offset = args.nextU64().expect('offset is missing or invalid');
  const limit = args.nextU32().expect('limit is missing or invalid');
  assert(limit > 0 && limit <= MAX_PAGE, 'Limit must be 1-50');
  const ids = _newestFirst(
    Storage.getKeys(collectionId == 0 ? listingPrefix() : listingByCollectionPrefix(collectionId)),
  );
  const page: Listing[] = [];
  for (let i = i32(offset); i < ids.length && page.length < i32(limit); i++) {
    page.push(_load(ids[i]));
  }
  return new Args().add(u64(ids.length)).addSerializableObjectArray<Listing>(page).serialize();
}

/** Args: seller (string). Returns Args: ids (u64[]) of their active listings. */
export function getListingsBySeller(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const seller = new Args(binaryArgs).nextString().expect('seller is missing or invalid');
  return new Args().add(_newestFirst(Storage.getKeys(listingBySellerPrefix(seller)))).serialize();
}

/** Args: collection (string), tokenId (u256). Returns u64: its active listing id, 0 if none. */
export function listingOf(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const collection = args.nextString().expect('collection is missing or invalid');
  const tokenId = args.nextU256().expect('tokenId is missing or invalid');
  const project = _projectByAddress(collection);
  if (project == null) return u64ToBytes(0);
  const key = listingByTokenKey(project.id, u256ToBytes(tokenId));
  return Storage.has(key) ? Storage.get(key) : u64ToBytes(0);
}

/**
 * Why `buyer` can't buy this listing right now, or an empty string when they can.
 * Args: listingId (u64), buyer (string). Returns the reason as text.
 */
export function buyProblem(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const id = args.nextU64().expect('listingId is missing or invalid');
  const buyer = args.nextString().expect('buyer is missing or invalid');
  if (!Storage.has(listingKey(id))) return stringToBytes('This listing is no longer active');
  return stringToBytes(_buyProblem(_load(id), buyer));
}

/** Args: listingId (u64). Returns a bool byte: can it be bought right now? */
export function isListingValid(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const id = new Args(binaryArgs).nextU64().expect('listingId is missing or invalid');
  if (!Storage.has(listingKey(id))) return [0];
  return _isValid(_load(id)) ? [1] : [0];
}

/**
 * Sales of a collection, newest first. Args: collectionId (u64), offset (u64), limit (u32,
 * ≤ 50). Returns Args: total (u64), sales (Sale[]).
 */
export function getSales(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const collectionId = args.nextU64().expect('collectionId is missing or invalid');
  const offset = args.nextU64().expect('offset is missing or invalid');
  const limit = args.nextU32().expect('limit is missing or invalid');
  assert(limit > 0 && limit <= MAX_PAGE, 'Limit must be 1-50');
  const ids = _newestFirst(Storage.getKeys(salePrefix(collectionId)));
  const page: Sale[] = [];
  for (let i = i32(offset); i < ids.length && page.length < i32(limit); i++) {
    page.push(
      new Args(Storage.get(saleKey(collectionId, ids[i]))).nextSerializable<Sale>().unwrap(),
    );
  }
  return new Args().add(u64(ids.length)).addSerializableObjectArray<Sale>(page).serialize();
}

/** Args: collectionId (u64). Returns MarketStats (zeros before the first sale). */
export function getStats(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const collectionId = new Args(binaryArgs).nextU64().expect('collectionId is missing or invalid');
  return _stats(collectionId).serialize();
}

// ==================================================== //
// ====                  INTERNALS                 ==== //
// ==================================================== //

function _notLocked(): void {
  assert(!Storage.has(LOCK_KEY), 'The marketplace is busy, try again');
}

/** A Launchpad collection that can trade: registered, kind collection, not hidden. */
function _marketCollection(address: string): Project {
  const project = _projectByAddress(address);
  assert(project != null && project.kind == KIND_COLLECTION, 'Not a Launchpad collection');
  assert(!project!.hidden, 'This collection is hidden');
  return project!;
}

function _load(id: u64): Listing {
  const key = listingKey(id);
  assert(Storage.has(key), 'This listing is no longer active');
  return new Args(Storage.get(key)).nextSerializable<Listing>().unwrap();
}

function _remove(listing: Listing): void {
  Storage.del(listingKey(listing.id));
  Storage.del(listingByCollectionKey(listing.collectionId, listing.id));
  Storage.del(listingBySellerKey(listing.seller, listing.id));
  Storage.del(listingByTokenKey(listing.collectionId, u256ToBytes(listing.tokenId)));
}

/** Removes a listing someone else cleans up; its freed storage goes to the seller. */
function _removeAndRefund(listing: Listing): void {
  const before = balance();
  _remove(listing);
  const freed = balance() - before;
  if (freed > 0) transferCoins(new Address(listing.seller), freed);
}

/** The first reason this purchase can't happen, or '' — the rules `buy` enforces. */
function _buyProblem(listing: Listing, buyer: string): string {
  if (buyer == listing.seller) return 'This is your own listing';
  if (listing.expiresAt != 0 && Context.timestamp() >= listing.expiresAt)
    return 'This listing has expired';
  const project = _projectByAddress(listing.collection);
  if (project == null || project.kind != KIND_COLLECTION) return 'Not a Launchpad collection';
  if (project.hidden) return 'This collection is hidden';
  const contract = new Address(listing.collection);
  if (_tokenOwner(contract, listing.tokenId) != listing.seller)
    return 'The seller no longer owns this NFT';
  if (!_approved(contract, listing.seller, listing.tokenId))
    return 'The seller withdrew the approval';
  return '';
}

function _isValid(listing: Listing): bool {
  const project = _projectByAddress(listing.collection);
  if (project == null || project.hidden) return false;
  if (listing.expiresAt != 0 && Context.timestamp() >= listing.expiresAt) return false;
  const contract = new Address(listing.collection);
  return (
    _tokenOwner(contract, listing.tokenId) == listing.seller &&
    _approved(contract, listing.seller, listing.tokenId)
  );
}

/** Holder of a token, from the collection's standard owner key; empty if none. */
function _tokenOwner(collection: Address, tokenId: u256): string {
  const key = bytes(MRC721_OWNER_PREFIX).concat(u256ToBytes(tokenId));
  return Storage.hasOf(collection, key) ? bytesToString(Storage.getOf(collection, key)) : '';
}

/** Is the Launchpad approved for this token (single approval or operator for the owner)? */
function _approved(collection: Address, owner: string, tokenId: u256): bool {
  const launchpad = Context.callee().toString();
  const single = bytes(MRC721_APPROVED_PREFIX).concat(u256ToBytes(tokenId));
  if (
    Storage.hasOf(collection, single) &&
    bytesToString(Storage.getOf(collection, single)) == launchpad
  )
    return true;
  const operator = bytes(MRC721_OPERATOR_PREFIX)
    .concat(stringToBytes(owner))
    .concat(stringToBytes(launchpad));
  return Storage.hasOf(collection, operator) && byteToBool(Storage.getOf(collection, operator));
}

/** price × bps / 10 000 without overflow. */
function _royalty(price: u64, bps: u16): u64 {
  return (price / 10_000) * u64(bps) + ((price % 10_000) * u64(bps)) / 10_000;
}

function _stats(collectionId: u64): MarketStats {
  const key = statsKey(collectionId);
  return Storage.has(key)
    ? new Args(Storage.get(key)).nextSerializable<MarketStats>().unwrap()
    : new MarketStats();
}

/** Ids from index keys (8 big-endian bytes at the end), highest first. */
function _newestFirst(keys: Array<StaticArray<u8>>): u64[] {
  const ids: u64[] = [];
  for (let i = 0; i < keys.length; i++) ids.push(u64FromBE(keys[i], keys[i].length - 8));
  ids.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  return ids;
}
