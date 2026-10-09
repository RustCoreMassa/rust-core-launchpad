// Cross-check with the app: these bytes are createToken args produced by the app's own code
// (src/app/features/create/token-draft.ts, createTokenArgs). If the app and the contract ever
// disagree on the encoding, this test fails. Regenerate the bytes when the arguments change.
import { Args, bytesToU64, stringToBytes, u256ToBytes } from '@massalabs/as-types';
import {
  Address,
  Storage,
  changeCallStack,
  mockAdminContext,
  mockBalance,
  mockScCall,
  mockTransferredCoins,
  resetStorage,
  setDeployContext,
} from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import {
  constructor,
  count,
  createCollection,
  createToken,
  getProject,
  getTokenomics,
  setTemplate,
  setTokenomics,
} from '../contracts/launchpad';
import { KIND_COLLECTION, KIND_TOKEN, STD_OWNER_KEY } from '../lib/launchpad/keys';
import {
  Config,
  Listing,
  PRESALE_SUCCESS,
  Presale,
  Project,
  Sale,
  Tokenomics,
} from '../lib/launchpad/records';

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

// createTokenArgs with three tokenomics parts (token-draft.ts): 33.33 %, 999.9 tokens, 33.34 % of a
// 3 000-token max supply with 2 decimals; and setTokenomics args (tokenomics-dialog.ts).
const APP_CREATE_TOKEN_TOKENOMICS_ARGS: StaticArray<u8> = [
  11, 0, 0, 0, 67, 114, 111, 115, 115, 32, 83, 112, 108, 105, 116, 4, 0, 0, 0, 88, 83, 80, 76, 2,
  160, 134, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 1, 224, 147, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 228, 0, 0, 0, 7, 0, 0, 0, 69, 99, 104, 105, 112, 196, 131, 150, 134, 1, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 18, 0, 0, 0, 49, 50, 32, 108, 117,
  110, 105, 32, 226, 128, 148, 32, 98, 108, 111, 99, 97, 116, 53, 0, 0, 0, 65, 85, 49, 50, 54, 115,
  57, 51, 90, 120, 98, 84, 52, 81, 85, 74, 99, 90, 89, 113, 115, 65, 120, 121, 77, 99, 51, 119, 118,
  56, 110, 107, 72, 74, 89, 75, 89, 67, 116, 103, 81, 121, 69, 110, 90, 56, 86, 71, 82, 77, 57, 57,
  80, 9, 0, 0, 0, 76, 105, 113, 117, 105, 100, 105, 116, 121, 150, 134, 1, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0,
  67, 111, 109, 109, 117, 110, 105, 116, 121, 180, 134, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

const APP_SET_TOKENOMICS_ARGS: StaticArray<u8> = [
  1, 0, 0, 0, 0, 0, 0, 0, 55, 0, 0, 0, 11, 0, 0, 0, 70, 97, 105, 114, 32, 108, 97, 117, 110, 99,
  104, 224, 147, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
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

  test('logs a Presale record for the app to decode (records.spec.ts)', () => {
    const presale = new Presale(
      7,
      3,
      ALICE,
      ALICE,
      u256.fromU64(5_000_000),
      u256.fromU64(1_000),
      u64(10_000_000_000),
      u64(50_000_000_000),
      u64(100_000_000),
      0,
      u64(1_760_000_000_000),
      u64(1_760_086_400_000),
    );
    presale.raised = 12_000_000_000;
    presale.contributors = 4;
    presale.status = PRESALE_SUCCESS;
    presale.withdrawn = true;
    presale.feeBps = 250;
    log<string>('PRESALE_BYTES ' + presale.serialize().toString());
  });

  test('logs Config, Listing and Sale records for the app to decode (records.spec.ts)', () => {
    const config = new Config(5, 7, 3, 200, 100, true, 150);
    log<string>('CONFIG_BYTES ' + config.serialize().toString());
    const listing = new Listing(
      9,
      2,
      ALICE,
      u256.fromU64(42),
      ALICE,
      u64(5_000_000_000),
      u64(1_760_000_000_000),
      0,
      100,
    );
    log<string>('LISTING_BYTES ' + listing.serialize().toString());
    const sale = new Sale(
      3,
      9,
      2,
      u256.fromU64(42),
      ALICE,
      ALICE,
      u64(5_000_000_000),
      u64(250_000_000),
      u64(1_760_000_100_000),
      u64(50_000_000),
    );
    log<string>('SALE_BYTES ' + sale.serialize().toString());
  });

  test('createToken and setTokenomics decode the app’s tokenomics', () => {
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
    createToken(APP_CREATE_TOKEN_TOKENOMICS_ARGS);
    mockTransferredCoins(0);

    const read = (): Tokenomics =>
      new Args(getTokenomics(new Args().add(u64(1)).serialize()))
        .nextSerializable<Tokenomics>()
        .unwrap();
    let t = read();
    expect(t.allocations.length).toBe(3);
    expect(t.allocations[0].purpose).toBe('Echipă');
    expect(t.allocations[0].amount.toString()).toBe('99990');
    expect(t.allocations[0].description).toBe('12 luni — blocat');
    expect(t.allocations[0].holder).toBe('AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P');
    expect(t.allocations[1].amount.toString()).toBe('99990');
    expect(t.allocations[2].purpose).toBe('Community');
    expect(t.allocations[2].amount.toString()).toBe('100020');
    // The app decodes this record in src/app/core/launchpad/records.spec.ts.
    log<string>('TOKENOMICS_BYTES ' + getTokenomics(new Args().add(u64(1)).serialize()).toString());

    // setTokenomics: one 3 000.00-token part, the token being mintable up to that.
    const p = new Args(getProject(new Args().add(KIND_TOKEN).add(u64(1)).serialize()))
      .nextSerializable<Project>()
      .unwrap();
    const token = new Address(p.address);
    Storage.setOf(token, STD_OWNER_KEY, stringToBytes(ALICE));
    Storage.setOf<StaticArray<u8>>(token, stringToBytes('MINTABLE'), [1]);
    Storage.setOf(token, stringToBytes('MAX_SUPPLY'), u256ToBytes(u256.fromU64(300_000)));
    mockTransferredCoins(MAS);
    setTokenomics(APP_SET_TOKENOMICS_ARGS);
    mockTransferredCoins(0);
    t = read();
    expect(t.allocations.length).toBe(1);
    expect(t.allocations[0].purpose).toBe('Fair launch');
    expect(t.allocations[0].amount.toString()).toBe('300000');
  });
});
