import { Args, bytesToString, bytesToU256 } from '@massalabs/as-types';
import {
  balanceOf as masBalanceOf,
  changeCallStack,
  mockAdminContext,
  mockBalance,
  mockTransferredCoins,
  resetStorage,
  setDeployContext,
} from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import {
  approve,
  balanceOf,
  constructor,
  freezeMetadata,
  mintInfo,
  mintedBy,
  name,
  ownerAddress,
  ownerMint,
  ownerMintWithURI,
  ownerOf,
  publicMint,
  reduceMaxSupply,
  renounceOwnership,
  setBaseURI,
  setMintConfig,
  symbol,
  templateInfo,
  totalSupply,
  transferFrom,
  upgrade,
  uri,
} from '../contracts/rc-collection';

// The contract address the vm-mock runs as.
const CONTRACT = 'AS12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1eT';
const LAUNCHPAD = 'AS1LaunchpadLaunchpadLaunchpadLaunchpadLaunchpad12';
const OWNER = 'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq';
const ALICE = 'AU12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1e8';
const BOB = 'AUDeadBeefDeadBeefDeadBeefDeadBeefDeadBeefDeadBOObs';

const BASE = 'ipfs://bafyCollection/';
const MAS: u64 = 1_000_000_000;
const PRICE: u64 = 2 * MAS;

function collectionArgs(
  owner: string,
  maxSupply: u64,
  baseURI: string,
  price: u64,
  maxPerWallet: u32,
  open: bool,
  mutable: bool,
): StaticArray<u8> {
  return new Args()
    .add('RustCore Cats')
    .add('RCAT')
    .add(owner)
    .add(u256.fromU64(maxSupply))
    .add(baseURI)
    .add(price)
    .add(maxPerWallet)
    .add(open)
    .add(mutable)
    .serialize();
}

/** Deploys the collection the way the Launchpad does: the Launchpad is the caller. */
function deploy(args: StaticArray<u8>): void {
  resetStorage();
  setDeployContext(LAUNCHPAD);
  constructor(args);
  mockAdminContext(false);
}

/** 10 tokens max, IPFS folder, public mint open at 2 MAS, 2 per wallet, immutable. */
function deployDefault(): void {
  deploy(collectionArgs(OWNER, 10, BASE, PRICE, 2, true, false));
}

function callAs(user: string): void {
  changeCallStack(user + ' , ' + CONTRACT);
}

function id(value: u64): StaticArray<u8> {
  return new Args().add(u256.fromU64(value)).serialize();
}

function ownerOfToken(value: u64): string {
  return bytesToString(ownerOf(id(value)));
}

function nftBalance(address: string): u256 {
  return bytesToU256(balanceOf(new Args().add(address).serialize()));
}

function uriOf(value: u64): string {
  return bytesToString(uri(id(value)));
}

function mintTo(to: string, count: u32): StaticArray<u8> {
  return new Args().add(to).add(count).serialize();
}

/**
 * Alice calls publicMint(count) holding 10 MAS and sending `sent`. The contract gets a large
 * balance of its own first: the vm-mock doesn't credit it with the coins sent, and a contract
 * with funds is the case where only the payment rule stops an underpaid mint.
 */
function alicePublicMint(count: u32, sent: u64): void {
  mockBalance(CONTRACT, 1_000 * MAS);
  mockBalance(ALICE, 10 * MAS);
  callAs(ALICE);
  mockTransferredCoins(sent);
  publicMint(new Args().add(count).serialize());
  mockTransferredCoins(0);
}

function transferArgs(from: string, to: string, token: u64): StaticArray<u8> {
  return new Args().add(from).add(to).add(u256.fromU64(token)).serialize();
}

