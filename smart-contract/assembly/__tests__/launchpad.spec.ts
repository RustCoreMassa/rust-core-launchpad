import { Args, bytesToString, bytesToU64, stringToBytes, u8toByte } from '@massalabs/as-types';
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
  sha256,
} from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import {
  UPGRADE_DELAY_MS,
  acceptAdmin,
  admin,
  cancelUpgrade,
  config,
  constructor,
  count,
  createCollection,
  createToken,
  executeUpgrade,
  fees,
  getCreatedBy,
  getProject,
  getProjectByAddress,
  getProjects,
  importCollection,
  importToken,
  isSymbolAvailable,
  pendingAdmin,
  pendingUpgrade,
  proposeUpgrade,
  reserveSymbol,
  setConfig,
  setHidden,
  setPaused,
  setRoyalty,
  setTemplate,
  setVerified,
  template,
  transferAdmin,
  updateInfo,
  withdrawFees,
} from '../contracts/launchpad';
import { KIND_COLLECTION, KIND_TOKEN, LOCK_KEY, STD_OWNER_KEY } from '../lib/launchpad/keys';
import { isLocalHttp } from '../lib/launchpad/rules';
import {
  Config,
  Project,
  ProjectInfo,
  SOURCE_IMPORTED,
  SOURCE_LAUNCHED,
} from '../lib/launchpad/records';

// The contract address the vm-mock runs as: here, the Launchpad.
const LAUNCHPAD = 'AS12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1eT';
const ADMIN = 'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq';
const ALICE = 'AU12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1e8';
const BOB = 'AUDeadBeefDeadBeefDeadBeefDeadBeefDeadBeefDeadBOObs';
const EXTERNAL = 'AS1ExternalExternalExternalExternalExternalExtern1';

const MAS: u64 = 1_000_000_000;
const TOKEN_FEE: u64 = 5 * MAS;
const COLLECTION_FEE: u64 = 7 * MAS;
const IMPORT_FEE: u64 = 3 * MAS;
const DEPOSIT: u64 = MAS / 2;
const TOKEN_CODE: StaticArray<u8> = [0, 97, 115, 109, 1];
const COLLECTION_CODE: StaticArray<u8> = [0, 97, 115, 109, 2];

function testConfig(paused: bool = false): Config {
  return new Config(TOKEN_FEE, COLLECTION_FEE, IMPORT_FEE, 200, DEPOSIT, paused);
}

function callAs(user: string): void {
  changeCallStack(user + ' , ' + LAUNCHPAD);
}

/** Admin deploys the Launchpad and uploads both templates. */
function deploy(withTemplates: bool = true): void {
  resetStorage();
  setDeployContext(ADMIN);
  constructor(new Args().add(testConfig()).serialize());
  mockAdminContext(false);
  if (withTemplates) {
    callAs(ADMIN);
    setTemplate(new Args().add(KIND_TOKEN).add(TOKEN_CODE).serialize());
    setTemplate(new Args().add(KIND_COLLECTION).add(COLLECTION_CODE).serialize());
  }
}

/**
 * `user` calls `fn` with 100 MAS in their wallet, sending `sent`. The Launchpad holds funds of
 * its own, so only the payment rules can stop an underpaid call (the vm-mock doesn't credit
 * the contract with the coins sent).
 */
function pay(user: string, sent: u64): void {
  mockBalance(LAUNCHPAD, 1_000 * MAS);
  mockBalance(user, 100 * MAS);
  callAs(user);
  mockTransferredCoins(sent);
}

function done(): void {
  mockTransferredCoins(0);
}

function info(website: string = 'https://rustcore.example'): ProjectInfo {
  return new ProjectInfo('A test project', 'ipfs://bafyLogo', '', website, '', '', '');
}

