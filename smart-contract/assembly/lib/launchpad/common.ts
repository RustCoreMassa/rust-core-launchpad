// Internals shared by the Launchpad's modules (registry, marketplace, presale).
import { Args, bytesToString, bytesToU64, u64ToBytes } from '@massalabs/as-types';
import { Address, Context, Storage } from '@massalabs/massa-as-sdk';
import {
  ADMIN_KEY,
  CONFIG_KEY,
  STD_OWNER_KEY,
  addressKey,
  countKey,
  projectKey,
  u64FromBE,
} from './keys';
import { Config, Project } from './records';

export function _config(): Config {
  return new Args(Storage.get(CONFIG_KEY)).nextSerializable<Config>().unwrap();
}

export function _activeConfig(): Config {
  const config = _config();
  assert(!config.paused, 'The Launchpad is paused');
  return config;
}

export function _onlyAdmin(): void {
  assert(
    Context.caller().toString() == bytesToString(Storage.get(ADMIN_KEY)),
    'Caller is not the admin',
  );
}

export function _count(kind: u8): u64 {
  const key = countKey(kind);
  return Storage.has(key) ? bytesToU64(Storage.get(key)) : 0;
}

export function _nextId(kind: u8): u64 {
  const id = _count(kind) + 1;
  Storage.set(countKey(kind), u64ToBytes(id));
  return id;
}

export function _load(kind: u8, id: u64): Project {
  const key = projectKey(kind, id);
  assert(Storage.has(key), 'Unknown project');
  return new Args(Storage.get(key)).nextSerializable<Project>().unwrap();
}

/** The contract's current owner, read from the standard OWNER key; empty if none. */
export function _ownerOf(contract: Address): string {
  return Storage.hasOf(contract, STD_OWNER_KEY)
    ? bytesToString(Storage.getOf(contract, STD_OWNER_KEY))
    : '';
}

/** The registry record of a contract address, or null when it isn't in the Launchpad. */
export function _projectByAddress(address: string): Project | null {
  const key = addressKey(address);
  if (!Storage.has(key)) return null;
  const ref = Storage.get(key);
  return _load(ref[0], u64FromBE(ref, 1));
}

export function _isAdmin(address: string): bool {
  return address == bytesToString(Storage.get(ADMIN_KEY));
}
