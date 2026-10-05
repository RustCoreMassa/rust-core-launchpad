import { Args, bytesToU64, stringToBytes, u256ToBytes } from '@massalabs/as-types';
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
  cancelPresale,
  claim,
  constructor,
  contribute,
  fees,
  finalize,
  getContribution,
  getContributionsOf,
  getPresale,
  getPresales,
  importToken,
  setHidden,
  presaleOf,
  refund,
  withdrawRaised,
  createPresale,
} from '../contracts/launchpad';
import { KIND_TOKEN, LOCK_KEY, STD_OWNER_KEY } from '../lib/launchpad/keys';
import {
  Config,
  PRESALE_CANCELLED,
  PRESALE_FAILED,
  PRESALE_SUCCESS,
  Presale,
  ProjectInfo,
} from '../lib/launchpad/records';

const LAUNCHPAD = 'AS12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1eT';
const ADMIN = 'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq';
const ALICE = 'AU12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1e8';
const BOB = 'AUDeadBeefDeadBeefDeadBeefDeadBeefDeadBeefDeadBOObs';
const CAROL = 'AU1CarolCarolCarolCarolCarolCarolCarolCarolCarol12';
const TOKEN = 'AS1ExternalExternalExternalExternalExternalExtern1';

const MAS: u64 = 1_000_000_000;
const HOUR: u64 = 60 * 60 * 1000;
const NOW: u64 = 10_000_000;
const START: u64 = NOW + HOUR;
const END: u64 = START + 24 * HOUR;
const FEE_BPS: u16 = 200; // 2 %
/** 1 000 tokens (18 decimals) per MAS. */
const RATE: u256 = u256.fromU64(1_000) * u256.fromU64(1_000_000_000_000_000_000);
/** Enough for the 100 MAS hard cap: 100 000 tokens. */
const FOR_SALE: u256 = u256.fromU64(100_000) * u256.fromU64(1_000_000_000_000_000_000);

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

/** The Launchpad's balance in the fake token, as if the tokens had arrived. */
function escrowArrived(amount: u256): void {
  Storage.setOf(new Address(TOKEN), stringToBytes('BALANCE' + LAUNCHPAD), u256ToBytes(amount));
}

/** Launchpad (2 % presale fee) + a standard MRC20 owned by ALICE, imported (token id 1). */
function setup(): void {
  resetStorage();
  setDeployContext(ADMIN);
  constructor(new Args().add(new Config(MAS, MAS, MAS, FEE_BPS, MAS / 10, false)).serialize());
  mockAdminContext(false);
  const token = new Address(TOKEN);
  Storage.setOf(token, STD_OWNER_KEY, stringToBytes(ALICE));
  Storage.setOf(token, stringToBytes('NAME'), stringToBytes('Old Token'));
  Storage.setOf(token, stringToBytes('SYMBOL'), stringToBytes('OLD'));
  Storage.setOf<StaticArray<u8>>(token, stringToBytes('DECIMALS'), [18]);
  Storage.setOf(token, stringToBytes('TOTAL_SUPPLY'), new StaticArray<u8>(32));
  setBytecodeOf(token, [1, 2, 3]);
  pay(ALICE, 10 * MAS);
  importToken(new Args().add(TOKEN).add(u8(0)).add(new ProjectInfo()).serialize());
  done();
  mockTimestamp(NOW);
}

function presaleArgs(
  softCap: u64 = 50 * MAS,
  hardCap: u64 = 100 * MAS,
  minBuy: u64 = MAS,
  maxBuy: u64 = 40 * MAS,
  start: u64 = START,
  end: u64 = END,
  rate: u256 = RATE,
  forSale: u256 = FOR_SALE,
): StaticArray<u8> {
  return new Args()
    .add(TOKEN)
    .add(forSale)
    .add(rate)
    .add(softCap)
    .add(hardCap)
    .add(minBuy)
    .add(maxBuy)
    .add(start)
    .add(end)
    .serialize();
}

/** ALICE starts a presale (default terms); the tokens arrive in escrow. Returns its id. */
function create(args: StaticArray<u8> = presaleArgs()): u64 {
  escrowArrived(FOR_SALE);
  pay(ALICE, MAS);
  mockScCall([]); // transferFrom
  createPresale(args);
  done();
  return 1;
}

