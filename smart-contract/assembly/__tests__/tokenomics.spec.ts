import { Args, bytesToU64, stringToBytes, u256ToBytes } from '@massalabs/as-types';
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
  constructor,
  count,
  createToken,
  getProject,
  getTokenomics,
  importToken,
  setTemplate,
  setTokenomics,
} from '../contracts/launchpad';
import { KIND_TOKEN, LOCK_KEY, STD_OWNER_KEY } from '../lib/launchpad/keys';
import { Allocation, Config, Project, ProjectInfo, Tokenomics } from '../lib/launchpad/records';

const LAUNCHPAD = 'AS12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1eT';
const ADMIN = 'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq';
const ALICE = 'AU12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1e8';
const BOB = 'AUDeadBeefDeadBeefDeadBeefDeadBeefDeadBeefDeadBOObs';
const IMPORTED = 'AS1ExternalExternalExternalExternalExternalExtern1';

const MAS: u64 = 1_000_000_000;
const NOW: u64 = 1_790_000_000_000;
const SUPPLY: u64 = 1_000_000;
const MAX: u64 = 5_000_000;

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

function part(
  purpose: string,
  amount: u64,
  description: string = '',
  holder: string = '',
): Allocation {
  return new Allocation(purpose, u256.fromU64(amount), description, holder);
}

/** Team 20 %, Liquidity 30 %, Community 50 % of `total`. */
function split(total: u64): Allocation[] {
  return [
    part('Team', (total / 10) * 2, '12 months cliff', BOB),
    part('Liquidity', (total / 10) * 3, '', LAUNCHPAD),
    part('Community', total - (total / 10) * 5),
  ];
}

function tokenArgs(mintable: bool, max: u64): Args {
  return new Args()
    .add('RustCore Token')
    .add('RCT')
    .add(u8(18))
    .add(u256.fromU64(SUPPLY))
    .add(mintable)
    .add(u256.fromU64(max))
    .add(false)
    .add(false)
    .add(u8(1))
    .add(new ProjectInfo());
}

function deploy(): void {
  resetStorage();
  setDeployContext(ADMIN);
  constructor(new Args().add(new Config(MAS, MAS, MAS, 200, MAS / 10, false)).serialize());
  mockAdminContext(false);
  callAs(ADMIN);
  setTemplate(new Args().add(KIND_TOKEN).add<StaticArray<u8>>([0, 97, 115, 109]).serialize());
  mockTimestamp(NOW);
}

/** Alice launches token #1 with these createToken args. */
function launch(args: Args): void {
  pay(ALICE, 10 * MAS);
  mockScCall([]); // the template's constructor
  createToken(args.serialize());
  done();
}

function tokenAddress(id: u64): Address {
  const bytes = getProject(new Args().add(KIND_TOKEN).add(id).serialize());
  return new Address(new Args(bytes).nextSerializable<Project>().unwrap().address);
}

/** What RC-Token's constructor writes, as far as tokenomics reads it. */
function tokenStorage(token: Address, owner: string, total: u64, mintable: bool, max: u64): void {
  Storage.setOf(token, STD_OWNER_KEY, stringToBytes(owner));
  Storage.setOf(token, stringToBytes('TOTAL_SUPPLY'), u256ToBytes(u256.fromU64(total)));
  Storage.setOf<StaticArray<u8>>(token, stringToBytes('MINTABLE'), [mintable ? 1 : 0]);
  Storage.setOf(token, stringToBytes('MAX_SUPPLY'), u256ToBytes(u256.fromU64(max)));
}

/** Deploy + Alice's fixed-supply token #1, owned by Alice, without tokenomics. */
function fixedToken(): Address {
  deploy();
  launch(tokenArgs(false, 0));
  const token = tokenAddress(1);
  tokenStorage(token, ALICE, SUPPLY, false, SUPPLY);
  return token;
}

/** Deploy + token #1 owned by Alice, with only some of RC-Token's keys written. */
function partialToken(total: bool, mintable: bool, max: bool): Address {
  deploy();
  launch(tokenArgs(false, 0));
  const token = tokenAddress(1);
  Storage.setOf(token, STD_OWNER_KEY, stringToBytes(ALICE));
  if (total) Storage.setOf(token, stringToBytes('TOTAL_SUPPLY'), u256ToBytes(u256.fromU64(SUPPLY)));
  if (mintable) Storage.setOf<StaticArray<u8>>(token, stringToBytes('MINTABLE'), [1]);
  if (max) Storage.setOf(token, stringToBytes('MAX_SUPPLY'), u256ToBytes(u256.fromU64(MAX)));
  return token;
}

/** A valid u256 followed by 32 more bytes (as-bignum itself refuses lengths not ×32). */
function longer(value: u256): StaticArray<u8> {
  const bytes = u256ToBytes(value);
  const out = new StaticArray<u8>(64);
  for (let i = 0; i < 32; i++) out[i] = bytes[i];
  return out;
}