function tokenArgs(
  symbol: string,
  name: string = 'RustCore Token',
  decimals: u8 = 18,
  supply: u64 = 1_000_000,
  mintable: bool = false,
  max: u64 = 0,
  category: u8 = 1,
  website: string = 'https://rustcore.example',
): StaticArray<u8> {
  return new Args()
    .add(name)
    .add(symbol)
    .add(decimals)
    .add(u256.fromU64(supply))
    .add(mintable)
    .add(u256.fromU64(max))
    .add(false)
    .add(true)
    .add(category)
    .add(info(website))
    .serialize();
}

function collectionArgs(maxSupply: u64, royaltyBps: u16, receiver: string): StaticArray<u8> {
  return new Args()
    .add('RustCore Cats')
    .add('RCAT')
    .add(u256.fromU64(maxSupply))
    .add('ipfs://bafyCats/')
    .add(2 * MAS)
    .add(u32(3))
    .add(true)
    .add(false)
    .add(royaltyBps)
    .add(receiver)
    .add(u8(0))
    .add(info())
    .serialize();
}

/** Alice tries to launch a token with this name, symbol and info (enough MAS sent). */
function launchWith(name: string, symbol: string, projectInfo: ProjectInfo): void {
  pay(ALICE, 10 * MAS);
  mockScCall([]);
  createToken(
    new Args()
      .add(name)
      .add(symbol)
      .add(u8(18))
      .add(u256.fromU64(1_000))
      .add(false)
      .add(u256.Zero)
      .add(false)
      .add(false)
      .add(u8(0))
      .add(projectInfo)
      .serialize(),
  );
  done();
}

function siteInfo(website: string): ProjectInfo {
  return new ProjectInfo('', '', '', website, '', '', '');
}

/** Alice launches a token, paying exactly fee + deposit + 1 MAS extra. */
function aliceLaunches(symbol: string): Project {
  pay(ALICE, TOKEN_FEE + DEPOSIT + MAS);
  mockScCall([]); // the template's constructor
  createToken(tokenArgs(symbol));
  done();
  return project(KIND_TOKEN, bytesToU64(count(new Args().add(KIND_TOKEN).serialize())));
}

function project(kind: u8, id: u64): Project {
  return new Args(getProject(new Args().add(kind).add(id).serialize()))
    .nextSerializable<Project>()
    .unwrap();
}

function available(symbol: string): bool {
  return isSymbolAvailable(new Args().add(symbol).serialize())[0] == 1;
}

function currentFees(): u64 {
  return bytesToU64(fees([]));
}

/** Makes `address` look like a deployed standard contract owned by `owner`. */
function fakeContract(address: string, owner: string, token: bool): void {
  const contract = new Address(address);
  Storage.setOf(contract, STD_OWNER_KEY, stringToBytes(owner));
  if (token) {
    Storage.setOf(contract, stringToBytes('NAME'), stringToBytes('Old Token'));
    Storage.setOf(contract, stringToBytes('SYMBOL'), stringToBytes('OLD'));
    Storage.setOf(contract, stringToBytes('DECIMALS'), u8toByte(6));
    Storage.setOf(contract, stringToBytes('TOTAL_SUPPLY'), new StaticArray<u8>(32));
  } else {
    Storage.setOf<StaticArray<u8>>(contract, [0x01], stringToBytes('Old Cats'));
    Storage.setOf<StaticArray<u8>>(contract, [0x02], stringToBytes('OCAT'));
  }
  setBytecodeOf(contract, [9, 9, 9]);
}

/** The launched contract's OWNER, as the RC template's constructor would have written it. */
function setContractOwner(address: string, owner: string): void {
  Storage.setOf(new Address(address), STD_OWNER_KEY, stringToBytes(owner));
}

function importTokenArgs(address: string): StaticArray<u8> {
  return new Args().add(address).add(u8(5)).add(info()).serialize();
}

