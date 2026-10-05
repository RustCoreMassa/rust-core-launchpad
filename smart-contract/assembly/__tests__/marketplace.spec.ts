import { Args, bytesToString, bytesToU64, stringToBytes, u256ToBytes } from '@massalabs/as-types';
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
  buy,
  buyProblem,
  cancel,
  constructor,
  getListing,
  getListings,
  getListingsBySeller,
  getSales,
  getStats,
  importCollection,
  isListingValid,
  list,
  listingOf,
  setHidden,
  setPaused,
  updatePrice,
} from '../contracts/launchpad';
import { KIND_COLLECTION, LOCK_KEY, STD_OWNER_KEY } from '../lib/launchpad/keys';
import { Config, Listing, MarketStats, ProjectInfo } from '../lib/launchpad/records';

const LAUNCHPAD = 'AS12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1eT';
const ADMIN = 'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq';
const ALICE = 'AU12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1e8';
const BOB = 'AUDeadBeefDeadBeefDeadBeefDeadBeefDeadBeefDeadBOObs';
const CAROL = 'AU1CarolCarolCarolCarolCarolCarolCarolCarolCarol12';
const COLLECTION = 'AS1ExternalExternalExternalExternalExternalExtern1';
const OTHER = 'AS1OtherOtherOtherOtherOtherOtherOtherOtherOther12';

const MAS: u64 = 1_000_000_000;
const PRICE: u64 = 10 * MAS;
const DAY: u64 = 24 * 60 * 60 * 1000;
const NOW: u64 = 1_000_000;

function callAs(user: string): void {
  changeCallStack(user + ' , ' + LAUNCHPAD);
}

/** `user` calls with 100 MAS in their wallet and `sent` coins; the Launchpad holds funds too. */
function pay(user: string, sent: u64): void {
  mockBalance(LAUNCHPAD, 1_000 * MAS);
  mockBalance(user, 100 * MAS);
  callAs(user);
  mockTransferredCoins(sent);
}

function done(): void {
  mockTransferredCoins(0);
}

function tokenKey(prefix: u8, id: u64): StaticArray<u8> {
  const key = new StaticArray<u8>(1);
  key[0] = prefix;
  return key.concat(u256ToBytes(u256.fromU64(id)));
}

function setTokenOwner(address: string, id: u64, owner: string): void {
  Storage.setOf(new Address(address), tokenKey(0x04, id), stringToBytes(owner));
}

function approveLaunchpad(address: string, id: u64): void {
  Storage.setOf(new Address(address), tokenKey(0x05, id), stringToBytes(LAUNCHPAD));
}

function approveOperator(address: string, owner: string): void {
  const key = new StaticArray<u8>(1);
  key[0] = 0x06;
  Storage.setOf<StaticArray<u8>>(
    new Address(address),
    key.concat(stringToBytes(owner)).concat(stringToBytes(LAUNCHPAD)),
    [1],
  );
}

/** A standard MRC721 owned by ADMIN, imported into the Launchpad (collection id 1), 5% royalty. */
function makeCollection(address: string): void {
  const contract = new Address(address);
  Storage.setOf(contract, STD_OWNER_KEY, stringToBytes(ADMIN));
  Storage.setOf<StaticArray<u8>>(contract, [0x01], stringToBytes('Cats'));
  Storage.setOf<StaticArray<u8>>(contract, [0x02], stringToBytes('CAT'));
  setBytecodeOf(contract, [1, 2, 3]);
  pay(ADMIN, 10 * MAS);
  importCollection(
    new Args().add(address).add(u16(500)).add(CAROL).add(u8(0)).add(new ProjectInfo()).serialize(),
  );
  done();
}

/** Launchpad + an imported collection; ALICE holds tokens 1 and 2, token 1 approved. */
function setup(): void {
  resetStorage();
  setDeployContext(ADMIN);
  constructor(new Args().add(new Config(MAS, MAS, MAS, 200, MAS / 10, false)).serialize());
  mockAdminContext(false);
  makeCollection(COLLECTION);
  setTokenOwner(COLLECTION, 1, ALICE);
  setTokenOwner(COLLECTION, 2, ALICE);
  approveLaunchpad(COLLECTION, 1);
  mockTimestamp(NOW);
}

function listArgs(tokenId: u64, price: u64 = PRICE, expiresAt: u64 = 0): StaticArray<u8> {
  return new Args()
    .add(COLLECTION)
    .add(u256.fromU64(tokenId))
    .add(price)
    .add(expiresAt)
    .serialize();
}

/** ALICE lists token 1; returns the listing id. */
function aliceLists(tokenId: u64 = 1, expiresAt: u64 = 0): u64 {
  pay(ALICE, MAS);
  list(listArgs(tokenId, PRICE, expiresAt));
  done();
  return bytesToU64(listingOf(new Args().add(COLLECTION).add(u256.fromU64(tokenId)).serialize()));
}