describe('RC-Collection constructor', () => {
  test('stores the collection and makes the user the owner', () => {
    deployDefault();
    expect(bytesToString(name([]))).toBe('RustCore Cats');
    expect(bytesToString(symbol([]))).toBe('RCAT');
    expect(bytesToString(ownerAddress([]))).toBe(OWNER);
    const info = new Args(mintInfo([]));
    expect(info.nextU256().unwrap()).toBe(u256.fromU64(10)); // max supply
    expect(info.nextU256().unwrap()).toBe(u256.Zero); // minted
    expect(info.nextU256().unwrap()).toBe(u256.Zero); // total supply
    expect(info.nextU64().unwrap()).toBe(PRICE);
    expect(info.nextU32().unwrap()).toBe(2); // max per wallet
    expect(info.nextBool().unwrap()).toBe(true); // public mint
    expect(info.nextString().unwrap()).toBe(BASE);
    expect(info.nextBool().unwrap()).toBe(false); // frozen
    const template = new Args(templateInfo([]));
    expect(template.nextString().unwrap()).toBe('RC-Collection');
    expect(template.nextString().unwrap()).toBe('1.0.0');
    expect(template.nextBool().unwrap()).toBe(false); // mutable
  });

  test('runs only at deploy time', () => {
    deployDefault();
    expect(() => {
      constructor(collectionArgs(BOB, 1, BASE, 0, 0, false, false));
    }).toThrow();
  });

  throws('a max supply of zero', () => {
    deploy(collectionArgs(OWNER, 0, BASE, 0, 0, false, false));
  });

  throws('an open public mint without a base URI', () => {
    deploy(collectionArgs(OWNER, 10, '', PRICE, 0, true, false));
  });

  throws('an invalid owner address', () => {
    deploy(collectionArgs('nope', 10, BASE, 0, 0, false, false));
  });
});

describe('RC-Collection owner mint', () => {
  test('mints sequential ids with base URI metadata', () => {
    deployDefault();
    callAs(OWNER);
    ownerMint(mintTo(ALICE, 3));
    expect(ownerOfToken(1)).toBe(ALICE);
    expect(ownerOfToken(3)).toBe(ALICE);
    expect(nftBalance(ALICE)).toBe(u256.fromU64(3));
    expect(bytesToU256(totalSupply([]))).toBe(u256.fromU64(3));
    expect(uriOf(2)).toBe(BASE + '2.json');
  });

  test('gives a token its own URI when the collection has no base URI', () => {
    deploy(collectionArgs(OWNER, 10, '', 0, 0, false, false));
    callAs(OWNER);
    ownerMintWithURI(new Args().add(BOB).add('ipfs://bafyOne/meta.json').serialize());
    expect(ownerOfToken(1)).toBe(BOB);
    expect(uriOf(1)).toBe('ipfs://bafyOne/meta.json');
  });

  throws('by someone other than the owner', () => {
    deployDefault();
    callAs(ALICE);
    ownerMint(mintTo(ALICE, 1));
  });

  throws('above the max supply', () => {
    deployDefault();
    callAs(OWNER);
    ownerMint(mintTo(ALICE, 11));
  });

  throws('zero tokens', () => {
    deployDefault();
    callAs(OWNER);
    ownerMint(mintTo(ALICE, 0));
  });

  throws('more than 50 tokens in one call', () => {
    deploy(collectionArgs(OWNER, 100, BASE, 0, 0, false, false));
    callAs(OWNER);
    ownerMint(mintTo(ALICE, 51));
  });

  throws('a batch mint without a base URI', () => {
    deploy(collectionArgs(OWNER, 10, '', 0, 0, false, false));
    callAs(OWNER);
    ownerMint(mintTo(ALICE, 1));
  });

  throws('the URI of a token that does not exist', () => {
    deployDefault();
    uri(id(1));
  });
});

describe('RC-Collection public mint', () => {
  test('pays the owner, refunds the excess and counts the mints', () => {
    deployDefault();
    const ownerBefore = masBalanceOf(OWNER);
    alicePublicMint(2, 5 * MAS); // price 2 × 2 MAS, 1 MAS too much
    expect(nftBalance(ALICE)).toBe(u256.fromU64(2));
    expect(masBalanceOf(OWNER) - ownerBefore).toBe(4 * MAS);
    expect(masBalanceOf(ALICE)).toBe(6 * MAS); // 10 − 5 sent + 1 refunded
    expect(mintedBy(new Args().add(ALICE).serialize())).toStrictEqual([2, 0, 0, 0]);
  });

  throws('when the coins sent do not cover the price', () => {
    deployDefault();
    alicePublicMint(2, 3 * MAS);
  });

  throws('above the per-wallet limit', () => {
    deployDefault();
    alicePublicMint(2, 4 * MAS);
    alicePublicMint(1, 2 * MAS);
  });

  throws('while public mint is closed', () => {
    deploy(collectionArgs(OWNER, 10, BASE, PRICE, 0, false, false));
    alicePublicMint(1, 2 * MAS);
  });

  test('a free mint needs no coins and has no limit when maxPerWallet is 0', () => {
    deploy(collectionArgs(OWNER, 10, BASE, 0, 0, true, false));
    alicePublicMint(5, 0);
    alicePublicMint(5, 0);
    expect(nftBalance(ALICE)).toBe(u256.fromU64(10));
  });

  throws('after ownership was renounced (public mint closes)', () => {
    deployDefault();
    callAs(OWNER);
    renounceOwnership([]);
    alicePublicMint(1, 2 * MAS);
  });
});