describe('Launchpad deployment and templates', () => {
  test('the deployer is the admin and well-known symbols are reserved', () => {
    deploy(false);
    expect(bytesToString(admin([]))).toBe(ADMIN);
    const stored = new Args(config([])).nextSerializable<Config>().unwrap();
    expect(stored.tokenFee).toBe(TOKEN_FEE);
    expect(stored.deployDeposit).toBe(DEPOSIT);
    expect(available('USDC')).toBe(false);
    expect(available('MAS')).toBe(false);
    expect(available('RCT')).toBe(true);
  });

  test('each template upload adds a version with its hash', () => {
    deploy();
    callAs(ADMIN);
    setTemplate(new Args().add(KIND_TOKEN).add<StaticArray<u8>>([7, 7]).serialize());
    const info = new Args(template(new Args().add(KIND_TOKEN).serialize()));
    expect(info.nextU32().unwrap()).toBe(2);
    expect(info.nextBytes().unwrap()).toStrictEqual(sha256([7, 7]));
  });

  throws('running the constructor again', () => {
    deploy();
    constructor(new Args().add(testConfig()).serialize());
  });

  throws('a template upload by someone else', () => {
    deploy(false);
    callAs(ALICE);
    setTemplate(new Args().add(KIND_TOKEN).add(TOKEN_CODE).serialize());
  });

  throws('a launch before any template exists', () => {
    deploy(false);
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createToken(tokenArgs('RCT'));
  });
});

describe('Launchpad token launch', () => {
  test('records the token, its indexes and the fee; the creator pays fee + deposit', () => {
    deploy();
    const p = aliceLaunches('RCT');
    expect(p.kind).toBe(KIND_TOKEN);
    expect(p.id).toBe(1);
    expect(p.address.length).toBeGreaterThan(0);
    expect(p.source).toBe(SOURCE_LAUNCHED);
    expect(p.creator).toBe(ALICE);
    expect(p.templateVersion).toBe(1);
    expect(p.codeHash).toStrictEqual(sha256(TOKEN_CODE));
    expect(p.name).toBe('RustCore Token');
    expect(p.symbol).toBe('RCT');
    expect(p.decimals).toBe(18);
    expect(p.mutable).toBe(true);
    expect(p.category).toBe(1);
    expect(p.info.website).toBe('https://rustcore.example');
    const byAddress = new Args(getProjectByAddress(new Args().add(p.address).serialize()))
      .nextSerializable<Project>()
      .unwrap();
    expect(byAddress.id).toBe(1);
    const created = new Args(getCreatedBy(new Args().add(ALICE).add(KIND_TOKEN).serialize()));
    expect(created.nextFixedSizeArray<u64>().unwrap()).toStrictEqual([1]);
    expect(available('RCT')).toBe(false);
    expect(currentFees()).toBe(TOKEN_FEE);
    expect(masBalanceOf(ALICE)).toBe(100 * MAS - TOKEN_FEE - DEPOSIT);
  });

  throws('a symbol already launched', () => {
    deploy();
    aliceLaunches('RCT');
    aliceLaunches('RCT');
  });

  throws('a reserved symbol', () => {
    deploy();
    aliceLaunches('USDC');
  });

  throws('a lowercase symbol', () => {
    deploy();
    aliceLaunches('rct');
  });

  throws('too little MAS for the fee and the deposit', () => {
    deploy();
    pay(ALICE, TOKEN_FEE + DEPOSIT - 1);
    mockScCall([]);
    createToken(tokenArgs('RCT'));
  });

  throws('a name shorter than 3 characters', () => {
    deploy();
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createToken(tokenArgs('RCT', 'RC'));
  });

  throws('more than 18 decimals', () => {
    deploy();
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createToken(tokenArgs('RCT', 'RustCore Token', 19));
  });

  throws('an initial supply of zero', () => {
    deploy();
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createToken(tokenArgs('RCT', 'RustCore Token', 18, 0));
  });

  throws('a mintable max supply below the initial supply', () => {
    deploy();
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createToken(tokenArgs('RCT', 'RustCore Token', 18, 1_000, true, 999));
  });

  throws('an unknown category', () => {
    deploy();
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createToken(tokenArgs('RCT', 'RustCore Token', 18, 1_000, false, 0, 6));
  });

  test('a link to the developer machine (http://localhost…)', () => {
    deploy();
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createToken(
      tokenArgs('RCT', 'RustCore Token', 18, 1_000, false, 0, 1, 'http://localhost:8081/site'),
    );
    expect(isLocalHttp('http://localhost')).toBe(true);
    expect(isLocalHttp('http://127.0.0.1:8080/ipfs/x')).toBe(true);
    expect(isLocalHttp('http://[::1]/logo.png')).toBe(true);
    expect(isLocalHttp('http://localhost.evil.example/')).toBe(false);
    expect(isLocalHttp('http://127.0.0.1.evil.example/')).toBe(false);
    expect(isLocalHttp('http://example.com/localhost')).toBe(false);
    expect(isLocalHttp('https://localhost/')).toBe(false); // https is accepted on its own
  });

  throws('an http link to another host', () => {
    deploy();
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createToken(
      tokenArgs('RCT', 'RustCore Token', 18, 1_000, false, 0, 1, 'http://localhost.evil.example'),
    );
  });

  throws('a link that is not https or ipfs', () => {
    deploy();
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createToken(tokenArgs('RCT', 'RustCore Token', 18, 1_000, false, 0, 1, 'http://x.example'));
  });

  throws('a launch while paused', () => {
    deploy();
    callAs(ADMIN);
    setPaused(new Args().add(true).serialize());
    aliceLaunches('RCT');
  });

  test('launches work again after unpausing', () => {
    deploy();
    callAs(ADMIN);
    setPaused(new Args().add(true).serialize());
    setPaused(new Args().add(false).serialize());
    expect(aliceLaunches('RCT').id).toBe(1);
  });
});

