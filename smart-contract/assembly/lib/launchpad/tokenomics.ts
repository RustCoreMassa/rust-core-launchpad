// Tokenomics (phase 8): the owner of a token declares how its supply is split, in parts with a
// purpose, an amount, an optional description and an optional address holding the part. The
// Launchpad checks the shape (rules.ts, assertAllocations) and that the parts add up to the
// supply when declared; it doesn't lock or vest anything. Stored apart from the Project record
// (`tkm:<id>`), so records, pages and filters stay as they were.
import { Args, bytesToU256 } from '@massalabs/as-types';
import {
  Address,
  Context,
  Storage,
  balance,
  createEvent,
  generateEvent,
} from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import { _load, _onlyProjectOwner } from './common';
import {
  KIND_TOKEN,
  MRC20_TOTAL_SUPPLY_KEY,
  RC_TOKEN_MAX_SUPPLY_KEY,
  RC_TOKEN_MINTABLE_KEY,
  tokenomicsKey,
} from './keys';
import { Allocation, Project, SOURCE_LAUNCHED, Tokenomics } from './records';
import { assertAllocations } from './rules';
import { settle } from './settlement';

/**
 * Declares, replaces or (with an empty list) removes a token's tokenomics. Only the token
 * contract's current owner. Args: id (u64, registry id of the token), allocations
 * (Allocation[]). Coins: storage only, no platform fee; storage freed is refunded.
 */
export function setTokenomics(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  const args = new Args(binaryArgs);
  const id = args.nextU64().expect('id is missing or invalid');
  const allocations = args
    .nextSerializableObjectArray<Allocation>()
    .expect('allocations are missing or invalid');
  const project = _load(KIND_TOKEN, id);
  _onlyProjectOwner(project);
  if (allocations.length > 0) {
    assertAllocations(allocations, _baseSupply(project));
    _storeTokenomics(id, allocations);
  } else {
    const key = tokenomicsKey(id);
    assert(Storage.has(key), 'This token has no tokenomics');
    Storage.del(key);
    generateEvent(createEvent('TOKENOMICS_UPDATED', [id.toString(), '0']));
  }
  settle(before, 0);
}

/** Args: id (u64). Returns Tokenomics, or empty bytes when the owner declared none. */
export function getTokenomics(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const id = new Args(binaryArgs).nextU64().expect('id is missing or invalid');
  const key = tokenomicsKey(id);
  return Storage.has(key) ? Storage.get(key) : new StaticArray<u8>(0);
}

/** Writes checked allocations (createToken checks them before deploying). */
export function _storeTokenomics(id: u64, allocations: Allocation[]): void {
  const record = new Tokenomics(allocations, Context.timestamp());
  Storage.set(tokenomicsKey(id), record.serialize());
  generateEvent(createEvent('TOKENOMICS_UPDATED', [id.toString(), allocations.length.toString()]));
}

/**
 * What the parts must add up to, read from the token's storage: the max supply of an RC-Token
 * launched as mintable, else the current total supply (imports: the code is unknown, so only
 * the standard key counts).
 */
function _baseSupply(project: Project): u256 {
  const token = new Address(project.address);
  if (project.source == SOURCE_LAUNCHED && _isMintable(token)) {
    const max = Storage.getOf(token, RC_TOKEN_MAX_SUPPLY_KEY);
    assert(max.length == 32, 'Unreadable max supply');
    return bytesToU256(max);
  }
  assert(Storage.hasOf(token, MRC20_TOTAL_SUPPLY_KEY), 'Not a standard MRC20 token');
  const total = Storage.getOf(token, MRC20_TOTAL_SUPPLY_KEY);
  assert(total.length == 32, 'Not a standard MRC20 token');
  return bytesToU256(total);
}

function _isMintable(token: Address): bool {
  if (!Storage.hasOf(token, RC_TOKEN_MINTABLE_KEY)) return false;
  const flag = Storage.getOf(token, RC_TOKEN_MINTABLE_KEY);
  return flag.length == 1 && flag[0] == 1 && Storage.hasOf(token, RC_TOKEN_MAX_SUPPLY_KEY);
}
