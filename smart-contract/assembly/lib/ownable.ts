// Ownership shared by the RC templates. Same OWNER key and format as @massalabs/sc-standards
// (utils/ownership), so wallets, explorers and the Launchpad SC (Storage.getOf(contract, 'OWNER'))
// read it the standard way.
//
// Two differences from the standard:
// - setOwner checks that the new owner is a valid address (a typo would lock the contract);
// - renouncing writes an empty owner instead of deleting the key. The standard's _setOwner skips
//   the owner check when the key is missing, so a deleted key would let anyone claim ownership.
import { Args, boolToByte, stringToBytes } from '@massalabs/as-types';
import {
  Context,
  Storage,
  createEvent,
  generateEvent,
  validateAddress,
} from '@massalabs/massa-as-sdk';

export const OWNER_KEY = 'OWNER';
export const CHANGE_OWNER_EVENT = 'CHANGE_OWNER';
export const RENOUNCE_OWNERSHIP_EVENT = 'RENOUNCE_OWNERSHIP';

/** Sets the first owner, in a constructor. */
export function _initOwner(owner: string): void {
  assert(!Storage.has(OWNER_KEY), 'Owner is already set');
  assertValidAddress(owner, 'owner');
  Storage.set(OWNER_KEY, owner);
  generateEvent(createEvent(CHANGE_OWNER_EVENT, [owner]));
}

/** The current owner; empty once ownership was renounced. */
export function _owner(): string {
  return Storage.has(OWNER_KEY) ? Storage.get(OWNER_KEY) : '';
}

export function _onlyOwner(): void {
  const owner = _owner();
  assert(owner != '', 'The contract has no owner');
  assert(Context.caller().toString() == owner, 'Caller is not the owner');
}

export function assertValidAddress(address: string, what: string): void {
  assert(validateAddress(address), 'Invalid ' + what + ' address');
}

// ==================================================== //
// ====              EXPORTED FUNCTIONS            ==== //
// ==================================================== //

/** Transfers ownership. Args: newOwner (string). */
export function setOwner(binaryArgs: StaticArray<u8>): void {
  _onlyOwner();
  const newOwner = new Args(binaryArgs)
    .nextString()
    .expect('newOwner argument is missing or invalid');
  assertValidAddress(newOwner, 'new owner');
  Storage.set(OWNER_KEY, newOwner);
  generateEvent(createEvent(CHANGE_OWNER_EVENT, [newOwner]));
}

/** Gives up ownership for good: owner-only functions stop working forever. */
export function _renounceOwnership(): void {
  _onlyOwner();
  Storage.set(OWNER_KEY, '');
  generateEvent(RENOUNCE_OWNERSHIP_EVENT);
}

/** The owner's address as bytes; empty when there is no owner. */
export function ownerAddress(_: StaticArray<u8>): StaticArray<u8> {
  return stringToBytes(_owner());
}

/** Args: address (string). Returns a bool byte. */
export function isOwner(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const address = new Args(binaryArgs)
    .nextString()
    .expect('address argument is missing or invalid');
  const owner = _owner();
  return boolToByte(owner != '' && owner == address);
}
