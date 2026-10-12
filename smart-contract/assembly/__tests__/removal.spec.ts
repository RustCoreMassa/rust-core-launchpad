import { Args, bytesToU64, stringToBytes, u256ToBytes, u64ToBytes } from '@massalabs/as-types';
import {
  Address,
  Storage,
  changeCallStack,
  mockAdminContext,
  mockBalance,
  mockScCall,
  mockTimestamp,
  mockTransferredCoins,
  resetStorage,
  setBytecodeOf,
  setDeployContext,
} from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import {
  buyProblem,
  cancel,
  constructor,
  count,
  createToken,
  getCreatedBy,
  getProjects,
  getTokenomics,
  importCollection,
  importToken,
  isListingValid,
  isRemoved,
  isSymbolAvailable,
  list,
  removeProject,
  setTemplate,
} from '../contracts/launchpad';
import {
  KIND_COLLECTION,
  KIND_TOKEN,
  LOCK_KEY,
  STD_OWNER_KEY,
  addressKey,
  categoryKey,
  listingKey,
  presaleActiveKey,
} from '../lib/launchpad/keys';
import { Allocation, Config, Project, ProjectInfo } from '../lib/launchpad/records';

const LAUNCHPAD = 'AS12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1eT';
const ADMIN = 'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq';
const ALICE = 'AU12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1e8';
const BOB = 'AUDeadBeefDeadBeefDeadBeefDeadBeefDeadBeefDeadBOObs';
const IMPORTED = 'AS1ExternalExternalExternalExternalExternalExtern1';
const COLLECTION = 'AS1OtherOtherOtherOtherOtherOtherOtherOtherOther12';
const MAS: u64 = 1_000_000_000;

function callAs(user: string): void {
  changeCallStack(user + ' , ' + LAUNCHPAD);
}

function pay(user: string, sent: u64): void {
  mockBalance(LAUNCHPAD, 1_000 * MAS);
  mockBalance(user, 100 * MAS);
  callAs(user);
  mockTransferredCoins(sent);
}

function done(): void {
  mockTransferredCoins(0);
}

function deploy(): void {
  resetStorage();
  setDeployContext(ADMIN);
  constructor(new Args().add(new Config(MAS, MAS, MAS, 200, MAS / 10, false, 100)).serialize());
  mockAdminContext(false);
  callAs(ADMIN);
  setTemplate(new Args().add(KIND_TOKEN).add<StaticArray<u8>>([0, 97, 115, 109]).serialize());
  mockTimestamp(1_000_000);
}

/** Alice launches a fixed-supply token with this symbol, with tokenomics (one part). */
function launch(symbol: string): void {
  pay(ALICE, 10 * MAS);
  mockScCall([]);
  createToken(
    new Args()
      .add('RustCore Token')
      .add(symbol)
      .add(u8(18))
      .add(u256.fromU64(1_000))
      .add(false)
      .add(u256.Zero)
      .add(false)
      .add(false)
      .add(u8(1))
      .add(new ProjectInfo())
      .addSerializableObjectArray<Allocation>([new Allocation('All', u256.fromU64(1_000))])
      .serialize(),
  );
  done();
}

/** A standard contract owned by Alice: an MRC20 (token) or an MRC721 (collection). */
function fake(address: string, token: bool): void {
  const contract = new Address(address);
  Storage.setOf(contract, STD_OWNER_KEY, stringToBytes(ALICE));
  if (token) {
    Storage.setOf(contract, stringToBytes('NAME'), stringToBytes('Old Token'));
    Storage.setOf(contract, stringToBytes('SYMBOL'), stringToBytes('OLD'));
    Storage.setOf<StaticArray<u8>>(contract, stringToBytes('DECIMALS'), [18]);
    Storage.setOf(contract, stringToBytes('TOTAL_SUPPLY'), new StaticArray<u8>(32));
  } else {
    Storage.setOf<StaticArray<u8>>(contract, [0x01], stringToBytes('Cats'));
    Storage.setOf<StaticArray<u8>>(contract, [0x02], stringToBytes('CAT'));
  }
  setBytecodeOf(contract, [1, 2, 3]);
}

function importTokenArgs(): StaticArray<u8> {
  return new Args().add(IMPORTED).add(u8(0)).add(new ProjectInfo()).serialize();
}

function remove(user: string, kind: u8, id: u64): void {
  pay(user, MAS);
  removeProject(new Args().add(kind).add(id).serialize());
  done();
}

function page(kind: u8, offset: u64, limit: u32): Project[] {
  const args = new Args(getProjects(new Args().add(kind).add(offset).add(limit).serialize()));
  args.nextU64().unwrap();
  return args.nextSerializableObjectArray<Project>().unwrap();
}

function removed(address: string): bool {
  return isRemoved(new Args().add(address).serialize())[0] == 1;
}