describe('Launchpad input rules', () => {
  test('a valid launch passes the rules', () => {
    deploy();
    launchWith('Good Name', 'GOOD1', new ProjectInfo('Line one\nLine two', '', '', '', '', '', ''));
  });

  throws('a name with a leading space', () => {
    deploy();
    launchWith(' Spaced', 'RCT', new ProjectInfo());
  });

  throws('a name with a control character', () => {
    deploy();
    launchWith('Rust\tCore', 'RCT', new ProjectInfo());
  });

  throws('a symbol longer than 10 characters', () => {
    deploy();
    launchWith('RustCore', 'ABCDEFGHIJK', new ProjectInfo());
  });

  throws('a description longer than 500 characters', () => {
    deploy();
    launchWith('RustCore', 'RCT', new ProjectInfo('d'.repeat(501), '', '', '', '', '', ''));
  });

  throws('a URL longer than 256 characters', () => {
    deploy();
    launchWith('RustCore', 'RCT', siteInfo('https://' + 'a'.repeat(250)));
  });

  throws('a URL with a space', () => {
    deploy();
    launchWith('RustCore', 'RCT', siteInfo('https://rust core.example'));
  });
});

describe('Launchpad collection launch', () => {
  test('records the collection; the royalty goes to the creator by default', () => {
    deploy();
    pay(ALICE, COLLECTION_FEE + DEPOSIT);
    mockScCall([]);
    createCollection(collectionArgs(1_000, 500, ''));
    done();
    const p = project(KIND_COLLECTION, 1);
    expect(p.kind).toBe(KIND_COLLECTION);
    expect(p.symbol).toBe('RCAT');
    expect(p.royaltyBps).toBe(500);
    expect(p.royaltyReceiver).toBe(ALICE);
    expect(p.codeHash).toStrictEqual(sha256(COLLECTION_CODE));
    expect(currentFees()).toBe(COLLECTION_FEE);
  });

  throws('a royalty above 10%', () => {
    deploy();
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createCollection(collectionArgs(1_000, 1_001, ''));
  });

  throws('a max supply above 100 000', () => {
    deploy();
    pay(ALICE, 10 * MAS);
    mockScCall([]);
    createCollection(collectionArgs(100_001, 0, ''));
  });
});

