// RC-Token v1 — the MRC20 template the Launchpad deploys (docs/ANALYSIS.md, "Șabloanele").
//
// Built on @massalabs/sc-standards 1.3.0: the standard's storage keys, transfers, allowances,
// mint and burn are reused as they are. Added on top:
// - an explicit owner in the constructor (the deployer is the Launchpad, not the user), who also
//   receives the initial supply;
// - mint only if launched as mintable, never above the max supply;
// - burn only if launched as burnable;
// - optional "mutable code" (upgrade by the owner), safe ownership transfer and renouncing.
//
// Storage writes are paid from this contract's balance, as for any MRC20: callers send MAS with
// calls that create entries (a new holder's balance, a new allowance).
import {
  Args,
  boolToByte,
  byteToBool,
  bytesToU256,
  stringToBytes,
  u256ToBytes,
} from '@massalabs/as-types';
import { Address, Storage, isDeployingContract } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import {
  DECIMALS_KEY,
  NAME_KEY,
  SYMBOL_KEY,
  TOTAL_SUPPLY_KEY,
} from '@massalabs/sc-standards/assembly/contracts/MRC20/MRC20';
import { _setBalance } from '@massalabs/sc-standards/assembly/contracts/MRC20/MRC20-internals';
import { _mint } from '@massalabs/sc-standards/assembly/contracts/MRC20/mintable/mint-internal';
import {
  burn as _standardBurn,
  burnFrom as _standardBurnFrom,
} from '@massalabs/sc-standards/assembly/contracts/MRC20/burnable/burn';
import { _initOwner, _onlyOwner, _renounceOwnership, assertValidAddress } from '../lib/ownable';
import { _initMutable, _isMutable, _upgrade } from '../lib/mutable';
import { MAX_NAME_LENGTH, MAX_SYMBOL_LENGTH, assertLength } from '../lib/validation';

export const TEMPLATE_NAME = 'RC-Token';
export const TEMPLATE_VERSION = '1.0.0';
export const MAX_DECIMALS: u8 = 18;

export const MINTABLE_KEY = stringToBytes('MINTABLE');
export const MAX_SUPPLY_KEY = stringToBytes('MAX_SUPPLY');
export const BURNABLE_KEY = stringToBytes('BURNABLE');

/**
 * Args: name (string), symbol (string), decimals (u8), initialSupply (u256), owner (string),
 * mintable (bool), maxSupply (u256), burnable (bool), mutable (bool).
 * A fixed-supply token ignores `maxSupply` (it equals the initial supply).
 */
export function constructor(binaryArgs: StaticArray<u8>): void {
  assert(isDeployingContract(), 'constructor can only run at deploy time');
  const args = new Args(binaryArgs);
  const name = args.nextString().expect('name argument is missing or invalid');
  const symbol = args.nextString().expect('symbol argument is missing or invalid');
  const decimals = args.nextU8().expect('decimals argument is missing or invalid');
  const initialSupply = args.nextU256().expect('initialSupply argument is missing or invalid');
  const owner = args.nextString().expect('owner argument is missing or invalid');
  const mintable = args.nextBool().expect('mintable argument is missing or invalid');
  const requestedMax = args.nextU256().expect('maxSupply argument is missing or invalid');
  const burnable = args.nextBool().expect('burnable argument is missing or invalid');
  const mutable = args.nextBool().expect('mutable argument is missing or invalid');

  assertLength(name, 1, MAX_NAME_LENGTH, 'Name');
  assertLength(symbol, 1, MAX_SYMBOL_LENGTH, 'Symbol');
  assert(decimals <= MAX_DECIMALS, 'Decimals must be at most 18');
  assertValidAddress(owner, 'owner');
  const maxSupply = mintable ? requestedMax : initialSupply;
  if (mintable) {
    assert(maxSupply > u256.Zero, 'Max supply must be greater than zero');
    assert(maxSupply >= initialSupply, 'Max supply is below the initial supply');
  } else {
    assert(initialSupply > u256.Zero, 'A fixed supply must be greater than zero');
  }

  Storage.set(NAME_KEY, stringToBytes(name));
  Storage.set(SYMBOL_KEY, stringToBytes(symbol));
  Storage.set(DECIMALS_KEY, [decimals]);
  Storage.set(TOTAL_SUPPLY_KEY, u256ToBytes(initialSupply));
  Storage.set(MINTABLE_KEY, boolToByte(mintable));
  Storage.set(MAX_SUPPLY_KEY, u256ToBytes(maxSupply));
  Storage.set(BURNABLE_KEY, boolToByte(burnable));
  _initMutable(mutable);
  _initOwner(owner);
  if (initialSupply > u256.Zero) _setBalance(new Address(owner), initialSupply);
}

// ==================================================== //
// ====                 MINT / BURN                ==== //
// ==================================================== //

/** Args: recipient (string), amount (u256). Owner only, mintable tokens only, up to the max. */
export function mint(binaryArgs: StaticArray<u8>): void {
  _onlyOwner();
  assert(_isMintable(), 'This token is not mintable');
  const args = new Args(binaryArgs);
  const recipient = args.nextString().expect('recipient argument is missing or invalid');
  const amount = args.nextU256().expect('amount argument is missing or invalid');
  assertValidAddress(recipient, 'recipient');
  assert(amount > u256.Zero, 'Amount must be greater than zero');
  const supply = bytesToU256(Storage.get(TOTAL_SUPPLY_KEY));
  const max = bytesToU256(Storage.get(MAX_SUPPLY_KEY));
  assert(supply <= max && amount <= max - supply, 'Mint would exceed the max supply');
  _mint(binaryArgs);
}

/** Args: amount (u256). Burns the caller's tokens; burnable tokens only. */
export function burn(binaryArgs: StaticArray<u8>): void {
  assert(_isBurnable(), 'This token is not burnable');
  _standardBurn(binaryArgs);
}

/** Args: owner (string), amount (u256). Burns with an allowance; burnable tokens only. */
export function burnFrom(binaryArgs: StaticArray<u8>): void {
  assert(_isBurnable(), 'This token is not burnable');
  _standardBurnFrom(binaryArgs);
}

// ==================================================== //
// ====            OWNERSHIP AND CODE              ==== //
// ==================================================== //

export function renounceOwnership(_: StaticArray<u8>): void {
  _renounceOwnership();
}

/** Args: bytecode (bytes). Only if the token was launched with mutable code. */
export function upgrade(binaryArgs: StaticArray<u8>): void {
  _upgrade(binaryArgs);
}

/**
 * What the Launchpad and the app show about this contract. Returns Args: template (string),
 * templateVersion (string), mintable (bool), maxSupply (u256), burnable (bool), mutable (bool).
 */
export function templateInfo(_: StaticArray<u8>): StaticArray<u8> {
  return new Args()
    .add(TEMPLATE_NAME)
    .add(TEMPLATE_VERSION)
    .add(_isMintable())
    .add(bytesToU256(Storage.get(MAX_SUPPLY_KEY)))
    .add(_isBurnable())
    .add(_isMutable())
    .serialize();
}

function _isMintable(): bool {
  return byteToBool(Storage.get(MINTABLE_KEY));
}

function _isBurnable(): bool {
  return byteToBool(Storage.get(BURNABLE_KEY));
}

export {
  version,
  name,
  symbol,
  decimals,
  totalSupply,
  balanceOf,
  transfer,
  allowance,
  increaseAllowance,
  decreaseAllowance,
  transferFrom,
} from '@massalabs/sc-standards/assembly/contracts/MRC20/MRC20';
export { setOwner, ownerAddress, isOwner } from '../lib/ownable';
