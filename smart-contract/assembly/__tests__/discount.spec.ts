import { Args, bytesToU16, bytesToU64, stringToBytes, u256ToBytes } from '@massalabs/as-types';
import {
  Address,
  Storage,
  balanceOf as masBalanceOf,
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
  createCollection,
  createPresale,
  createToken,
  fees,
  getHolderDiscount,
  getListing,
  getPresale,
  holderDiscount,
  importCollection,
  importToken,
  list,
  setHolderDiscount,
  setTemplate,
} from '../contracts/launchpad';
import { _lessDiscount, _lessDiscountBps } from '../lib/launchpad/discount';
import { KIND_COLLECTION, KIND_TOKEN, STD_OWNER_KEY } from '../lib/launchpad/keys';
import { Config, HolderDiscount, Listing, Presale, ProjectInfo } from '../lib/launchpad/records';

const LAUNCHPAD = 'AS12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1eT';
const ADMIN = 'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq';
const ALICE = 'AU12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1e8';
const BOB = 'AUDeadBeefDeadBeefDeadBeefDeadBeefDeadBeefDeadBOObs';
/** The membership collection (RustCore's own NFTs). */
const PASS = 'AS1PassPassPassPassPassPassPassPassPassPassPassPas1';
/** Contracts Alice owns and imports, or sells NFTs of. */
const TOKEN = 'AS1ExternalExternalExternalExternalExternalExtern1';
const CATS = 'AS1OtherOtherOtherOtherOtherOtherOtherOtherOther12';

const MAS: u64 = 1_000_000_000;
const TOKEN_FEE: u64 = 100 * MAS;
const COLLECTION_FEE: u64 = 200 * MAS;
const IMPORT_FEE: u64 = 50 * MAS;
const PRESALE_FEE_BPS: u16 = 200;
const MARKET_FEE_BPS: u16 = 100;
const DEPOSIT: u64 = MAS / 10;
const DISCOUNT_BPS: u16 = 1_000; // 10 %
const NOW: u64 = 10_000_000;
const HOUR: u64 = 60 * 60 * 1000;

function callAs(user: string): void {
  changeCallStack(user + ' , ' + LAUNCHPAD);
}

function pay(user: string, sent: u64): void {
  mockBalance(LAUNCHPAD, 10_000 * MAS);
  mockBalance(user, 1_000 * MAS);
  callAs(user);
  mockTransferredCoins(sent);
}

function done(): void {
  mockTransferredCoins(0);
}

function currentFees(): u64 {
  return bytesToU64(fees([]));
}

/** A standard MRC721 (name + symbol keys) with bytecode, owned by `owner`. */
function fakeCollection(address: string, owner: string): void {
  const contract = new Address(address);
  Storage.setOf(contract, STD_OWNER_KEY, stringToBytes(owner));
  Storage.setOf<StaticArray<u8>>(contract, [0x01], stringToBytes('Cats'));
  Storage.setOf<StaticArray<u8>>(contract, [0x02], stringToBytes('CAT'));
  setBytecodeOf(contract, [1, 2, 3]);
}

/** A standard MRC20 with bytecode, owned by `owner`. */
function fakeToken(address: string, owner: string): void {
  const contract = new Address(address);
  Storage.setOf(contract, STD_OWNER_KEY, stringToBytes(owner));
  Storage.setOf(contract, stringToBytes('NAME'), stringToBytes('Old Token'));
  Storage.setOf(contract, stringToBytes('SYMBOL'), stringToBytes('OLD'));
  Storage.setOf<StaticArray<u8>>(contract, stringToBytes('DECIMALS'), [18]);
  Storage.setOf(contract, stringToBytes('TOTAL_SUPPLY'), new StaticArray<u8>(32));
  setBytecodeOf(contract, [4, 5, 6]);
}

/** Sets `holder`'s standard MRC721 balance in the PASS collection (0x03 + address → u256). */
function passBalance(holder: string, amount: u64): void {
  const key: StaticArray<u8> = [0x03];
  Storage.setOf(
    new Address(PASS),
    key.concat(stringToBytes(holder)),
    u256ToBytes(u256.fromU64(amount)),
  );
}

/** Launchpad with mainnet-like fees, both templates, and the PASS collection deployed. */
function deploy(): void {
  resetStorage();
  setDeployContext(ADMIN);
  constructor(
    new Args()
      .add(
        new Config(
          TOKEN_FEE,
          COLLECTION_FEE,
          IMPORT_FEE,
          PRESALE_FEE_BPS,
          DEPOSIT,
          false,
          MARKET_FEE_BPS,
        ),
      )
      .serialize(),
  );
  mockAdminContext(false);
  callAs(ADMIN);
  setTemplate(new Args().add(KIND_TOKEN).add<StaticArray<u8>>([0, 97, 115, 109]).serialize());
  setTemplate(new Args().add(KIND_COLLECTION).add<StaticArray<u8>>([0, 97, 115, 110]).serialize());
  fakeCollection(PASS, ADMIN);
  mockTimestamp(NOW);
}