describe('Launchpad import', () => {
  test('the owner of an MRC20 token imports it', () => {
    deploy();
    fakeContract(EXTERNAL, BOB, true);
    pay(BOB, IMPORT_FEE);
    importToken(importTokenArgs(EXTERNAL));
    done();
    const p = project(KIND_TOKEN, 1);
    expect(p.source).toBe(SOURCE_IMPORTED);
    expect(p.address).toBe(EXTERNAL);
    expect(p.creator).toBe(BOB);
    expect(p.name).toBe('Old Token');
    expect(p.symbol).toBe('OLD');
    expect(p.decimals).toBe(6);
    expect(p.mutable).toBe(true);
    expect(p.templateVersion).toBe(0);
    expect(p.codeHash).toStrictEqual(sha256([9, 9, 9]));
    expect(currentFees()).toBe(IMPORT_FEE);
    expect(available('OLD')).toBe(true); // imports keep their symbol and don't reserve it
  });

  test('the owner of an MRC721 collection imports it', () => {
    deploy();
    fakeContract(EXTERNAL, BOB, false);
    pay(BOB, IMPORT_FEE);
    importCollection(
      new Args().add(EXTERNAL).add(u16(250)).add('').add(u8(1)).add(info()).serialize(),
    );
    done();
    const p = project(KIND_COLLECTION, 1);
    expect(p.name).toBe('Old Cats');
    expect(p.royaltyBps).toBe(250);
    expect(p.royaltyReceiver).toBe(BOB);
  });

  throws('an import by someone who is not the owner', () => {
    deploy();
    fakeContract(EXTERNAL, BOB, true);
    pay(ALICE, IMPORT_FEE);
    importToken(importTokenArgs(EXTERNAL));
  });

  throws('importing the same contract twice', () => {
    deploy();
    fakeContract(EXTERNAL, BOB, true);
    pay(BOB, IMPORT_FEE);
    importToken(importTokenArgs(EXTERNAL));
    pay(BOB, IMPORT_FEE);
    importToken(importTokenArgs(EXTERNAL));
  });

  throws('importing a collection as a token', () => {
    deploy();
    fakeContract(EXTERNAL, BOB, false);
    pay(BOB, IMPORT_FEE);
    importToken(importTokenArgs(EXTERNAL));
  });

  throws('importing a user address', () => {
    deploy();
    pay(BOB, IMPORT_FEE);
    importToken(importTokenArgs(BOB));
  });

  throws('importing a token as a collection', () => {
    deploy();
    fakeContract(EXTERNAL, BOB, true);
    pay(BOB, IMPORT_FEE);
    importCollection(
      new Args().add(EXTERNAL).add(u16(0)).add('').add(u8(1)).add(info()).serialize(),
    );
  });

  throws('a token whose decimals are not one byte', () => {
    deploy();
    fakeContract(EXTERNAL, BOB, true);
    Storage.setOf<StaticArray<u8>>(new Address(EXTERNAL), stringToBytes('DECIMALS'), [6, 0]);
    pay(BOB, IMPORT_FEE);
    importToken(importTokenArgs(EXTERNAL));
  });

  throws('a token name longer than 64 characters', () => {
    deploy();
    fakeContract(EXTERNAL, BOB, true);
    Storage.setOf(new Address(EXTERNAL), stringToBytes('NAME'), stringToBytes('N'.repeat(65)));
    pay(BOB, IMPORT_FEE);
    importToken(importTokenArgs(EXTERNAL));
  });

  throws('an import without the fee', () => {
    deploy();
    fakeContract(EXTERNAL, BOB, true);
    pay(BOB, IMPORT_FEE - 1);
    importToken(importTokenArgs(EXTERNAL));
  });
});