function declare(user: string, id: u64, parts: Allocation[]): void {
  pay(user, MAS);
  setTokenomics(new Args().add(id).addSerializableObjectArray<Allocation>(parts).serialize());
  done();
}

function read(id: u64): Tokenomics {
  return new Args(getTokenomics(new Args().add(id).serialize()))
    .nextSerializable<Tokenomics>()
    .unwrap();
}

function hasTokenomics(id: u64): bool {
  return getTokenomics(new Args().add(id).serialize()).length > 0;
}

describe('Tokenomics at launch', () => {
  test('createToken stores the parts in order, dated', () => {
    deploy();
    launch(tokenArgs(false, 0).addSerializableObjectArray<Allocation>(split(SUPPLY)));
    const t = read(1);
    expect(t.allocations.length).toBe(3);
    expect(t.allocations[0].purpose).toBe('Team');
    expect(t.allocations[0].amount.toString()).toBe('200000');
    expect(t.allocations[0].description).toBe('12 months cliff');
    expect(t.allocations[0].holder).toBe(BOB);
    expect(t.allocations[1].holder).toBe(LAUNCHPAD);
    expect(t.allocations[2].amount.toString()).toBe('500000');
    expect(t.updatedAt).toBe(NOW);
  });

  test('older createToken calls (no tokenomics) work unchanged', () => {
    deploy();
    launch(tokenArgs(false, 0));
    expect(bytesToU64(count(new Args().add(KIND_TOKEN).serialize()))).toBe(1);
    expect(hasTokenomics(1)).toBe(false);
  });

  test('an empty list at launch stores nothing', () => {
    deploy();
    launch(tokenArgs(false, 0).addSerializableObjectArray<Allocation>([]));
    expect(hasTokenomics(1)).toBe(false);
  });

  test('a mintable token splits its max supply', () => {
    deploy();
    launch(tokenArgs(true, MAX).addSerializableObjectArray<Allocation>(split(MAX)));
    expect(read(1).allocations[2].amount.toString()).toBe('2500000');
  });

  throws('a mintable token splitting only its initial supply', () => {
    deploy();
    launch(tokenArgs(true, MAX).addSerializableObjectArray<Allocation>(split(SUPPLY)));
  });

  throws('parts that miss the supply at launch', () => {
    deploy();
    launch(tokenArgs(false, 0).addSerializableObjectArray<Allocation>(split(SUPPLY - 10)));
  });

  throws('unreadable tokenomics bytes at launch', () => {
    deploy();
    launch(tokenArgs(false, 0).add<u8>(7));
  });
});

describe('Tokenomics edits', () => {
  test('the owner declares, then replaces the whole list', () => {
    fixedToken();
    declare(ALICE, 1, split(SUPPLY));
    expect(read(1).allocations.length).toBe(3);
    mockTimestamp(NOW + 1_000);
    declare(ALICE, 1, [part('Fair launch', SUPPLY)]);
    const t = read(1);
    expect(t.allocations.length).toBe(1);
    expect(t.allocations[0].purpose).toBe('Fair launch');
    expect(t.updatedAt).toBe(NOW + 1_000);
  });

  test('an empty list removes it', () => {
    fixedToken();
    declare(ALICE, 1, split(SUPPLY));
    declare(ALICE, 1, []);
    expect(hasTokenomics(1)).toBe(false);
  });

  throws('removing tokenomics that were never declared', () => {
    fixedToken();
    declare(ALICE, 1, []);
  });

  test('a new owner declares after an ownership transfer', () => {
    const token = fixedToken();
    Storage.setOf(token, STD_OWNER_KEY, stringToBytes(BOB));
    declare(BOB, 1, split(SUPPLY));
    expect(hasTokenomics(1)).toBe(true);
  });

  throws('a declaration by someone else', () => {
    fixedToken();
    declare(BOB, 1, split(SUPPLY));
  });

  throws('a declaration once ownership was renounced', () => {
    const token = fixedToken();
    Storage.setOf(token, STD_OWNER_KEY, stringToBytes(''));
    declare(ALICE, 1, split(SUPPLY));
  });

  throws('a token that is not in the Launchpad', () => {
    fixedToken();
    declare(ALICE, 2, split(SUPPLY));
  });

  throws('a declaration while another call holds the lock', () => {
    fixedToken();
    Storage.set(LOCK_KEY, new StaticArray<u8>(0));
    declare(ALICE, 1, split(SUPPLY));
  });
});

