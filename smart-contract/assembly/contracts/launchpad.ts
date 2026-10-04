// RustCore Launchpad — the platform's only contract: factory, registry, marketplace and presale
// (see docs/ANALYSIS.md). Phase 0 holds just the skeleton every later module builds on: the
// admin set at deploy time and the contract version.
import { Context, Storage, generateEvent } from '@massalabs/massa-as-sdk';
import { stringToBytes } from '@massalabs/as-types';

export const VERSION = '0.0.1';

export const ADMIN_KEY = stringToBytes('cfg:admin');

/** Runs once, at deploy time: the deployer becomes the admin. */
export function constructor(_: StaticArray<u8>): void {
  assert(Context.isDeployingContract(), 'constructor can only run at deploy time');
  Storage.set(ADMIN_KEY, stringToBytes(Context.caller().toString()));
  generateEvent('LAUNCHPAD_DEPLOYED');
}

export function version(_: StaticArray<u8>): StaticArray<u8> {
  return stringToBytes(VERSION);
}

export function admin(_: StaticArray<u8>): StaticArray<u8> {
  return Storage.get(ADMIN_KEY);
}