function listing(id: u64): Listing {
  return new Args(getListing(new Args().add(id).serialize())).nextSerializable<Listing>().unwrap();
}

function valid(id: u64): bool {
  return isListingValid(new Args().add(id).serialize())[0] == 1;
}

function problem(id: u64, buyer: string): string {
  return bytesToString(buyProblem(new Args().add(id).add(buyer).serialize()));
}

function idArgs(id: u64): StaticArray<u8> {
  return new Args().add(id).serialize();
}

describe('Marketplace listing', () => {
  test('the owner lists an approved NFT', () => {
    setup();
    const id = aliceLists();
    expect(id).toBe(1);
    const l = listing(id);
    expect(l.seller).toBe(ALICE);
    expect(l.collectionId).toBe(1);
    expect(l.tokenId).toBe(u256.One);
    expect(l.price).toBe(PRICE);
    expect(valid(id)).toBe(true);
    const page = new Args(getListings(new Args().add(u64(1)).add(u64(0)).add(u32(10)).serialize()));
    expect(page.nextU64().unwrap()).toBe(1);
    expect(page.nextSerializableObjectArray<Listing>().unwrap()[0].id).toBe(1);
    const mine = new Args(getListingsBySeller(new Args().add(ALICE).serialize()));
    expect(mine.nextFixedSizeArray<u64>().unwrap()).toStrictEqual([1]);
  });

  test('an operator approval works too', () => {
    setup();
    approveOperator(COLLECTION, ALICE);
    expect(aliceLists(2)).toBe(1);
  });

  test('lists newest first across collections', () => {
    setup();
    approveLaunchpad(COLLECTION, 2);
    aliceLists(1);
    aliceLists(2);
    const page = new Args(getListings(new Args().add(u64(0)).add(u64(0)).add(u32(10)).serialize()));
    expect(page.nextU64().unwrap()).toBe(2);
    const listings = page.nextSerializableObjectArray<Listing>().unwrap();
    expect(listings[0].id).toBe(2);
    expect(listings[1].id).toBe(1);
  });

  throws('a token the caller does not own', () => {
    setup();
    pay(BOB, MAS);
    list(listArgs(1));
  });

  throws('a token without approval', () => {
    setup();
    aliceLists(2);
  });

  throws('a price of zero', () => {
    setup();
    pay(ALICE, MAS);
    list(listArgs(1, 0));
  });

  throws('an expiry in the past', () => {
    setup();
    aliceLists(1, NOW - 1);
  });

  throws('an expiry beyond a year', () => {
    setup();
    aliceLists(1, NOW + 366 * DAY);
  });

  throws('an NFT of a collection outside the Launchpad', () => {
    setup();
    setTokenOwner(OTHER, 1, ALICE);
    pay(ALICE, MAS);
    list(new Args().add(OTHER).add(u256.One).add(PRICE).add(u64(0)).serialize());
  });

  throws('an NFT of a hidden collection', () => {
    setup();
    callAs(ADMIN);
    setHidden(new Args().add(KIND_COLLECTION).add(u64(1)).add(true).serialize());
    aliceLists();
  });

  throws('listing while paused', () => {
    setup();
    callAs(ADMIN);
    setPaused(new Args().add(true).serialize());
    aliceLists();
  });

  throws('listing the same NFT twice', () => {
    setup();
    aliceLists();
    aliceLists();
  });

  test('a new owner relists over a stale listing', () => {
    setup();
    const old = aliceLists();
    setTokenOwner(COLLECTION, 1, BOB);
    approveLaunchpad(COLLECTION, 1);
    expect(valid(old)).toBe(false);
    pay(BOB, MAS);
    list(listArgs(1));
    done();
    expect(isListingValid(idArgs(old))).toStrictEqual([0]); // removed
    const fresh = bytesToU64(listingOf(new Args().add(COLLECTION).add(u256.One).serialize()));
    expect(listing(fresh).seller).toBe(BOB);
  });

  throws('any write while a sale is running (reentrancy lock)', () => {
    setup();
    Storage.set(LOCK_KEY, [1]);
    aliceLists();
  });
});