function contributeAs(user: string, amount: u64): void {
  pay(user, amount + MAS);
  contribute(new Args().add(u64(1)).add(amount).serialize());
  done();
}

function presale(): Presale {
  return new Args(getPresale(new Args().add(u64(1)).serialize()))
    .nextSerializable<Presale>()
    .unwrap();
}

function contribution(user: string): u64 {
  return bytesToU64(getContribution(new Args().add(u64(1)).add(user).serialize()));
}

function idArgs(): StaticArray<u8> {
  return new Args().add(u64(1)).serialize();
}

/** Starts, takes `bob` + `carol` contributions, ends. */
function runPresale(bob: u64, carol: u64): void {
  create();
  mockTimestamp(START);
  if (bob) contributeAs(BOB, bob);
  if (carol) contributeAs(CAROL, carol);
  mockTimestamp(END);
}

function finalizeNow(): void {
  pay(CAROL, MAS);
  mockScCall([]); // tokens back to the owner
  finalize(idArgs());
  done();
}

describe('Presale creation', () => {
  test('the token owner starts a presale with the tokens in escrow', () => {
    setup();
    create();
    const p = presale();
    expect(p.creator).toBe(ALICE);
    expect(p.token).toBe(TOKEN);
    expect(p.tokensForSale).toBe(FOR_SALE);
    expect(p.hardCap).toBe(100 * MAS);
    expect(bytesToU64(presaleOf(new Args().add(TOKEN).serialize()))).toBe(1);
    const page = new Args(getPresales(new Args().add(u64(0)).add(u32(10)).serialize()));
    expect(page.nextU64().unwrap()).toBe(1);
  });

  throws('by someone who does not own the token', () => {
    setup();
    escrowArrived(FOR_SALE);
    pay(BOB, MAS);
    mockScCall([]);
    createPresale(presaleArgs());
  });

  throws('when the tokens did not reach the escrow', () => {
    setup();
    pay(ALICE, MAS);
    mockScCall([]);
    createPresale(presaleArgs());
  });

  throws('a second open presale for the same token', () => {
    setup();
    create();
    escrowArrived(FOR_SALE + FOR_SALE); // the escrow check alone would pass
    pay(ALICE, MAS);
    mockScCall([]);
    createPresale(presaleArgs());
  });

  throws('a token outside the Launchpad', () => {
    setup();
    const other = 'AS1OtherOtherOtherOtherOtherOtherOtherOtherOther12';
    Storage.setOf(new Address(other), STD_OWNER_KEY, stringToBytes(ALICE));
    pay(ALICE, MAS);
    mockScCall([]);
    createPresale(
      new Args()
        .add(other)
        .add(FOR_SALE)
        .add(RATE)
        .add(50 * MAS)
        .add(100 * MAS)
        .add(MAS)
        .add(u64(0))
        .add(START)
        .add(END)
        .serialize(),
    );
  });

  throws('a hidden token', () => {
    setup();
    callAs(ADMIN);
    setHidden(new Args().add(KIND_TOKEN).add(u64(1)).add(true).serialize());
    create();
  });

  throws('a hard cap of zero', () => {
    setup();
    create(presaleArgs(0, 0, 0, 0));
  });

  throws('a minimum above the hard cap', () => {
    setup();
    create(presaleArgs(50 * MAS, 100 * MAS, 101 * MAS, 0));
  });

  throws('zero tokens for sale', () => {
    setup();
    create(presaleArgs(0, MAS / 2, 0, 0, START, END, u256.One, u256.Zero));
  });

  throws('any write while a token transfer runs (reentrancy lock)', () => {
    setup();
    Storage.set(LOCK_KEY, [1]);
    create();
  });

  throws('a presales page larger than 50', () => {
    setup();
    getPresales(new Args().add(u64(0)).add(u32(51)).serialize());
  });

  test('a start already past means now', () => {
    setup();
    create(presaleArgs(50 * MAS, 100 * MAS, MAS, 0, 0, END));
    expect(presale().start).toBe(NOW);
  });

  throws('a start more than 90 days ahead', () => {
    setup();
    const far = NOW + 91 * 24 * HOUR;
    create(presaleArgs(50 * MAS, 100 * MAS, MAS, 0, far, far + 24 * HOUR));
  });

  throws('a presale shorter than an hour', () => {
    setup();
    create(presaleArgs(50 * MAS, 100 * MAS, MAS, 0, START, START + HOUR - 1));
  });

  throws('a presale longer than 30 days', () => {
    setup();
    create(presaleArgs(50 * MAS, 100 * MAS, MAS, 0, START, START + 30 * 24 * HOUR + 1));
  });

  throws('a soft cap above the hard cap', () => {
    setup();
    create(presaleArgs(101 * MAS, 100 * MAS));
  });

  throws('a minimum above the maximum', () => {
    setup();
    create(presaleArgs(50 * MAS, 100 * MAS, 41 * MAS, 40 * MAS));
  });

  throws('not enough tokens for the hard cap', () => {
    setup();
    create(presaleArgs(50 * MAS, 101 * MAS));
  });

  throws('a rate of zero', () => {
    setup();
    create(presaleArgs(50 * MAS, 100 * MAS, MAS, 0, START, END, u256.Zero));
  });
});

