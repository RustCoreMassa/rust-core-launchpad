// RC-Collection v1 — the MRC721 template the Launchpad deploys (docs/ANALYSIS.md, "Șabloanele").
//
// Built on @massalabs/sc-standards 1.3.0, MRC721 Enumerable (balances, owners, approvals, the
// per-owner token index, totalSupply). Differences from the standard and its example:
// - an explicit owner in the constructor (the deployer is the Launchpad, not the user);
// - token ids are sequential from 1, capped by maxSupply (burned ids are never reused);
// - ownerMint / ownerMintWithURI for the owner, publicMint paid in MAS to the owner;
// - metadata: `uri(id)` = the token's own URI if it has one, else baseURI + id + ".json";
//   setBaseURI until freezeMetadata (irreversible);
// - the standard Enumerable `burn` has no authorization check, so it is NOT exported;
// - name()/symbol() take the usual args parameter, like every other exported function;
// - optional "mutable code", safe ownership transfer and renouncing.
//
// Storage writes are paid from this contract's balance: callers send MAS with calls that create
// entries (mints, approvals, transfers to a new holder).
import {
  Args,
  boolToByte,
  byteToBool,
  bytesToString,
  bytesToU256,
  bytesToU32,
  bytesToU64,
  stringToBytes,
  u256ToBytes,
  u32ToBytes,
  u64ToBytes,
} from '@massalabs/as-types';
import {
  Address,
  Context,
  Storage,
  balance,
  createEvent,
  generateEvent,
  isDeployingContract,
  transferCoins,
} from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import {
  _constructor,
  _name,
  _ownerOf,
  _symbol,
  _totalSupply,
  _transferFrom,
  _update,
} from '@massalabs/sc-standards/assembly/contracts/MRC721/enumerable/MRC721Enumerable-internals';
import {
  _initOwner,
  _onlyOwner,
  _owner,
  _renounceOwnership,
  assertValidAddress,
} from '../lib/ownable';
import { _initMutable, _isMutable, _upgrade } from '../lib/mutable';
import {
  MAX_NAME_LENGTH,
  MAX_SYMBOL_LENGTH,
  MAX_URI_LENGTH,
  assertLength,
} from '../lib/validation';

export const TEMPLATE_NAME = 'RC-Collection';
export const TEMPLATE_VERSION = '1.0.0';
/** Most tokens one mint call may create (keeps a call's gas bounded). */
export const MAX_MINT_BATCH: u32 = 50;

export const MAX_SUPPLY_KEY = stringToBytes('MAX_SUPPLY');
export const MINTED_KEY = stringToBytes('MINTED');
export const BASE_URI_KEY = stringToBytes('BASE_URI');
export const TOKEN_URI_PREFIX = stringToBytes('TOKEN_URI');
export const FROZEN_KEY = stringToBytes('METADATA_FROZEN');
export const MINT_PRICE_KEY = stringToBytes('MINT_PRICE');
export const MAX_PER_WALLET_KEY = stringToBytes('MAX_PER_WALLET');
export const PUBLIC_MINT_KEY = stringToBytes('PUBLIC_MINT');
export const MINTED_BY_PREFIX = stringToBytes('MINTED_BY');

export const MINT_EVENT = 'MINT';
export const PUBLIC_MINT_EVENT = 'PUBLIC_MINT';
export const BASE_URI_EVENT = 'BASE_URI';
export const FREEZE_EVENT = 'METADATA_FROZEN';
export const MINT_CONFIG_EVENT = 'MINT_CONFIG';
export const MAX_SUPPLY_EVENT = 'MAX_SUPPLY';

/**
 * Args: name (string), symbol (string), owner (string), maxSupply (u256), baseURI (string),
 * mintPrice (u64, nanoMAS), maxPerWallet (u32, 0 = no limit), publicMint (bool), mutable (bool).
 * An empty baseURI means every token gets its own URI at mint (ownerMintWithURI).
 */