function setDiscount(collection: string, bps: u16): void {
  pay(ADMIN, MAS);
  setHolderDiscount(new Args().add(collection).add(bps).serialize());
  done();
}

/** Deploy, then a 10% discount for PASS holders; Alice holds one PASS NFT. */
function setup(): void {
  deploy();
  setDiscount(PASS, DISCOUNT_BPS);
  passBalance(ALICE, 1);
}

function discountOf(address: string): u16 {
  return bytesToU16(getHolderDiscount(new Args().add(address).serialize()));
}

function launchToken(user: string, symbol: string): void {
  pay(user, 200 * MAS);
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
      .add(u8(0))
      .add(new ProjectInfo())
      .serialize(),
  );
  done();
}

function launchCollection(user: string): void {
  pay(user, 300 * MAS);
  mockScCall([]);
  createCollection(
    new Args()
      .add('RustCore Cats')
      .add('RCAT')
      .add(u256.fromU64(100))
      .add('ipfs://bafyCats/')
      .add(MAS)
      .add(u32(3))
      .add(true)
      .add(false)
      .add(u16(0))
      .add('')
      .add(u8(0))
      .add(new ProjectInfo())
      .serialize(),
  );
  done();
}

function importTokenAs(user: string): void {
  fakeToken(TOKEN, user);
  pay(user, 100 * MAS);
  importToken(new Args().add(TOKEN).add(u8(0)).add(new ProjectInfo()).serialize());
  done();
}

function importCollectionAs(user: string): void {
  fakeCollection(CATS, user);
  pay(user, 100 * MAS);
  importCollection(
    new Args().add(CATS).add(u16(0)).add('').add(u8(0)).add(new ProjectInfo()).serialize(),
  );
  done();
}

/** Alice imports CATS, then `seller` lists token 1 of it (owned and approved). */
function listAs(seller: string): Listing {
  importCollectionAs(ALICE);
  const owner: StaticArray<u8> = [0x04];
  const approval: StaticArray<u8> = [0x05];
  const tokenId = u256ToBytes(u256.One);
  Storage.setOf(new Address(CATS), owner.concat(tokenId), stringToBytes(seller));
  Storage.setOf(new Address(CATS), approval.concat(tokenId), stringToBytes(LAUNCHPAD));
  pay(seller, MAS);
  list(
    new Args()
      .add(CATS)
      .add(u256.One)
      .add(10 * MAS)
      .add(u64(0))
      .serialize(),
  );
  done();
  return new Args(getListing(new Args().add(u64(1)).serialize()))
    .nextSerializable<Listing>()
    .unwrap();
}

/** Alice imports TOKEN and starts a presale of it; the tokens arrive in escrow. */
function presaleByAlice(): Presale {
  importTokenAs(ALICE);
  const forSale = u256.fromU64(100_000) * u256.fromU64(1_000_000_000_000_000_000);
  Storage.setOf(new Address(TOKEN), stringToBytes('BALANCE' + LAUNCHPAD), u256ToBytes(forSale));
  pay(ALICE, MAS);
  mockScCall([]); // transferFrom
  createPresale(
    new Args()
      .add(TOKEN)
      .add(forSale)
      .add(u256.fromU64(1_000) * u256.fromU64(1_000_000_000_000_000_000))
      .add(50 * MAS)
      .add(100 * MAS)
      .add(MAS)
      .add(40 * MAS)
      .add(NOW + HOUR)
      .add(NOW + 25 * HOUR)
      .serialize(),
  );
  done();
  return new Args(getPresale(new Args().add(u64(1)).serialize()))
    .nextSerializable<Presale>()
    .unwrap();
}

describe('Holder discount settings', () => {
  test('none at deploy', () => {
    deploy();
    expect(holderDiscount([]).length).toBe(0);
    passBalance(ALICE, 1);
    expect(discountOf(ALICE)).toBe(0);
  });

  test('the admin names the collection and the discount', () => {
    setup();
    const stored = new Args(holderDiscount([])).nextSerializable<HolderDiscount>().unwrap();
    expect(stored.collection).toBe(PASS);
    expect(stored.bps).toBe(DISCOUNT_BPS);
  });

  test('an empty collection turns the discount off', () => {
    setup();
    setDiscount('', 0);
    expect(holderDiscount([]).length).toBe(0);
    expect(discountOf(ALICE)).toBe(0);
    setDiscount('', 0); // already off: still fine
    expect(holderDiscount([]).length).toBe(0);
  });

  test('accepts 50%', () => {
    deploy();
    setDiscount(PASS, 5_000);
    passBalance(ALICE, 1);
    expect(discountOf(ALICE)).toBe(5_000);
  });

  throws('a change by someone else', () => {
    setup();
    pay(ALICE, MAS);
    setHolderDiscount(new Args().add(PASS).add(u16(5_000)).serialize());
  });

  throws('a discount above 50%', () => {
    deploy();
    setDiscount(PASS, 5_001);
  });

  throws('a zero discount for a collection', () => {
    deploy();
    setDiscount(PASS, 0);
  });

  throws('a contract that is not an MRC721 collection', () => {
    deploy();
    fakeToken(TOKEN, ADMIN);
    setDiscount(TOKEN, DISCOUNT_BPS);
  });

  throws('a wallet address as the collection', () => {
    deploy();
    setDiscount(BOB, DISCOUNT_BPS);
  });
});