describe('Presale contributions', () => {
  test('contributions add up per wallet; the excess sent comes back', () => {
    setup();
    create();
    mockTimestamp(START);
    contributeAs(BOB, 10 * MAS);
    expect(masBalanceOf(BOB)).toBe(990 * MAS); // 1 000 − 10 (1 MAS margin refunded)
    contributeAs(BOB, 5 * MAS);
    contributeAs(CAROL, 2 * MAS);
    expect(contribution(BOB)).toBe(15 * MAS);
    expect(presale().raised).toBe(17 * MAS);
    expect(presale().contributors).toBe(2);
    const mine = new Args(getContributionsOf(new Args().add(BOB).serialize()));
    expect(mine.nextFixedSizeArray<u64>().unwrap()).toStrictEqual([1]);
  });

  throws('before the start', () => {
    setup();
    create();
    contributeAs(BOB, 10 * MAS);
  });

  throws('after the end', () => {
    setup();
    create();
    mockTimestamp(END);
    contributeAs(BOB, 10 * MAS);
  });

  throws('below the minimum', () => {
    setup();
    create();
    mockTimestamp(START);
    contributeAs(BOB, MAS - 1);
  });

  throws('above the maximum per wallet', () => {
    setup();
    create();
    mockTimestamp(START);
    contributeAs(BOB, 30 * MAS);
    contributeAs(BOB, 11 * MAS);
  });

  throws('above what is left before the hard cap', () => {
    setup();
    create();
    mockTimestamp(START);
    contributeAs(BOB, 40 * MAS);
    contributeAs(CAROL, 40 * MAS);
    contributeAs(ALICE, 21 * MAS);
  });

  test('the last buyer may take what is left even below the minimum', () => {
    setup();
    create(presaleArgs(50 * MAS, 100 * MAS, 5 * MAS, 0));
    mockTimestamp(START);
    contributeAs(BOB, 98 * MAS);
    contributeAs(CAROL, 2 * MAS);
    expect(presale().raised).toBe(100 * MAS);
  });

  throws('an amount of zero', () => {
    setup();
    create();
    mockTimestamp(START);
    contributeAs(BOB, 10 * MAS);
    contributeAs(BOB, 0);
  });

  throws('contributing after the admin cancelled it', () => {
    setup();
    create();
    mockTimestamp(START);
    pay(ADMIN, MAS);
    mockScCall([]);
    cancelPresale(idArgs());
    contributeAs(BOB, 10 * MAS);
  });

  throws('without sending the amount', () => {
    setup();
    create();
    mockTimestamp(START);
    pay(BOB, 5 * MAS);
    contribute(
      new Args()
        .add(u64(1))
        .add(10 * MAS)
        .serialize(),
    );
  });
});

describe('Presale end', () => {
  test('reaching the soft cap is a success', () => {
    setup();
    runPresale(40 * MAS, 20 * MAS);
    finalizeNow();
    expect(presale().status).toBe(PRESALE_SUCCESS);
    expect(bytesToU64(presaleOf(new Args().add(TOKEN).serialize()))).toBe(0);
  });

  test('missing the soft cap is a failure', () => {
    setup();
    runPresale(10 * MAS, 0);
    finalizeNow();
    expect(presale().status).toBe(PRESALE_FAILED);
  });

  test('the hard cap closes it early', () => {
    setup();
    create(presaleArgs(50 * MAS, 100 * MAS, MAS, 0));
    mockTimestamp(START);
    contributeAs(BOB, 100 * MAS);
    finalizeNow();
    expect(presale().status).toBe(PRESALE_SUCCESS);
  });

  throws('finalizing while it runs', () => {
    setup();
    create();
    mockTimestamp(START);
    contributeAs(BOB, 10 * MAS);
    finalizeNow();
  });

  throws('finalizing twice', () => {
    setup();
    runPresale(40 * MAS, 20 * MAS);
    finalizeNow();
    finalizeNow();
  });
});