describe('Launchpad owner edits', () => {
  test('the current contract owner edits the info and category', () => {
    deploy();
    const p = aliceLaunches('RCT');
    setContractOwner(p.address, ALICE);
    pay(ALICE, 0);
    updateInfo(
      new Args().add(KIND_TOKEN).add(p.id).add(u8(3)).add(info('https://new.example')).serialize(),
    );
    done();
    const edited = project(KIND_TOKEN, p.id);
    expect(edited.category).toBe(3);
    expect(edited.info.website).toBe('https://new.example');
    expect(edited.name).toBe('RustCore Token'); // identity never changes
  });

  test('after an ownership transfer, the new owner edits', () => {
    deploy();
    const p = aliceLaunches('RCT');
    setContractOwner(p.address, BOB);
    pay(BOB, 0);
    updateInfo(new Args().add(KIND_TOKEN).add(p.id).add(u8(1)).add(info()).serialize());
    done();
  });

  throws('an edit by the creator once ownership moved on', () => {
    deploy();
    const p = aliceLaunches('RCT');
    setContractOwner(p.address, BOB);
    pay(ALICE, 0);
    updateInfo(new Args().add(KIND_TOKEN).add(p.id).add(u8(1)).add(info()).serialize());
  });

  throws('an edit when ownership was renounced', () => {
    deploy();
    const p = aliceLaunches('RCT');
    setContractOwner(p.address, '');
    pay(ALICE, 0);
    updateInfo(new Args().add(KIND_TOKEN).add(p.id).add(u8(1)).add(info()).serialize());
  });

  test('the collection owner sets the royalty', () => {
    deploy();
    pay(ALICE, COLLECTION_FEE + DEPOSIT);
    mockScCall([]);
    createCollection(collectionArgs(10, 0, ''));
    setContractOwner(project(KIND_COLLECTION, 1).address, ALICE);
    pay(ALICE, 0);
    setRoyalty(new Args().add(u64(1)).add(u16(700)).add(BOB).serialize());
    done();
    expect(project(KIND_COLLECTION, 1).royaltyReceiver).toBe(BOB);
    expect(project(KIND_COLLECTION, 1).royaltyBps).toBe(700);
  });
});

describe('Launchpad royalty receiver', () => {
  throws('a royalty receiver that is not an address', () => {
    deploy();
    pay(ALICE, COLLECTION_FEE + DEPOSIT);
    mockScCall([]);
    createCollection(collectionArgs(10, 0, ''));
    setContractOwner(project(KIND_COLLECTION, 1).address, ALICE);
    pay(ALICE, 0);
    setRoyalty(new Args().add(u64(1)).add(u16(700)).add('nope').serialize());
  });
});