export function constructor(binaryArgs: StaticArray<u8>): void {
  assert(isDeployingContract(), 'constructor can only run at deploy time');
  const args = new Args(binaryArgs);
  const name = args.nextString().expect('name argument is missing or invalid');
  const symbol = args.nextString().expect('symbol argument is missing or invalid');
  const owner = args.nextString().expect('owner argument is missing or invalid');
  const maxSupply = args.nextU256().expect('maxSupply argument is missing or invalid');
  const baseURI = args.nextString().expect('baseURI argument is missing or invalid');
  const mintPrice = args.nextU64().expect('mintPrice argument is missing or invalid');
  const maxPerWallet = args.nextU32().expect('maxPerWallet argument is missing or invalid');
  const publicMint = args.nextBool().expect('publicMint argument is missing or invalid');
  const mutable = args.nextBool().expect('mutable argument is missing or invalid');

  assertLength(name, 1, MAX_NAME_LENGTH, 'Name');
  assertLength(symbol, 1, MAX_SYMBOL_LENGTH, 'Symbol');
  assertLength(baseURI, 0, MAX_URI_LENGTH, 'Base URI');
  assert(maxSupply > u256.Zero, 'Max supply must be greater than zero');
  assert(!publicMint || baseURI.length > 0, 'Public mint needs a base URI');

  _constructor(name, symbol);
  Storage.set(MAX_SUPPLY_KEY, u256ToBytes(maxSupply));
  Storage.set(MINTED_KEY, u256ToBytes(u256.Zero));
  Storage.set(BASE_URI_KEY, stringToBytes(baseURI));
  Storage.set(FROZEN_KEY, boolToByte(false));
  _setMintConfig(mintPrice, maxPerWallet, publicMint);
  _initMutable(mutable);
  _initOwner(owner);
}

// ==================================================== //
// ====                    MINT                    ==== //
// ==================================================== //

/** Args: to (string), count (u32). Owner only; uses the base URI. */
export function ownerMint(binaryArgs: StaticArray<u8>): void {
  _onlyOwner();
  const args = new Args(binaryArgs);
  const to = args.nextString().expect('to argument is missing or invalid');
  const count = args.nextU32().expect('count argument is missing or invalid');
  assertValidAddress(to, 'recipient');
  assert(_baseURI().length > 0, 'No base URI: mint with ownerMintWithURI');
  _mintBatch(to, count);
}

/** Args: to (string), uri (string). Owner only; one token with its own metadata URI. */
export function ownerMintWithURI(binaryArgs: StaticArray<u8>): void {
  _onlyOwner();
  const args = new Args(binaryArgs);
  const to = args.nextString().expect('to argument is missing or invalid');
  const uri = args.nextString().expect('uri argument is missing or invalid');
  assertValidAddress(to, 'recipient');
  assertLength(uri, 1, MAX_URI_LENGTH, 'URI');
  const id = _mintBatch(to, 1);
  Storage.set(TOKEN_URI_PREFIX.concat(u256ToBytes(id)), stringToBytes(uri));
}

/**
 * Args: count (u32). Anyone, while public mint is open. Coins sent must cover
 * mintPrice × count plus the storage of the new tokens; the price goes to the owner and any
 * excess back to the caller.
 */
export function publicMint(binaryArgs: StaticArray<u8>): void {
  assert(_isPublicMint(), 'Public mint is closed');
  const count = new Args(binaryArgs).nextU32().expect('count argument is missing or invalid');
  const caller = Context.caller().toString();
  const price = _mintPrice();
  assert(count > 0 && count <= MAX_MINT_BATCH, 'Count must be 1-50');
  assert(price == 0 || price <= u64.MAX_VALUE / u64(count), 'Price overflow');
  const cost = price * u64(count);

  const mintedByKey = MINTED_BY_PREFIX.concat(stringToBytes(caller));
  const mintedBefore = Storage.has(mintedByKey) ? bytesToU32(Storage.get(mintedByKey)) : 0;
  const limit = _maxPerWallet();
  assert(limit == 0 || count <= limit - min(mintedBefore, limit), 'Mint limit per wallet reached');

  const balanceBefore = balance();
  Storage.set(mintedByKey, u32ToBytes(mintedBefore + count));
  _mintBatch(caller, count);
  const storageCost = balanceBefore - balance();

  const sent = Context.transferredCoins();
  assert(sent >= storageCost && sent - storageCost >= cost, 'Not enough MAS for price + storage');
  if (cost > 0) transferCoins(new Address(_owner()), cost);
  const excess = sent - storageCost - cost;
  if (excess > 0) transferCoins(Context.caller(), excess);
  generateEvent(createEvent(PUBLIC_MINT_EVENT, [caller, count.toString()]));
}

