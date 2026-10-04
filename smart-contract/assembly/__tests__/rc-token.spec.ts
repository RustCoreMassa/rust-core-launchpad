import { Args, bytesToString, bytesToU256, u256ToBytes } from '@massalabs/as-types';
import {
  changeCallStack,
  mockAdminContext,
  resetStorage,
  setDeployContext,
} from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import {
  balanceOf,
  burn,
  constructor,
  decimals,
  isOwner,
  mint,
  name,
  ownerAddress,
  renounceOwnership,
  setOwner,
  symbol,
  templateInfo,
  totalSupply,
  transfer,
  upgrade,
} from '../contracts/rc-token';

// The contract address the vm-mock runs as.
const CONTRACT = 'AS12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1eT';
const LAUNCHPAD = 'AS1LaunchpadLaunchpadLaunchpadLaunchpadLaunchpad12';
const OWNER = 'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq';
const ALICE = 'AU12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1e8';
const BOB = 'AUDeadBeefDeadBeefDeadBeefDeadBeefDeadBeefDeadBOObs';

const SUPPLY = u256.fromU64(1_000_000);
const MAX = u256.fromU64(1_500_000);

function tokenArgs(
  owner: string,
  supply: u256,
  mintable: bool,
  max: u256,
  burnable: bool,
  mutable: bool,
  decimalsValue: u8 = 18,
  symbolValue: string = 'RCT',
): StaticArray<u8> {
  return new Args()
    .add('RustCore Token')
    .add(symbolValue)
    .add(decimalsValue)
    .add(supply)
    .add(owner)
    .add(mintable)
    .add(max)
    .add(burnable)
    .add(mutable)
    .serialize();
}

/** Deploys the token the way the Launchpad does: the Launchpad is the caller. */
function deploy(args: StaticArray<u8>): void {
  resetStorage();
  setDeployContext(LAUNCHPAD);
  constructor(args);
  mockAdminContext(false);
}

function deployDefault(mintable: bool, burnable: bool, mutable: bool): void {
  deploy(tokenArgs(OWNER, SUPPLY, mintable, MAX, burnable, mutable));
}

function callAs(user: string): void {
  changeCallStack(user + ' , ' + CONTRACT);
}

function balance(address: string): u256 {
  return bytesToU256(balanceOf(new Args().add(address).serialize()));
}

function supply(): u256 {
  return bytesToU256(totalSupply([]));
}

function mintArgs(to: string, amount: u64): StaticArray<u8> {
  return new Args().add(to).add(u256.fromU64(amount)).serialize();
}

describe('RC-Token constructor', () => {
  test('stores the token and gives owner and supply to the user, not the Launchpad', () => {
    deployDefault(false, false, false);
    expect(bytesToString(name([]))).toBe('RustCore Token');
    expect(bytesToString(symbol([]))).toBe('RCT');
    expect(decimals([])).toStrictEqual([18]);
    expect(totalSupply([])).toStrictEqual(u256ToBytes(SUPPLY));
    expect(balance(OWNER)).toBe(SUPPLY);
    expect(balance(LAUNCHPAD)).toBe(u256.Zero);
    expect(bytesToString(ownerAddress([]))).toBe(OWNER);
  });

  test('a fixed supply records max = initial supply', () => {
    deployDefault(false, true, true);
    const info = new Args(templateInfo([]));
    expect(info.nextString().unwrap()).toBe('RC-Token');
    expect(info.nextString().unwrap()).toBe('1.0.0');
    expect(info.nextBool().unwrap()).toBe(false); // mintable
    expect(info.nextU256().unwrap()).toBe(SUPPLY); // max supply
    expect(info.nextBool().unwrap()).toBe(true); // burnable
    expect(info.nextBool().unwrap()).toBe(true); // mutable
  });

  test('runs only at deploy time', () => {
    deployDefault(false, false, false);
    expect(() => {
      constructor(tokenArgs(BOB, u256.fromU64(1), false, u256.Zero, false, false));
    }).toThrow();
  });

  throws('an invalid owner address', () => {
    deploy(tokenArgs('not-an-address', SUPPLY, false, MAX, false, false));
  });

  throws('more than 18 decimals', () => {
    deploy(tokenArgs(OWNER, SUPPLY, false, MAX, false, false, 19));
  });

  throws('a fixed supply of zero', () => {
    deploy(tokenArgs(OWNER, u256.Zero, false, MAX, false, false));
  });

  throws('a max supply below the initial supply', () => {
    deploy(tokenArgs(OWNER, MAX, true, SUPPLY, false, false));
  });

  throws('an empty symbol', () => {
    deploy(tokenArgs(OWNER, SUPPLY, false, MAX, false, false, 18, ''));
  });

  test('a mintable token may start with no supply', () => {
    deploy(tokenArgs(OWNER, u256.Zero, true, MAX, false, false));
    expect(supply()).toBe(u256.Zero);
  });
});

