// Cross-check with the app: these bytes are createToken args produced by the app's own code
// (src/app/features/create/token-draft.ts, createTokenArgs). If the app and the contract ever
// disagree on the encoding, this test fails. Regenerate the bytes when the arguments change.
import { Args, bytesToU64 } from '@massalabs/as-types';
import {
  changeCallStack,
  mockAdminContext,
  mockBalance,
  mockScCall,
  mockTransferredCoins,
  resetStorage,
  setDeployContext,
} from '@massalabs/massa-as-sdk';
import {
  constructor,
  count,
  createCollection,
  createToken,
  getProject,
  setTemplate,
} from '../contracts/launchpad';
import { KIND_COLLECTION, KIND_TOKEN } from '../lib/launchpad/keys';
import { Config, Project } from '../lib/launchpad/records';

const LAUNCHPAD = 'AS12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1eT';
const ADMIN = 'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq';
const ALICE = 'AU12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1e8';
const MAS: u64 = 1_000_000_000;

// createCollectionArgs (src/app/features/create/collection-draft.ts), same purpose.
const APP_CREATE_COLLECTION_ARGS: StaticArray<u8> = [
  10, 0, 0, 0, 67, 114, 111, 115, 115, 32, 67, 97, 116, 115, 4, 0, 0, 0, 88, 67, 65, 84, 244, 1, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 17, 0, 0,
  0, 105, 112, 102, 115, 58, 47, 47, 98, 97, 102, 121, 67, 114, 111, 115, 115, 47, 0, 47, 104, 89,
  0, 0, 0, 0, 4, 0, 0, 0, 1, 0, 250, 0, 0, 0, 0, 0, 3, 15, 0, 0, 0, 80, 105, 115, 105, 99, 105, 32,
  226, 128, 148, 32, 116, 101, 115, 116, 0, 0, 0, 0, 0, 0, 0, 0, 17, 0, 0, 0, 104, 116, 116, 112,
  115, 58, 47, 47, 120, 46, 101, 120, 97, 109, 112, 108, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

const APP_CREATE_TOKEN_ARGS: StaticArray<u8> = [
  11, 0, 0, 0, 67, 114, 111, 115, 115, 32, 67, 104, 101, 99, 107, 4, 0, 0, 0, 88, 67, 72, 75, 6,
  160, 249, 148, 73, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 1, 0, 148, 53, 119, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 1, 0, 2, 12, 0, 0, 0, 200, 154, 97, 114, 196, 131, 10, 110, 111, 117, 196, 131, 0, 0,
  0, 0, 0, 0, 0, 0, 17, 0, 0, 0, 104, 116, 116, 112, 115, 58, 47, 47, 120, 46, 101, 120, 97, 109,
  112, 108, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

describe('app ↔ contract encoding', () => {
  test('createToken decodes the app’s arguments', () => {
    resetStorage();
    setDeployContext(ADMIN);
    constructor(new Args().add(new Config(MAS, MAS, MAS, 200, MAS / 10, false)).serialize());
    mockAdminContext(false);
    changeCallStack(ADMIN + ' , ' + LAUNCHPAD);
    setTemplate(new Args().add(KIND_TOKEN).add<StaticArray<u8>>([0, 97, 115, 109]).serialize());

    mockBalance(LAUNCHPAD, 1_000 * MAS);
    mockBalance(ALICE, 100 * MAS);
    changeCallStack(ALICE + ' , ' + LAUNCHPAD);
    mockTransferredCoins(10 * MAS);
    mockScCall([]);
    createToken(APP_CREATE_TOKEN_ARGS);
    mockTransferredCoins(0);

    expect(bytesToU64(count(new Args().add(KIND_TOKEN).serialize()))).toBe(1);
    const bytes = getProject(new Args().add(KIND_TOKEN).add(u64(1)).serialize());
    const p = new Args(bytes).nextSerializable<Project>().unwrap();
    expect(p.name).toBe('Cross Check');
    expect(p.symbol).toBe('XCHK');
    expect(p.decimals).toBe(6);
    expect(p.mutable).toBe(false);
    expect(p.category).toBe(2);
    expect(p.info.description).toBe('Țară\nnouă');
    expect(p.info.website).toBe('https://x.example');
    // The app decodes this record in src/app/core/launchpad/records.spec.ts.
    log<string>('PROJECT_BYTES ' + bytes.toString());
  });

  test('createCollection decodes the app’s arguments', () => {
    resetStorage();
    setDeployContext(ADMIN);
    constructor(new Args().add(new Config(MAS, MAS, MAS, 200, MAS / 10, false)).serialize());
    mockAdminContext(false);
    changeCallStack(ADMIN + ' , ' + LAUNCHPAD);
    setTemplate(
      new Args().add(KIND_COLLECTION).add<StaticArray<u8>>([0, 97, 115, 109]).serialize(),
    );

    mockBalance(LAUNCHPAD, 1_000 * MAS);
    mockBalance(ALICE, 100 * MAS);
    changeCallStack(ALICE + ' , ' + LAUNCHPAD);
    mockTransferredCoins(10 * MAS);
    mockScCall([]);
    createCollection(APP_CREATE_COLLECTION_ARGS);
    mockTransferredCoins(0);

    const p = new Args(getProject(new Args().add(KIND_COLLECTION).add(u64(1)).serialize()))
      .nextSerializable<Project>()
      .unwrap();
    expect(p.name).toBe('Cross Cats');
    expect(p.symbol).toBe('XCAT');
    expect(p.royaltyBps).toBe(250);
    expect(p.royaltyReceiver).toBe(ALICE); // empty in the args = the creator
    expect(p.category).toBe(3);
    expect(p.info.description).toBe('Pisici — test');
  });
});