/** Mints `count` sequential ids to `to`; returns the last id. */
function _mintBatch(to: string, count: u32): u256 {
  assert(count > 0 && count <= MAX_MINT_BATCH, 'Count must be 1-50');
  const minted = _minted();
  const max = bytesToU256(Storage.get(MAX_SUPPLY_KEY));
  const amount = u256.fromU32(count);
  assert(minted <= max && amount <= max - minted, 'Mint would exceed the max supply');
  let id = minted;
  for (let i: u32 = 0; i < count; i++) {
    id = id + u256.One;
    _update(to, id, '');
  }
  Storage.set(MINTED_KEY, u256ToBytes(id));
  generateEvent(createEvent(MINT_EVENT, [to, count.toString(), id.toString()]));
  return id;
}

// ==================================================== //
// ====              OWNER SETTINGS                ==== //
// ==================================================== //

/** Args: baseURI (string). Owner only, until the metadata is frozen. */
export function setBaseURI(binaryArgs: StaticArray<u8>): void {
  _onlyOwner();
  assert(!_isFrozen(), 'Metadata is frozen');
  const baseURI = new Args(binaryArgs)
    .nextString()
    .expect('baseURI argument is missing or invalid');
  assertLength(baseURI, 1, MAX_URI_LENGTH, 'Base URI');
  Storage.set(BASE_URI_KEY, stringToBytes(baseURI));
  generateEvent(createEvent(BASE_URI_EVENT, [baseURI]));
}

/** Locks the base URI forever. Owner only; cannot be undone. */
export function freezeMetadata(_: StaticArray<u8>): void {
  _onlyOwner();
  assert(!_isFrozen(), 'Metadata is already frozen');
  Storage.set(FROZEN_KEY, boolToByte(true));
  generateEvent(FREEZE_EVENT);
}

/** Args: mintPrice (u64, nanoMAS), maxPerWallet (u32, 0 = no limit), publicMint (bool). */
export function setMintConfig(binaryArgs: StaticArray<u8>): void {
  _onlyOwner();
  const args = new Args(binaryArgs);
  const price = args.nextU64().expect('mintPrice argument is missing or invalid');
  const maxPerWallet = args.nextU32().expect('maxPerWallet argument is missing or invalid');
  const open = args.nextBool().expect('publicMint argument is missing or invalid');
  assert(!open || _baseURI().length > 0, 'Public mint needs a base URI');
  _setMintConfig(price, maxPerWallet, open);
}

/** Args: maxSupply (u256). Owner only; can only go down, never below what was minted. */
export function reduceMaxSupply(binaryArgs: StaticArray<u8>): void {
  _onlyOwner();
  const newMax = new Args(binaryArgs).nextU256().expect('maxSupply argument is missing or invalid');
  const max = bytesToU256(Storage.get(MAX_SUPPLY_KEY));
  assert(newMax < max, 'Max supply can only go down');
  assert(newMax >= _minted(), 'Max supply is below the minted count');
  Storage.set(MAX_SUPPLY_KEY, u256ToBytes(newMax));
  generateEvent(createEvent(MAX_SUPPLY_EVENT, [newMax.toString()]));
}

/** Gives up ownership for good. Public mint closes too: its price would have no recipient. */
export function renounceOwnership(_: StaticArray<u8>): void {
  _onlyOwner();
  Storage.set(PUBLIC_MINT_KEY, boolToByte(false));
  _renounceOwnership();
}

/** Args: bytecode (bytes). Only if the collection was launched with mutable code. */
export function upgrade(binaryArgs: StaticArray<u8>): void {
  _upgrade(binaryArgs);
}