describe('RC-Token transfers (standard MRC20)', () => {
  test('the owner can transfer', () => {
    deployDefault(false, false, false);
    callAs(OWNER);
    transfer(mintArgs(ALICE, 250));
    expect(balance(ALICE)).toBe(u256.fromU64(250));
    expect(balance(OWNER)).toBe(u256.fromU64(999_750));
  });
});

describe('RC-Token mint', () => {
  test('the owner mints up to the max supply', () => {
    deployDefault(true, false, false);
    callAs(OWNER);
    mint(mintArgs(ALICE, 500_000));
    expect(balance(ALICE)).toBe(u256.fromU64(500_000));
    expect(supply()).toBe(MAX);
  });

  throws('above the max supply', () => {
    deployDefault(true, false, false);
    callAs(OWNER);
    mint(mintArgs(ALICE, 500_001));
  });

  throws('by someone other than the owner', () => {
    deployDefault(true, false, false);
    callAs(ALICE);
    mint(mintArgs(ALICE, 1));
  });

  throws('on a fixed-supply token', () => {
    deployDefault(false, false, false);
    callAs(OWNER);
    mint(mintArgs(ALICE, 1));
  });

  throws('on a fixed-supply token even after a burn left room under the cap', () => {
    deployDefault(false, true, false);
    callAs(OWNER);
    burn(new Args().add(u256.fromU64(1_000)).serialize());
    mint(mintArgs(OWNER, 1));
  });

  throws('zero tokens', () => {
    deployDefault(true, false, false);
    callAs(OWNER);
    mint(mintArgs(ALICE, 0));
  });
});

describe('RC-Token burn', () => {
  test('a holder burns their tokens on a burnable token', () => {
    deployDefault(false, true, false);
    callAs(OWNER);
    burn(new Args().add(u256.fromU64(1_000)).serialize());
    expect(balance(OWNER)).toBe(u256.fromU64(999_000));
    expect(supply()).toBe(u256.fromU64(999_000));
  });

  throws('on a token that is not burnable', () => {
    deployDefault(false, false, false);
    callAs(OWNER);
    burn(new Args().add(u256.fromU64(1)).serialize());
  });
});

describe('RC-Token ownership', () => {
  test('the owner hands ownership over', () => {
    deployDefault(true, false, false);
    callAs(OWNER);
    setOwner(new Args().add(ALICE).serialize());
    expect(bytesToString(ownerAddress([]))).toBe(ALICE);
    callAs(ALICE);
    mint(mintArgs(BOB, 1)); // the new owner can mint
    expect(balance(BOB)).toBe(u256.One);
  });

  throws('the old owner after a handover', () => {
    deployDefault(true, false, false);
    callAs(OWNER);
    setOwner(new Args().add(ALICE).serialize());
    mint(mintArgs(BOB, 1));
  });

  throws('a handover to an invalid address', () => {
    deployDefault(false, false, false);
    callAs(OWNER);
    setOwner(new Args().add('oops').serialize());
  });

  throws('a handover by someone else', () => {
    deployDefault(false, false, false);
    callAs(ALICE);
    setOwner(new Args().add(ALICE).serialize());
  });

  test('renouncing leaves no owner', () => {
    deployDefault(true, false, false);
    callAs(OWNER);
    renounceOwnership([]);
    expect(ownerAddress([]).length).toBe(0);
    expect(isOwner(new Args().add(OWNER).serialize())).toStrictEqual([0]);
  });

  throws('claiming ownership after it was renounced', () => {
    deployDefault(true, false, false);
    callAs(OWNER);
    renounceOwnership([]);
    callAs(ALICE);
    setOwner(new Args().add(ALICE).serialize());
  });

  throws('minting after ownership was renounced', () => {
    deployDefault(true, false, false);
    callAs(OWNER);
    renounceOwnership([]);
    mint(mintArgs(OWNER, 1));
  });
});

describe('RC-Token code upgrade', () => {
  test('the owner upgrades a mutable token', () => {
    deployDefault(false, false, true);
    callAs(OWNER);
    upgrade(new Args().add<StaticArray<u8>>([0, 97, 115, 109]).serialize());
  });

  throws('an upgrade of an immutable token', () => {
    deployDefault(false, false, false);
    callAs(OWNER);
    upgrade(new Args().add<StaticArray<u8>>([0, 97, 115, 109]).serialize());
  });

  throws('an upgrade by someone other than the owner', () => {
    deployDefault(false, false, true);
    callAs(ALICE);
    upgrade(new Args().add<StaticArray<u8>>([0, 97, 115, 109]).serialize());
  });
});