describe('Tokenomics supply base', () => {
  test('a fixed token splits its current total supply (after burns)', () => {
    const token = fixedToken();
    tokenStorage(token, ALICE, SUPPLY - 1_000, false, SUPPLY);
    declare(ALICE, 1, split(SUPPLY - 1_000));
    expect(hasTokenomics(1)).toBe(true);
  });

  throws('a fixed token split by its former supply', () => {
    const token = fixedToken();
    tokenStorage(token, ALICE, SUPPLY - 1_000, false, SUPPLY);
    declare(ALICE, 1, split(SUPPLY));
  });

  test('a launched mintable token splits its max supply', () => {
    const token = fixedToken();
    tokenStorage(token, ALICE, SUPPLY, true, MAX);
    declare(ALICE, 1, split(MAX));
    expect(hasTokenomics(1)).toBe(true);
  });

  throws('a launched mintable token split by its total supply', () => {
    const token = fixedToken();
    tokenStorage(token, ALICE, SUPPLY, true, MAX);
    declare(ALICE, 1, split(SUPPLY));
  });

  test('without a max supply key, the total supply counts', () => {
    partialToken(true, true, false);
    declare(ALICE, 1, split(SUPPLY));
    expect(hasTokenomics(1)).toBe(true);
  });

  throws('an unreadable max supply', () => {
    const token = fixedToken();
    tokenStorage(token, ALICE, SUPPLY, true, MAX);
    // 64 bytes whose first 32 are a valid max: only the length check refuses it.
    Storage.setOf(token, stringToBytes('MAX_SUPPLY'), longer(u256.fromU64(MAX)));
    declare(ALICE, 1, split(MAX));
  });

  throws('a token without a total supply', () => {
    partialToken(false, false, false);
    declare(ALICE, 1, split(SUPPLY));
  });

  throws('an unreadable total supply', () => {
    const token = fixedToken();
    Storage.setOf(token, stringToBytes('TOTAL_SUPPLY'), longer(u256.fromU64(SUPPLY)));
    declare(ALICE, 1, split(SUPPLY));
  });

  test('an imported token splits its total supply, whatever keys it has', () => {
    deploy();
    const token = new Address(IMPORTED);
    tokenStorage(token, ALICE, SUPPLY, true, MAX);
    Storage.setOf(token, stringToBytes('NAME'), stringToBytes('Old Token'));
    Storage.setOf(token, stringToBytes('SYMBOL'), stringToBytes('OLD'));
    Storage.setOf<StaticArray<u8>>(token, stringToBytes('DECIMALS'), [18]);
    setBytecodeOf(token, [1, 2, 3]);
    pay(ALICE, 10 * MAS);
    importToken(new Args().add(IMPORTED).add(u8(0)).add(new ProjectInfo()).serialize());
    done();
    declare(ALICE, 1, split(SUPPLY));
    expect(hasTokenomics(1)).toBe(true);
  });
});

describe('Tokenomics rules', () => {
  test('30 parts, a 40-character purpose and a 140-character description', () => {
    fixedToken();
    const parts: Allocation[] = [];
    for (let i = 0; i < 29; i++) parts.push(part('Part ' + i.toString(), 1));
    parts.push(part('P'.repeat(40), SUPPLY - 29, 'd'.repeat(140)));
    declare(ALICE, 1, parts);
    expect(read(1).allocations.length).toBe(30);
  });

  throws('31 parts', () => {
    fixedToken();
    const parts: Allocation[] = [];
    for (let i = 0; i < 30; i++) parts.push(part('Part ' + i.toString(), 1));
    parts.push(part('Rest', SUPPLY - 30));
    declare(ALICE, 1, parts);
  });

  throws('an empty purpose', () => {
    fixedToken();
    declare(ALICE, 1, [part('', SUPPLY)]);
  });

  throws('a 41-character purpose', () => {
    fixedToken();
    declare(ALICE, 1, [part('P'.repeat(41), SUPPLY)]);
  });

  throws('a purpose that ends with a space', () => {
    fixedToken();
    declare(ALICE, 1, [part('Team ', SUPPLY)]);
  });

  throws('a purpose with a control character', () => {
    fixedToken();
    declare(ALICE, 1, [part('Te\tam', SUPPLY)]);
  });

  throws('a 141-character description', () => {
    fixedToken();
    declare(ALICE, 1, [part('Team', SUPPLY, 'd'.repeat(141))]);
  });

  throws('a description on two lines', () => {
    fixedToken();
    declare(ALICE, 1, [part('Team', SUPPLY, 'cliff\nvesting')]);
  });

  throws('an address that is not one', () => {
    fixedToken();
    declare(ALICE, 1, [part('Team', SUPPLY, '', 'nope')]);
  });

  throws('a part of zero', () => {
    fixedToken();
    declare(ALICE, 1, [part('Team', SUPPLY), part('Nothing', 0)]);
  });

  throws('parts above the supply', () => {
    fixedToken();
    declare(ALICE, 1, [part('Team', SUPPLY), part('More', 1)]);
  });

  throws('parts below the supply', () => {
    fixedToken();
    declare(ALICE, 1, [part('Team', SUPPLY - 1)]);
  });

  throws('amounts that would wrap around u256', () => {
    fixedToken();
    // u256.Max + 1 wraps to 0: without the guard, the sum would be exactly SUPPLY.
    declare(ALICE, 1, [new Allocation('Huge', u256.Max), part('One', 1), part('Rest', SUPPLY)]);
  });
});