describe('Holder discount: who holds', () => {
  test('one NFT or more', () => {
    setup();
    expect(discountOf(ALICE)).toBe(DISCOUNT_BPS);
    passBalance(ALICE, 3);
    expect(discountOf(ALICE)).toBe(DISCOUNT_BPS);
  });

  test('not someone without a balance entry', () => {
    setup();
    expect(discountOf(BOB)).toBe(0);
  });

  test('not someone who sold every NFT (balance zero)', () => {
    setup();
    passBalance(ALICE, 0);
    expect(discountOf(ALICE)).toBe(0);
  });

  test('a balance above 2^64 still counts', () => {
    setup();
    const key: StaticArray<u8> = [0x03];
    Storage.setOf(
      new Address(PASS),
      key.concat(stringToBytes(BOB)),
      u256ToBytes(new u256(0, 0, 0, 1)),
    );
    expect(discountOf(BOB)).toBe(DISCOUNT_BPS);
  });

  test('not a holder of another collection', () => {
    setup();
    fakeCollection(CATS, ADMIN);
    const key: StaticArray<u8> = [0x03];
    Storage.setOf(new Address(CATS), key.concat(stringToBytes(BOB)), u256ToBytes(u256.One));
    expect(discountOf(BOB)).toBe(0);
  });
});

describe('Holder discount on fees', () => {
  test('token launch: a holder pays 90%', () => {
    setup();
    launchToken(ALICE, 'RCT');
    expect(currentFees()).toBe(90 * MAS);
    expect(masBalanceOf(ALICE)).toBe(1_000 * MAS - 90 * MAS - DEPOSIT);
  });

  test('token launch: anyone else pays the full fee', () => {
    setup();
    launchToken(BOB, 'RCT');
    expect(currentFees()).toBe(TOKEN_FEE);
  });

  test('collection launch', () => {
    setup();
    launchCollection(ALICE);
    expect(currentFees()).toBe(180 * MAS);
  });

  test('token import', () => {
    setup();
    importTokenAs(ALICE);
    expect(currentFees()).toBe(45 * MAS);
  });

  test('collection import', () => {
    setup();
    importCollectionAs(ALICE);
    expect(currentFees()).toBe(45 * MAS);
  });

  test('presale: the fee fixed at creation is 90% of it', () => {
    setup();
    expect(presaleByAlice().feeBps).toBe(180);
  });

  test('presale: full fee without an NFT', () => {
    deploy();
    setDiscount(PASS, DISCOUNT_BPS);
    expect(presaleByAlice().feeBps).toBe(PRESALE_FEE_BPS);
  });

  test('listing: the fee fixed for a holder seller is 90% of it', () => {
    setup();
    expect(listAs(ALICE).feeBps).toBe(90);
  });

  test('listing: full fee for a seller without an NFT', () => {
    setup();
    expect(listAs(BOB).feeBps).toBe(MARKET_FEE_BPS);
  });

  test('no discount once it is turned off', () => {
    setup();
    setDiscount('', 0);
    launchToken(ALICE, 'RCT');
    expect(currentFees()).toBe(TOKEN_FEE);
  });
});

describe('Holder discount arithmetic', () => {
  test('rounds the discount down', () => {
    expect(_lessDiscount(100 * MAS, 1_000)).toBe(90 * MAS);
    expect(_lessDiscount(9_999, 1_000)).toBe(9_000); // 999.9 off → 999
    expect(_lessDiscount(u64.MAX_VALUE, 5_000)).toBe(u64.MAX_VALUE - u64.MAX_VALUE / 2);
    expect(_lessDiscount(0, 1_000)).toBe(0);
    expect(_lessDiscount(50 * MAS, 0)).toBe(50 * MAS);
  });

  test('on basis points', () => {
    expect(_lessDiscountBps(200, 1_000)).toBe(180);
    expect(_lessDiscountBps(100, 1_000)).toBe(90);
    expect(_lessDiscountBps(15, 1_000)).toBe(14); // 1.5 off → 1
    expect(_lessDiscountBps(1_000, 5_000)).toBe(500);
    expect(_lessDiscountBps(u16.MAX_VALUE, 5_000)).toBe(u16.MAX_VALUE - u16.MAX_VALUE / 2);
  });
});