describe('Marketplace price and cancel', () => {
  test('the seller changes the price', () => {
    setup();
    const id = aliceLists();
    pay(ALICE, 0);
    updatePrice(
      new Args()
        .add(id)
        .add(5 * MAS)
        .serialize(),
    );
    expect(listing(id).price).toBe(5 * MAS);
  });

  throws('a price change to zero', () => {
    setup();
    const id = aliceLists();
    pay(ALICE, 0);
    updatePrice(new Args().add(id).add(u64(0)).serialize());
  });

  throws('a price change by someone else', () => {
    setup();
    const id = aliceLists();
    pay(BOB, 0);
    updatePrice(new Args().add(id).add(MAS).serialize());
  });

  test('the seller cancels', () => {
    setup();
    const id = aliceLists();
    pay(ALICE, 0);
    cancel(idArgs(id));
    expect(valid(id)).toBe(false);
    expect(bytesToU64(listingOf(new Args().add(COLLECTION).add(u256.One).serialize()))).toBe(0);
  });

  throws('a stranger cancelling a valid listing', () => {
    setup();
    const id = aliceLists();
    pay(BOB, 0);
    cancel(idArgs(id));
  });

  test('anyone cleans up a listing whose NFT moved', () => {
    setup();
    const id = aliceLists();
    setTokenOwner(COLLECTION, 1, BOB);
    pay(CAROL, 0);
    cancel(idArgs(id));
    expect(valid(id)).toBe(false);
  });

  test('anyone cleans up an expired listing', () => {
    setup();
    const id = aliceLists(1, NOW + DAY);
    mockTimestamp(NOW + DAY);
    pay(CAROL, 0);
    cancel(idArgs(id));
  });

  test('the admin removes a listing', () => {
    setup();
    const id = aliceLists();
    pay(ADMIN, 0);
    cancel(idArgs(id));
  });

  test('cancelling works while paused', () => {
    setup();
    const id = aliceLists();
    callAs(ADMIN);
    setPaused(new Args().add(true).serialize());
    pay(ALICE, 0);
    cancel(idArgs(id));
  });
});

describe('Marketplace buy (rules; the full sale runs on buildnet)', () => {
  test('explains why a purchase is not possible (the rules buy enforces)', () => {
    setup();
    const id = aliceLists(1, NOW + DAY);
    expect(problem(id, BOB)).toBe('');
    expect(problem(id, ALICE)).toBe('This is your own listing');
    approveLaunchpad(COLLECTION, 2);
    Storage.setOf(new Address(COLLECTION), tokenKey(0x05, 1), stringToBytes(OTHER));
    expect(problem(id, BOB)).toBe('The seller withdrew the approval');
    approveLaunchpad(COLLECTION, 1);
    setTokenOwner(COLLECTION, 1, CAROL);
    expect(problem(id, BOB)).toBe('The seller no longer owns this NFT');
    setTokenOwner(COLLECTION, 1, ALICE);
    callAs(ADMIN);
    setHidden(new Args().add(KIND_COLLECTION).add(u64(1)).add(true).serialize());
    expect(problem(id, BOB)).toBe('This collection is hidden');
    setHidden(new Args().add(KIND_COLLECTION).add(u64(1)).add(false).serialize());
    mockTimestamp(NOW + DAY);
    expect(problem(id, BOB)).toBe('This listing has expired');
    expect(problem(99, BOB)).toBe('This listing is no longer active');
  });

  throws('buying your own listing', () => {
    setup();
    const id = aliceLists();
    pay(ALICE, PRICE + MAS);
    buy(idArgs(id));
  });

  throws('buying an expired listing', () => {
    setup();
    const id = aliceLists(1, NOW + DAY);
    mockTimestamp(NOW + DAY);
    pay(BOB, PRICE + MAS);
    buy(idArgs(id));
  });

  throws('buying when the seller no longer owns the NFT', () => {
    setup();
    const id = aliceLists();
    setTokenOwner(COLLECTION, 1, CAROL);
    pay(BOB, PRICE + MAS);
    buy(idArgs(id));
  });

  throws('buying when the approval was withdrawn', () => {
    setup();
    const id = aliceLists();
    Storage.setOf(new Address(COLLECTION), tokenKey(0x05, 1), stringToBytes(OTHER));
    pay(BOB, PRICE + MAS);
    buy(idArgs(id));
  });

  throws('buying from a hidden collection', () => {
    setup();
    const id = aliceLists();
    callAs(ADMIN);
    setHidden(new Args().add(KIND_COLLECTION).add(u64(1)).add(true).serialize());
    pay(BOB, PRICE + MAS);
    buy(idArgs(id));
  });

  throws('a collection whose transferFrom does not move the NFT', () => {
    setup();
    const id = aliceLists();
    pay(BOB, PRICE + MAS);
    mockScCall([]); // transferFrom "succeeds" but the owner stays ALICE
    buy(idArgs(id));
  });

  test('stats start at zero', () => {
    setup();
    const stats = new Args(getStats(new Args().add(u64(1)).serialize()))
      .nextSerializable<MarketStats>()
      .unwrap();
    expect(stats.sales).toBe(0);
    expect(stats.volume).toBe(0);
  });

  throws('reading a listing that is gone', () => {
    setup();
    getListing(idArgs(1));
  });

  throws('a listings page larger than 50', () => {
    setup();
    getListings(new Args().add(u64(0)).add(u64(0)).add(u32(51)).serialize());
  });

  throws('a sales page larger than 50', () => {
    setup();
    getSales(new Args().add(u64(1)).add(u64(0)).add(u32(51)).serialize());
  });
});