describe('Removing a project', () => {
  test('a launched token leaves the registry; its symbol is free again', () => {
    deploy();
    launch('RCT');
    const address = page(KIND_TOKEN, 0, 1)[0].address;
    expect(isSymbolAvailable(new Args().add('RCT').serialize())[0]).toBe(0);
    expect(Storage.has(categoryKey(KIND_TOKEN, 1, 1))).toBe(true);
    remove(ADMIN, KIND_TOKEN, 1);
    expect(page(KIND_TOKEN, 0, 50).length).toBe(0);
    expect(removed(address)).toBe(true);
    expect(isSymbolAvailable(new Args().add('RCT').serialize())[0]).toBe(1);
    expect(getTokenomics(new Args().add(u64(1)).serialize()).length).toBe(0);
    expect(
      new Args(getCreatedBy(new Args().add(ALICE).add(KIND_TOKEN).serialize()))
        .nextFixedSizeArray<u64>()
        .unwrap().length,
    ).toBe(0);
    expect(Storage.has(categoryKey(KIND_TOKEN, 1, 1))).toBe(false);
    expect(Storage.has(addressKey(address))).toBe(false);
    // Ids are never reused: the count stays.
    expect(bytesToU64(count(new Args().add(KIND_TOKEN).serialize()))).toBe(1);
  });

  test('pages count ids, skipping the removed ones', () => {
    deploy();
    launch('AAA');
    launch('BBB');
    launch('CCC');
    remove(ADMIN, KIND_TOKEN, 2);
    const first = page(KIND_TOKEN, 0, 2);
    expect(first.length).toBe(1);
    expect(first[0].symbol).toBe('CCC');
    const second = page(KIND_TOKEN, 2, 2);
    expect(second.length).toBe(1);
    expect(second[0].symbol).toBe('AAA');
  });

  test('a reserved symbol stays reserved', () => {
    deploy();
    launch('RCT');
    // The record's symbol is RCT; its symbol entry now points elsewhere (reserved, empty).
    Storage.set(stringToBytes('s:RCT:'), new StaticArray<u8>(0));
    remove(ADMIN, KIND_TOKEN, 1);
    expect(Storage.has(stringToBytes('s:RCT:'))).toBe(true);
  });

  test('an imported token, without tokenomics or a symbol entry, is removed', () => {
    deploy();
    fake(IMPORTED, true);
    pay(ALICE, 10 * MAS);
    importToken(importTokenArgs());
    done();
    remove(ADMIN, KIND_TOKEN, 1);
    expect(removed(IMPORTED)).toBe(true);
    expect(page(KIND_TOKEN, 0, 50).length).toBe(0);
  });

  throws('importing the same contract again', () => {
    deploy();
    fake(IMPORTED, true);
    pay(ALICE, 10 * MAS);
    importToken(importTokenArgs());
    done();
    remove(ADMIN, KIND_TOKEN, 1);
    pay(ALICE, 10 * MAS);
    importToken(importTokenArgs());
  });

  throws('a removal by someone else', () => {
    deploy();
    launch('RCT');
    remove(BOB, KIND_TOKEN, 1);
  });

  throws('a removal while another call holds the lock', () => {
    deploy();
    launch('RCT');
    Storage.set(LOCK_KEY, new StaticArray<u8>(0));
    remove(ADMIN, KIND_TOKEN, 1);
  });

  throws('removing a project twice', () => {
    deploy();
    launch('RCT');
    remove(ADMIN, KIND_TOKEN, 1);
    remove(ADMIN, KIND_TOKEN, 1);
  });

  throws('removing a token with an open presale', () => {
    deploy();
    launch('RCT');
    Storage.set(presaleActiveKey(page(KIND_TOKEN, 0, 1)[0].address), u64ToBytes(1));
    remove(ADMIN, KIND_TOKEN, 1);
  });

  test('a removed collection’s listings become invalid, anyone can clean them up', () => {
    deploy();
    fake(COLLECTION, false);
    pay(ALICE, 10 * MAS);
    importCollection(
      new Args().add(COLLECTION).add(u16(0)).add('').add(u8(0)).add(new ProjectInfo()).serialize(),
    );
    done();
    const token = new StaticArray<u8>(1);
    token[0] = 0x04;
    Storage.setOf(
      new Address(COLLECTION),
      token.concat(u256ToBytes(u256.fromU64(1))),
      stringToBytes(ALICE),
    );
    const approval = new StaticArray<u8>(1);
    approval[0] = 0x05;
    Storage.setOf(
      new Address(COLLECTION),
      approval.concat(u256ToBytes(u256.fromU64(1))),
      stringToBytes(LAUNCHPAD),
    );
    pay(ALICE, MAS);
    list(
      new Args()
        .add(COLLECTION)
        .add(u256.fromU64(1))
        .add(5 * MAS)
        .add(u64(0))
        .serialize(),
    );
    done();
    expect(isListingValid(new Args().add(u64(1)).serialize())[0]).toBe(1);

    remove(ADMIN, KIND_COLLECTION, 1);
    expect(removed(COLLECTION)).toBe(true);
    expect(isListingValid(new Args().add(u64(1)).serialize())[0]).toBe(0);
    expect(
      String.UTF8.decode(
        changetype<ArrayBuffer>(buyProblem(new Args().add(u64(1)).add(BOB).serialize())),
      ),
    ).toBe('Not a Launchpad collection');
    pay(BOB, 0);
    cancel(new Args().add(u64(1)).serialize());
    done();
    expect(Storage.has(listingKey(1))).toBe(false);
  });
});