function _setMintConfig(price: u64, maxPerWallet: u32, open: bool): void {
  Storage.set(MINT_PRICE_KEY, u64ToBytes(price));
  Storage.set(MAX_PER_WALLET_KEY, u32ToBytes(maxPerWallet));
  Storage.set(PUBLIC_MINT_KEY, boolToByte(open));
  generateEvent(
    createEvent(MINT_CONFIG_EVENT, [price.toString(), maxPerWallet.toString(), open.toString()]),
  );
}

// ==================================================== //
// ====                   READS                    ==== //
// ==================================================== //

export function name(_: StaticArray<u8>): StaticArray<u8> {
  return stringToBytes(_name());
}

export function symbol(_: StaticArray<u8>): StaticArray<u8> {
  return stringToBytes(_symbol());
}

/** Args: tokenId (u256). The token's own URI if set, else baseURI + id + ".json". */
export function uri(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const id = new Args(binaryArgs).nextU256().expect('tokenId argument is missing or invalid');
  assert(_ownerOf(id) != '', 'Nonexistent token');
  const own = TOKEN_URI_PREFIX.concat(u256ToBytes(id));
  if (Storage.has(own)) return Storage.get(own);
  return stringToBytes(_baseURI() + id.toString() + '.json');
}

/** Args: address (string). How many tokens the address minted through publicMint. */
export function mintedBy(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const address = new Args(binaryArgs)
    .nextString()
    .expect('address argument is missing or invalid');
  const key = MINTED_BY_PREFIX.concat(stringToBytes(address));
  return u32ToBytes(Storage.has(key) ? bytesToU32(Storage.get(key)) : 0);
}

/**
 * Returns Args: maxSupply (u256), minted (u256), totalSupply (u256), mintPrice (u64),
 * maxPerWallet (u32), publicMint (bool), baseURI (string), frozen (bool).
 */
export function mintInfo(_: StaticArray<u8>): StaticArray<u8> {
  return new Args()
    .add(bytesToU256(Storage.get(MAX_SUPPLY_KEY)))
    .add(_minted())
    .add(_totalSupply())
    .add(_mintPrice())
    .add(_maxPerWallet())
    .add(_isPublicMint())
    .add(_baseURI())
    .add(_isFrozen())
    .serialize();
}

/** Returns Args: template (string), templateVersion (string), mutable (bool). */
export function templateInfo(_: StaticArray<u8>): StaticArray<u8> {
  return new Args().add(TEMPLATE_NAME).add(TEMPLATE_VERSION).add(_isMutable()).serialize();
}

/** Args: from (string), to (string), tokenId (u256). Owner of the token or an approved address. */
export function transferFrom(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const from = args.nextString().expect('from argument is missing or invalid');
  const to = args.nextString().expect('to argument is missing or invalid');
  const tokenId = args.nextU256().expect('tokenId argument is missing or invalid');
  assertValidAddress(to, 'recipient');
  _transferFrom(from, to, tokenId);
}

function _minted(): u256 {
  return bytesToU256(Storage.get(MINTED_KEY));
}

function _baseURI(): string {
  return bytesToString(Storage.get(BASE_URI_KEY));
}

function _isFrozen(): bool {
  return byteToBool(Storage.get(FROZEN_KEY));
}

function _mintPrice(): u64 {
  return bytesToU64(Storage.get(MINT_PRICE_KEY));
}

function _maxPerWallet(): u32 {
  return bytesToU32(Storage.get(MAX_PER_WALLET_KEY));
}

function _isPublicMint(): bool {
  return byteToBool(Storage.get(PUBLIC_MINT_KEY));
}

export { totalSupply } from '@massalabs/sc-standards/assembly/contracts/MRC721/enumerable/MRC721Enumerable';
export {
  balanceOf,
  ownerOf,
  getApproved,
  isApprovedForAll,
  approve,
  setApprovalForAll,
} from '@massalabs/sc-standards/assembly/contracts/MRC721/MRC721';
export { setOwner, ownerAddress, isOwner } from '../lib/ownable';