describe('Launchpad admin', () => {
  test('verifies and hides projects', () => {
    deploy();
    aliceLaunches('RCT');
    callAs(ADMIN);
    setVerified(new Args().add(KIND_TOKEN).add(u64(1)).add(true).serialize());
    setHidden(new Args().add(KIND_TOKEN).add(u64(1)).add(true).serialize());
    expect(project(KIND_TOKEN, 1).verified).toBe(true);
    expect(project(KIND_TOKEN, 1).hidden).toBe(true);
  });

  throws('verification by someone else', () => {
    deploy();
    aliceLaunches('RCT');
    callAs(ALICE);
    setVerified(new Args().add(KIND_TOKEN).add(u64(1)).add(true).serialize());
  });

  test('reserves and frees a symbol', () => {
    deploy();
    callAs(ADMIN);
    reserveSymbol(new Args().add('ABC').add(true).serialize());
    expect(available('ABC')).toBe(false);
    reserveSymbol(new Args().add('ABC').add(false).serialize());
    expect(available('ABC')).toBe(true);
  });

  throws('freeing the symbol of a launched token', () => {
    deploy();
    aliceLaunches('RCT');
    callAs(ADMIN);
    reserveSymbol(new Args().add('RCT').add(false).serialize());
  });

  test('withdraws collected fees, and only those', () => {
    deploy();
    aliceLaunches('RCT');
    const before = masBalanceOf(BOB);
    callAs(ADMIN);
    withdrawFees(
      new Args()
        .add(BOB)
        .add(2 * MAS)
        .serialize(),
    );
    expect(currentFees()).toBe(TOKEN_FEE - 2 * MAS);
    expect(masBalanceOf(BOB) - before).toBe(2 * MAS);
  });

  throws('withdrawing more than the collected fees', () => {
    deploy();
    aliceLaunches('RCT');
    callAs(ADMIN);
    withdrawFees(
      new Args()
        .add(BOB)
        .add(TOKEN_FEE + 1)
        .serialize(),
    );
  });

  throws('a fee withdrawal by someone else', () => {
    deploy();
    aliceLaunches('RCT');
    callAs(ALICE);
    withdrawFees(new Args().add(ALICE).add(MAS).serialize());
  });

  test('hands the admin role over in two steps', () => {
    deploy();
    callAs(ADMIN);
    transferAdmin(new Args().add(BOB).serialize());
    expect(bytesToString(pendingAdmin([]))).toBe(BOB);
    expect(bytesToString(admin([]))).toBe(ADMIN); // nothing changes until BOB accepts
    callAs(BOB);
    acceptAdmin([]);
    expect(bytesToString(admin([]))).toBe(BOB);
    expect(pendingAdmin([]).length).toBe(0);
    setConfig(new Args().add(testConfig(true)).serialize());
    expect(new Args(config([])).nextSerializable<Config>().unwrap().paused).toBe(true);
  });

  throws('the old admin after a handover', () => {
    deploy();
    callAs(ADMIN);
    transferAdmin(new Args().add(BOB).serialize());
    callAs(BOB);
    acceptAdmin([]);
    callAs(ADMIN);
    setConfig(new Args().add(testConfig()).serialize());
  });

  throws('accepting the admin role without being named', () => {
    deploy();
    callAs(ADMIN);
    transferAdmin(new Args().add(BOB).serialize());
    callAs(ALICE);
    acceptAdmin([]);
  });

  test('withdraws an admin offer', () => {
    deploy();
    callAs(ADMIN);
    transferAdmin(new Args().add(BOB).serialize());
    transferAdmin(new Args().add('').serialize());
    expect(pendingAdmin([]).length).toBe(0);
  });

  throws('accepting a withdrawn admin offer', () => {
    deploy();
    callAs(ADMIN);
    transferAdmin(new Args().add(BOB).serialize());
    transferAdmin(new Args().add('').serialize());
    callAs(BOB);
    acceptAdmin([]);
  });

  throws('an admin offer by someone else', () => {
    deploy();
    callAs(ALICE);
    transferAdmin(new Args().add(ALICE).serialize());
  });

  test('accepts a presale fee up to 10%', () => {
    deploy();
    callAs(ADMIN);
    setConfig(
      new Args().add(new Config(TOKEN_FEE, COLLECTION_FEE, IMPORT_FEE, 1_000, DEPOSIT)).serialize(),
    );
    expect(new Args(config([])).nextSerializable<Config>().unwrap().presaleFeeBps).toBe(1_000);
  });

  throws('a presale fee above 10%', () => {
    deploy();
    callAs(ADMIN);
    setConfig(
      new Args().add(new Config(TOKEN_FEE, COLLECTION_FEE, IMPORT_FEE, 1_001, DEPOSIT)).serialize(),
    );
  });

  throws('a deploy with a presale fee above 10%', () => {
    resetStorage();
    setDeployContext(ADMIN);
    constructor(
      new Args().add(new Config(TOKEN_FEE, COLLECTION_FEE, IMPORT_FEE, 1_001, DEPOSIT)).serialize(),
    );
  });

  throws('a Launchpad write while an outer call holds the lock (reentrancy)', () => {
    deploy();
    Storage.set(LOCK_KEY, [1]);
    aliceLaunches('RCT');
  });
});