describe('Presale claim, refund and withdraw', () => {
  test('after a success, contributors claim once', () => {
    setup();
    runPresale(40 * MAS, 20 * MAS);
    finalizeNow();
    pay(BOB, MAS);
    mockScCall([]); // token transfer
    claim(idArgs());
    done();
    expect(contribution(BOB)).toBe(0);
  });

  throws('claiming twice', () => {
    setup();
    runPresale(40 * MAS, 20 * MAS);
    finalizeNow();
    pay(BOB, MAS);
    mockScCall([]);
    claim(idArgs());
    pay(BOB, MAS);
    mockScCall([]);
    claim(idArgs());
  });

  throws('claiming after a failure', () => {
    setup();
    runPresale(10 * MAS, 0);
    finalizeNow();
    pay(BOB, MAS);
    mockScCall([]);
    claim(idArgs());
  });

  test('after a failure, contributors get their MAS back', () => {
    setup();
    runPresale(10 * MAS, 0);
    finalizeNow();
    pay(BOB, 0);
    refund(idArgs());
    done();
    expect(masBalanceOf(BOB)).toBe(1_010 * MAS);
    expect(contribution(BOB)).toBe(0);
  });

  throws('a refund after a success', () => {
    setup();
    runPresale(40 * MAS, 20 * MAS);
    finalizeNow();
    pay(BOB, 0);
    refund(idArgs());
  });

  test('the owner withdraws the raised MAS minus the 2 % fee, once', () => {
    setup();
    runPresale(40 * MAS, 20 * MAS);
    finalizeNow();
    pay(ALICE, 0);
    withdrawRaised(idArgs());
    done();
    expect(bytesToU64(fees([]))).toBe(MAS + (60 * MAS * 2) / 100); // import fee + presale fee
    expect(masBalanceOf(ALICE)).toBe(1_000 * MAS + 60 * MAS - (60 * MAS * 2) / 100);
    expect(presale().withdrawn).toBe(true);
  });

  throws('a second withdrawal', () => {
    setup();
    runPresale(40 * MAS, 20 * MAS);
    finalizeNow();
    pay(ALICE, 0);
    withdrawRaised(idArgs());
    pay(ALICE, 0);
    withdrawRaised(idArgs());
  });

  throws('a withdrawal by someone else', () => {
    setup();
    runPresale(40 * MAS, 20 * MAS);
    finalizeNow();
    pay(BOB, 0);
    withdrawRaised(idArgs());
  });

  throws('a withdrawal after a failure', () => {
    setup();
    runPresale(10 * MAS, 0);
    finalizeNow();
    pay(ALICE, 0);
    withdrawRaised(idArgs());
  });
});

describe('Presale cancel', () => {
  test('the owner cancels before the start; tokens go back', () => {
    setup();
    create();
    pay(ALICE, MAS);
    mockScCall([]);
    cancelPresale(idArgs());
    done();
    expect(presale().status).toBe(PRESALE_CANCELLED);
    expect(bytesToU64(presaleOf(new Args().add(TOKEN).serialize()))).toBe(0);
  });

  throws('the owner cancelling once it started', () => {
    setup();
    create();
    mockTimestamp(START);
    pay(ALICE, MAS);
    mockScCall([]);
    cancelPresale(idArgs());
  });

  test('the admin cancels a running presale; contributors get refunds', () => {
    setup();
    create();
    mockTimestamp(START);
    contributeAs(BOB, 10 * MAS);
    pay(ADMIN, MAS);
    mockScCall([]);
    cancelPresale(idArgs());
    done();
    pay(BOB, 0);
    refund(idArgs());
    expect(masBalanceOf(BOB)).toBe(1_010 * MAS);
  });

  throws('someone else cancelling', () => {
    setup();
    create();
    pay(BOB, MAS);
    mockScCall([]);
    cancelPresale(idArgs());
  });
});