describe('RC-Collection metadata and settings', () => {
  test('the owner changes the base URI until it is frozen', () => {
    deployDefault();
    callAs(OWNER);
    ownerMint(mintTo(ALICE, 1));
    setBaseURI(new Args().add('ipfs://bafyNew/').serialize());
    expect(uriOf(1)).toBe('ipfs://bafyNew/1.json');
    freezeMetadata([]);
    const info = new Args(mintInfo([]));
    info.nextU256();
    info.nextU256();
    info.nextU256();
    info.nextU64();
    info.nextU32();
    info.nextBool();
    info.nextString();
    expect(info.nextBool().unwrap()).toBe(true); // frozen
  });

  throws('a base URI change after freezing', () => {
    deployDefault();
    callAs(OWNER);
    freezeMetadata([]);
    setBaseURI(new Args().add('ipfs://bafyNew/').serialize());
  });

  throws('a freeze by someone other than the owner', () => {
    deployDefault();
    callAs(ALICE);
    freezeMetadata([]);
  });

  throws('opening public mint without a base URI', () => {
    deploy(collectionArgs(OWNER, 10, '', 0, 0, false, false));
    callAs(OWNER);
    setMintConfig(new Args().add(PRICE).add(u32(0)).add(true).serialize());
  });

  test('the max supply can go down to the minted count', () => {
    deployDefault();
    callAs(OWNER);
    ownerMint(mintTo(ALICE, 4));
    reduceMaxSupply(new Args().add(u256.fromU64(4)).serialize());
    const info = new Args(mintInfo([]));
    expect(info.nextU256().unwrap()).toBe(u256.fromU64(4));
  });

  throws('raising the max supply', () => {
    deployDefault();
    callAs(OWNER);
    reduceMaxSupply(new Args().add(u256.fromU64(11)).serialize());
  });

  throws('a max supply below the minted count', () => {
    deployDefault();
    callAs(OWNER);
    ownerMint(mintTo(ALICE, 4));
    reduceMaxSupply(new Args().add(u256.fromU64(3)).serialize());
  });
});

describe('RC-Collection transfers', () => {
  test('a holder transfers, and an approved operator (the marketplace) can too', () => {
    deployDefault();
    callAs(OWNER);
    ownerMint(mintTo(ALICE, 2));
    callAs(ALICE);
    transferFrom(transferArgs(ALICE, BOB, 1));
    expect(ownerOfToken(1)).toBe(BOB);
    approve(new Args().add(LAUNCHPAD).add(u256.fromU64(2)).serialize());
    callAs(LAUNCHPAD);
    transferFrom(transferArgs(ALICE, BOB, 2));
    expect(ownerOfToken(2)).toBe(BOB);
    expect(nftBalance(ALICE)).toBe(u256.Zero);
  });

  throws('a transfer of someone else’s token', () => {
    deployDefault();
    callAs(OWNER);
    ownerMint(mintTo(ALICE, 1));
    callAs(BOB);
    transferFrom(transferArgs(ALICE, BOB, 1));
  });
});

describe('RC-Collection code upgrade', () => {
  test('the owner upgrades a mutable collection', () => {
    deploy(collectionArgs(OWNER, 10, BASE, 0, 0, false, true));
    callAs(OWNER);
    upgrade(new Args().add<StaticArray<u8>>([0, 97, 115, 109]).serialize());
  });

  throws('an upgrade of an immutable collection', () => {
    deployDefault();
    callAs(OWNER);
    upgrade(new Args().add<StaticArray<u8>>([0, 97, 115, 109]).serialize());
  });
});