describe('Launchpad upgrade timelock', () => {
  test('runs the proposed code once 72 hours have passed', () => {
    deploy();
    const code: StaticArray<u8> = [0, 97, 115, 109, 42];
    callAs(ADMIN);
    mockTimestamp(1_000);
    proposeUpgrade(new Args().add(sha256(code)).serialize());
    mockTimestamp(1_000 + UPGRADE_DELAY_MS);
    executeUpgrade(new Args().add(code).serialize());
    expect(pendingUpgrade([]).length).toBe(0);
  });

  throws('an upgrade before the delay', () => {
    deploy();
    const code: StaticArray<u8> = [0, 97, 115, 109, 42];
    callAs(ADMIN);
    mockTimestamp(1_000);
    proposeUpgrade(new Args().add(sha256(code)).serialize());
    mockTimestamp(1_000 + UPGRADE_DELAY_MS - 1);
    executeUpgrade(new Args().add(code).serialize());
  });

  throws('code other than the proposed one', () => {
    deploy();
    callAs(ADMIN);
    mockTimestamp(1_000);
    proposeUpgrade(new Args().add(sha256([1])).serialize());
    mockTimestamp(1_000 + UPGRADE_DELAY_MS);
    executeUpgrade(new Args().add<StaticArray<u8>>([2]).serialize());
  });

  throws('an upgrade after the proposal was cancelled', () => {
    deploy();
    const code: StaticArray<u8> = [0, 97, 115, 109, 42];
    callAs(ADMIN);
    mockTimestamp(1_000);
    proposeUpgrade(new Args().add(sha256(code)).serialize());
    cancelUpgrade([]);
    mockTimestamp(1_000 + UPGRADE_DELAY_MS);
    executeUpgrade(new Args().add(code).serialize());
  });

  throws('cancelling when nothing is pending', () => {
    deploy();
    callAs(ADMIN);
    cancelUpgrade([]);
  });

  throws('a proposal by someone else', () => {
    deploy();
    callAs(ALICE);
    proposeUpgrade(new Args().add(sha256([1])).serialize());
  });
});

describe('Launchpad listing', () => {
  test('pages newest first', () => {
    deploy();
    aliceLaunches('AAA');
    aliceLaunches('BBB');
    aliceLaunches('CCC');
    const first = new Args(
      getProjects(new Args().add(KIND_TOKEN).add(u64(0)).add(u32(2)).serialize()),
    );
    expect(first.nextU64().unwrap()).toBe(3);
    const firstPage = first.nextSerializableObjectArray<Project>().unwrap();
    expect(firstPage.length).toBe(2);
    expect(firstPage[0].symbol).toBe('CCC');
    expect(firstPage[1].symbol).toBe('BBB');
    const second = new Args(
      getProjects(new Args().add(KIND_TOKEN).add(u64(2)).add(u32(2)).serialize()),
    );
    second.nextU64();
    const secondPage = second.nextSerializableObjectArray<Project>().unwrap();
    expect(secondPage.length).toBe(1);
    expect(secondPage[0].symbol).toBe('AAA');
    const beyond = new Args(
      getProjects(new Args().add(KIND_TOKEN).add(u64(9)).add(u32(2)).serialize()),
    );
    beyond.nextU64();
    expect(beyond.nextSerializableObjectArray<Project>().unwrap().length).toBe(0);
  });

  throws('a page larger than 50', () => {
    deploy();
    getProjects(new Args().add(KIND_TOKEN).add(u64(0)).add(u32(51)).serialize());
  });
});
