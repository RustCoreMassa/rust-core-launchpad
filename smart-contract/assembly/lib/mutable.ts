// "Mutable code" option of the RC templates (docs/ANALYSIS.md, "Contracte mutabile"): chosen once,
// in the constructor. A mutable contract's owner can replace its bytecode; an immutable one has
// no way to change, ever. The Launchpad keeps only the original code — after an upgrade, the
// owner is responsible for the new one.
import { Args, boolToByte, byteToBool, stringToBytes } from '@massalabs/as-types';
import { Storage, generateEvent, setBytecode } from '@massalabs/massa-as-sdk';
import { _onlyOwner } from './ownable';

export const MUTABLE_KEY = stringToBytes('MUTABLE');
export const UPGRADE_EVENT = 'CODE_UPGRADED';

export function _initMutable(mutable: bool): void {
  Storage.set(MUTABLE_KEY, boolToByte(mutable));
}

export function _isMutable(): bool {
  return Storage.has(MUTABLE_KEY) && byteToBool(Storage.get(MUTABLE_KEY));
}

/** Args: bytecode (bytes). Owner only, and only if the contract was launched as mutable. */
export function _upgrade(binaryArgs: StaticArray<u8>): void {
  _onlyOwner();
  assert(_isMutable(), 'This contract is immutable');
  const bytecode = new Args(binaryArgs)
    .nextBytes()
    .expect('bytecode argument is missing or invalid');
  assert(bytecode.length > 0, 'Empty bytecode');
  setBytecode(bytecode);
  generateEvent(UPGRADE_EVENT);
}
