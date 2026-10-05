// RustCore Launchpad — the platform's only contract (docs/ANALYSIS.md, "Smart contractul
// Launchpad"). Phase 2: Factory (deploys RC-Token / RC-Collection from versioned templates,
// the caller becomes the owner), Registry (records, indexes, editable presentation, imports)
// and Admin (fees, templates, verification, pause, upgrade timelock). Marketplace and Presale
// arrive in phases 5 and 6.
//
// Every write settles its own cost (lib/launchpad/settlement.ts): the caller's MAS pay the
// platform fee and the storage the call consumed; the rest is refunded.
import {
  Args,
  boolToByte,
  bytesToString,
  bytesToU32,
  bytesToU64,
  stringToBytes,
  u32ToBytes,
  u64ToBytes,
} from '@massalabs/as-types';
import {
  Address,
  Context,
  Storage,
  assertIsSmartContract,
  balance,
  call,
  createEvent,
  createSC,
  generateEvent,
  getBytecodeOf,
  isDeployingContract,
  setBytecode,
  sha256,
  transferCoins,
  validateAddress,
} from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly';
import {
  ADMIN_KEY,
  CONFIG_KEY,
  KIND_COLLECTION,
  KIND_TOKEN,
  MRC20_DECIMALS_KEY,
  MRC20_NAME_KEY,
  MRC20_SYMBOL_KEY,
  MRC20_TOTAL_SUPPLY_KEY,
  MRC721_NAME_KEY,
  MRC721_SYMBOL_KEY,
  STD_OWNER_KEY,
  UPGRADE_KEY,
  addressKey,
  categoryKey,
  countKey,
  creatorKey,
  creatorPrefix,
  projectKey,
  projectRef,
  symbolKey,
  templateCodeKey,
  templateHashKey,
  templateVersionKey,
  u64FromBE,
} from '../lib/launchpad/keys';
import {
  Config,
  Project,
  ProjectInfo,
  SOURCE_IMPORTED,
  SOURCE_LAUNCHED,
  UpgradeProposal,
} from '../lib/launchpad/records';
import {
  MAX_COLLECTION_SUPPLY,
  MAX_PAGE,
  RESERVED_SYMBOLS,
  assertCategory,
  assertInfo,
  assertName,
  assertRoyalty,
  assertSymbol,
} from '../lib/launchpad/rules';
import { accruedFees, settle } from '../lib/launchpad/settlement';
import {
  _activeConfig,
  _config,
  _count,
  _load,
  _nextId,
  _onlyAdmin,
  _ownerOf,
} from '../lib/launchpad/common';

export const VERSION = '0.4.1';
/** Delay between proposing and executing an upgrade of this contract: 72 hours. */
export const UPGRADE_DELAY_MS: u64 = 72 * 60 * 60 * 1000;
export const MAX_DECIMALS: u8 = 18;
/** Imported names and symbols longer than this are refused (they would break the pages). */
const MAX_IMPORTED_TEXT = 64;

// ==================================================== //
// ====                 DEPLOYMENT                 ==== //
// ==================================================== //

/** Args: config (Config). The deployer becomes the admin; well-known symbols are reserved. */
export function constructor(binaryArgs: StaticArray<u8>): void {
  assert(isDeployingContract(), 'constructor can only run at deploy time');
  const config = new Args(binaryArgs)
    .nextSerializable<Config>()
    .expect('config is missing or invalid');
  Storage.set(ADMIN_KEY, stringToBytes(Context.caller().toString()));
  Storage.set(CONFIG_KEY, config.serialize());
  for (let i = 0; i < RESERVED_SYMBOLS.length; i++) {
    Storage.set(symbolKey(RESERVED_SYMBOLS[i]), new StaticArray<u8>(0));
  }
  generateEvent('LAUNCHPAD_DEPLOYED');
}

// ==================================================== //
// ====                   FACTORY                  ==== //
// ==================================================== //

/**
 * Deploys an RC-Token owned by the caller, who also receives the initial supply.
 * Args: name, symbol (A-Z 0-9), decimals (u8), initialSupply (u256), mintable (bool),
 * maxSupply (u256, ignored unless mintable), burnable (bool), mutable (bool), category (u8),
 * info (ProjectInfo). Coins: token fee + storage (see `config` and the app's simulation).
 */
export function createToken(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  const config = _activeConfig();
  const args = new Args(binaryArgs);
  const name = args.nextString().expect('name is missing or invalid');
  const symbol = args.nextString().expect('symbol is missing or invalid');
  const decimals = args.nextU8().expect('decimals is missing or invalid');
  const initialSupply = args.nextU256().expect('initialSupply is missing or invalid');
  const mintable = args.nextBool().expect('mintable is missing or invalid');
  const maxSupply = args.nextU256().expect('maxSupply is missing or invalid');
  const burnable = args.nextBool().expect('burnable is missing or invalid');
  const mutable = args.nextBool().expect('mutable is missing or invalid');
  const category = args.nextU8().expect('category is missing or invalid');
  const info = args.nextSerializable<ProjectInfo>().expect('info is missing or invalid');

  assertName(name);
  assertSymbol(symbol);
  assert(decimals <= MAX_DECIMALS, 'Decimals must be at most 18');
  assert(initialSupply > u256.Zero, 'Initial supply must be greater than zero');
  assert(!mintable || maxSupply >= initialSupply, 'Max supply is below the initial supply');
  assertCategory(KIND_TOKEN, category);
  assertInfo(info);
  assert(!Storage.has(symbolKey(symbol)), 'This symbol is already taken or reserved');

  const creator = Context.caller().toString();
  const version = _currentTemplate(KIND_TOKEN);
  const token = createSC(Storage.get(templateCodeKey(KIND_TOKEN, version)));
  call(
    token,
    'constructor',
    new Args()
      .add(name)
      .add(symbol)
      .add(decimals)
      .add(initialSupply)
      .add(creator)
      .add(mintable)
      .add(maxSupply)
      .add(burnable)
      .add(mutable),
    config.deployDeposit,
  );

  const project = new Project(
    KIND_TOKEN,
    _nextId(KIND_TOKEN),
    token.toString(),
    SOURCE_LAUNCHED,
    creator,
    Context.timestamp(),
    version,
    Storage.get(templateHashKey(KIND_TOKEN, version)),
    name,
    symbol,
    decimals,
    mutable,
    category,
  );
  project.info = info;
  _record(project);
  Storage.set(symbolKey(symbol), projectRef(KIND_TOKEN, project.id));
  generateEvent(createEvent('TOKEN_CREATED', [project.id.toString(), project.address, creator]));
  settle(before, config.tokenFee);
}

/**
 * Deploys an RC-Collection owned by the caller.
 * Args: name, symbol, maxSupply (u256, 1-100 000), baseURI, mintPrice (u64), maxPerWallet (u32),
 * publicMint (bool), mutable (bool), royaltyBps (u16, ≤ 1000), royaltyReceiver (string, empty =
 * the caller), category (u8), info (ProjectInfo). Coins: collection fee + storage.
 */
export function createCollection(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  const config = _activeConfig();
  const args = new Args(binaryArgs);
  const name = args.nextString().expect('name is missing or invalid');
  const symbol = args.nextString().expect('symbol is missing or invalid');
  const maxSupply = args.nextU256().expect('maxSupply is missing or invalid');
  const baseURI = args.nextString().expect('baseURI is missing or invalid');
  const mintPrice = args.nextU64().expect('mintPrice is missing or invalid');
  const maxPerWallet = args.nextU32().expect('maxPerWallet is missing or invalid');
  const publicMint = args.nextBool().expect('publicMint is missing or invalid');
  const mutable = args.nextBool().expect('mutable is missing or invalid');
  const royaltyBps = args.nextU16().expect('royaltyBps is missing or invalid');
  let royaltyReceiver = args.nextString().expect('royaltyReceiver is missing or invalid');
  const category = args.nextU8().expect('category is missing or invalid');
  const info = args.nextSerializable<ProjectInfo>().expect('info is missing or invalid');

  const creator = Context.caller().toString();
  if (royaltyReceiver.length == 0) royaltyReceiver = creator;
  assertName(name);
  assertSymbol(symbol);
  assert(
    maxSupply > u256.Zero && maxSupply <= u256.fromU64(MAX_COLLECTION_SUPPLY),
    'Max supply must be 1-100000',
  );
  assertRoyalty(royaltyBps);
  assert(validateAddress(royaltyReceiver), 'Invalid royalty receiver address');
  assertCategory(KIND_COLLECTION, category);
  assertInfo(info);

  const version = _currentTemplate(KIND_COLLECTION);
  const collection = createSC(Storage.get(templateCodeKey(KIND_COLLECTION, version)));
  call(
    collection,
    'constructor',
    new Args()
      .add(name)
      .add(symbol)
      .add(creator)
      .add(maxSupply)
      .add(baseURI)
      .add(mintPrice)
      .add(maxPerWallet)
      .add(publicMint)
      .add(mutable),
    config.deployDeposit,
  );

  const project = new Project(
    KIND_COLLECTION,
    _nextId(KIND_COLLECTION),
    collection.toString(),
    SOURCE_LAUNCHED,
    creator,
    Context.timestamp(),
    version,
    Storage.get(templateHashKey(KIND_COLLECTION, version)),
    name,
    symbol,
    0,
    mutable,
    category,
    false,
    false,
    royaltyBps,
    royaltyReceiver,
  );
  project.info = info;
  _record(project);
  generateEvent(
    createEvent('COLLECTION_CREATED', [project.id.toString(), project.address, creator]),
  );
  settle(before, config.collectionFee);
}

// ==================================================== //
// ====                   IMPORT                   ==== //
// ==================================================== //

/**
 * Lists an existing MRC20 token in the Launchpad. Only its current owner (standard OWNER key)
 * may import it, once. Args: address (string), category (u8), info (ProjectInfo).
 * Coins: import fee + storage.
 */
export function importToken(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  const config = _activeConfig();
  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address is missing or invalid');
  const category = args.nextU8().expect('category is missing or invalid');
  const info = args.nextSerializable<ProjectInfo>().expect('info is missing or invalid');
  assertCategory(KIND_TOKEN, category);
  assertInfo(info);

  const contract = _importable(address);
  assert(
    Storage.hasOf(contract, MRC20_NAME_KEY) &&
      Storage.hasOf(contract, MRC20_SYMBOL_KEY) &&
      Storage.hasOf(contract, MRC20_DECIMALS_KEY) &&
      Storage.hasOf(contract, MRC20_TOTAL_SUPPLY_KEY),
    'Not a standard MRC20 token',
  );
  const name = bytesToString(Storage.getOf(contract, MRC20_NAME_KEY));
  const symbol = bytesToString(Storage.getOf(contract, MRC20_SYMBOL_KEY));
  const decimalsBytes = Storage.getOf(contract, MRC20_DECIMALS_KEY);
  assert(decimalsBytes.length == 1, 'Not a standard MRC20 token');
  _assertImportedText(name, symbol);

  const project = new Project(
    KIND_TOKEN,
    _nextId(KIND_TOKEN),
    address,
    SOURCE_IMPORTED,
    Context.caller().toString(),
    Context.timestamp(),
    0,
    sha256(getBytecodeOf(contract)),
    name,
    symbol,
    decimalsBytes[0],
    true,
    category,
  );
  project.info = info;
  _record(project);
  generateEvent(createEvent('TOKEN_IMPORTED', [project.id.toString(), address, project.creator]));
  settle(before, config.importFee);
}

/**
 * Lists an existing MRC721 collection. Only its current owner may import it, once.
 * Args: address (string), royaltyBps (u16), royaltyReceiver (string, empty = the caller),
 * category (u8), info (ProjectInfo). Coins: import fee + storage.
 */
export function importCollection(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  const config = _activeConfig();
  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address is missing or invalid');
  const royaltyBps = args.nextU16().expect('royaltyBps is missing or invalid');
  let royaltyReceiver = args.nextString().expect('royaltyReceiver is missing or invalid');
  const category = args.nextU8().expect('category is missing or invalid');
  const info = args.nextSerializable<ProjectInfo>().expect('info is missing or invalid');
  const creator = Context.caller().toString();
  if (royaltyReceiver.length == 0) royaltyReceiver = creator;
  assertRoyalty(royaltyBps);
  assert(validateAddress(royaltyReceiver), 'Invalid royalty receiver address');
  assertCategory(KIND_COLLECTION, category);
  assertInfo(info);

  const contract = _importable(address);
  assert(
    Storage.hasOf(contract, MRC721_NAME_KEY) && Storage.hasOf(contract, MRC721_SYMBOL_KEY),
    'Not a standard MRC721 collection',
  );
  const name = bytesToString(Storage.getOf(contract, MRC721_NAME_KEY));
  const symbol = bytesToString(Storage.getOf(contract, MRC721_SYMBOL_KEY));
  _assertImportedText(name, symbol);

  const project = new Project(
    KIND_COLLECTION,
    _nextId(KIND_COLLECTION),
    address,
    SOURCE_IMPORTED,
    creator,
    Context.timestamp(),
    0,
    sha256(getBytecodeOf(contract)),
    name,
    symbol,
    0,
    true,
    category,
    false,
    false,
    royaltyBps,
    royaltyReceiver,
  );
  project.info = info;
  _record(project);
  generateEvent(createEvent('COLLECTION_IMPORTED', [project.id.toString(), address, creator]));
  settle(before, config.importFee);
}

// ==================================================== //
// ====              OWNER EDITS                   ==== //
// ==================================================== //

/**
 * Edits the presentation of a token or collection. Only the contract's current owner.
 * Args: kind (u8), id (u64), category (u8), info (ProjectInfo). Coins: storage difference.
 */
export function updateInfo(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  const args = new Args(binaryArgs);
  const kind = args.nextU8().expect('kind is missing or invalid');
  const id = args.nextU64().expect('id is missing or invalid');
  const category = args.nextU8().expect('category is missing or invalid');
  const info = args.nextSerializable<ProjectInfo>().expect('info is missing or invalid');
  const project = _load(kind, id);
  _onlyProjectOwner(project);
  assertCategory(kind, category);
  assertInfo(info);
  if (category != project.category) {
    Storage.del(categoryKey(kind, project.category, id));
    Storage.set(categoryKey(kind, category, id), new StaticArray<u8>(0));
    project.category = category;
  }
  project.info = info;
  Storage.set(projectKey(kind, id), project.serialize());
  generateEvent(createEvent('INFO_UPDATED', [kind.toString(), id.toString()]));
  settle(before, 0);
}

/** Args: id (u64), royaltyBps (u16, ≤ 1000), receiver (string). Collection owner only. */
export function setRoyalty(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  const args = new Args(binaryArgs);
  const id = args.nextU64().expect('id is missing or invalid');
  const royaltyBps = args.nextU16().expect('royaltyBps is missing or invalid');
  const receiver = args.nextString().expect('receiver is missing or invalid');
  const project = _load(KIND_COLLECTION, id);
  _onlyProjectOwner(project);
  assertRoyalty(royaltyBps);
  assert(validateAddress(receiver), 'Invalid royalty receiver address');
  project.royaltyBps = royaltyBps;
  project.royaltyReceiver = receiver;
  Storage.set(projectKey(KIND_COLLECTION, id), project.serialize());
  generateEvent(createEvent('ROYALTY_UPDATED', [id.toString(), royaltyBps.toString(), receiver]));
  settle(before, 0);
}

// ==================================================== //
// ====                   ADMIN                    ==== //
// ==================================================== //

/** Args: config (Config). */
export function setConfig(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  const config = new Args(binaryArgs)
    .nextSerializable<Config>()
    .expect('config is missing or invalid');
  Storage.set(CONFIG_KEY, config.serialize());
  generateEvent('CONFIG_UPDATED');
  settle(before, 0);
}

/** Args: kind (u8), bytecode (bytes). Adds the next template version; launches use the newest. */
export function setTemplate(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  const args = new Args(binaryArgs);
  const kind = args.nextU8().expect('kind is missing or invalid');
  const bytecode = args.nextBytes().expect('bytecode is missing or invalid');
  assert(kind <= KIND_COLLECTION, 'Unknown kind');
  assert(bytecode.length > 0, 'Empty bytecode');
  const version = _templateVersion(kind) + 1;
  Storage.set(templateCodeKey(kind, version), bytecode);
  Storage.set(templateHashKey(kind, version), sha256(bytecode));
  Storage.set(templateVersionKey(kind), u32ToBytes(version));
  generateEvent(createEvent('TEMPLATE_SET', [kind.toString(), version.toString()]));
  settle(before, 0);
}

/** Args: kind (u8), id (u64), verified (bool). */
export function setVerified(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  const args = new Args(binaryArgs);
  const project = _load(args.nextU8().expect('kind'), args.nextU64().expect('id'));
  project.verified = args.nextBool().expect('verified is missing or invalid');
  Storage.set(projectKey(project.kind, project.id), project.serialize());
  settle(before, 0);
}

/** Args: kind (u8), id (u64), hidden (bool). Hidden projects stay readable; the app hides them. */
export function setHidden(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  const args = new Args(binaryArgs);
  const project = _load(args.nextU8().expect('kind'), args.nextU64().expect('id'));
  project.hidden = args.nextBool().expect('hidden is missing or invalid');
  Storage.set(projectKey(project.kind, project.id), project.serialize());
  settle(before, 0);
}

/** Args: symbol (string), reserved (bool). Reserves a symbol, or frees a reserved one. */
export function reserveSymbol(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  const args = new Args(binaryArgs);
  const symbol = args.nextString().expect('symbol is missing or invalid');
  const reserved = args.nextBool().expect('reserved is missing or invalid');
  assertSymbol(symbol);
  const key = symbolKey(symbol);
  const taken = Storage.has(key) && Storage.get(key).length > 0;
  assert(!taken, 'This symbol belongs to a launched token');
  if (reserved) Storage.set(key, new StaticArray<u8>(0));
  else if (Storage.has(key)) Storage.del(key);
  settle(before, 0);
}

/** Args: paused (bool). A pause stops launches and imports; edits keep working. */
export function setPaused(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  const config = _config();
  config.paused = new Args(binaryArgs).nextBool().expect('paused is missing or invalid');
  Storage.set(CONFIG_KEY, config.serialize());
  generateEvent(config.paused ? 'PAUSED' : 'UNPAUSED');
  settle(before, 0);
}

/** Args: to (string), amount (u64). Pays out collected fees — never more than collected. */
export function withdrawFees(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  const args = new Args(binaryArgs);
  const to = args.nextString().expect('to is missing or invalid');
  const amount = args.nextU64().expect('amount is missing or invalid');
  assert(validateAddress(to), 'Invalid recipient address');
  const fees = accruedFees();
  assert(amount > 0 && amount <= fees, 'Amount exceeds the collected fees');
  Storage.set(stringToBytes('fees'), u64ToBytes(fees - amount));
  settle(before, 0);
  transferCoins(new Address(to), amount);
  generateEvent(createEvent('FEES_WITHDRAWN', [to, amount.toString()]));
}

/** Args: newAdmin (string). */
export function transferAdmin(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  const newAdmin = new Args(binaryArgs).nextString().expect('newAdmin is missing or invalid');
  assert(validateAddress(newAdmin), 'Invalid admin address');
  Storage.set(ADMIN_KEY, stringToBytes(newAdmin));
  generateEvent(createEvent('ADMIN_CHANGED', [newAdmin]));
  settle(before, 0);
}

/** Args: codeHash (bytes, sha256 of the new bytecode). Starts the 72 h public delay. */
export function proposeUpgrade(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  const hash = new Args(binaryArgs).nextBytes().expect('codeHash is missing or invalid');
  assert(hash.length == 32, 'codeHash must be a sha256 hash');
  const proposal = new UpgradeProposal(hash, Context.timestamp() + UPGRADE_DELAY_MS);
  Storage.set(UPGRADE_KEY, proposal.serialize());
  generateEvent(createEvent('UPGRADE_PROPOSED', [proposal.executableAt.toString()]));
  settle(before, 0);
}

export function cancelUpgrade(_: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  assert(Storage.has(UPGRADE_KEY), 'No upgrade is pending');
  Storage.del(UPGRADE_KEY);
  generateEvent('UPGRADE_CANCELLED');
  settle(before, 0);
}

/** Args: bytecode (bytes). Only the proposed code, and only once the delay has passed. */
export function executeUpgrade(binaryArgs: StaticArray<u8>): void {
  _onlyAdmin();
  assert(Storage.has(UPGRADE_KEY), 'No upgrade is pending');
  const proposal = new Args(Storage.get(UPGRADE_KEY)).nextSerializable<UpgradeProposal>().unwrap();
  assert(Context.timestamp() >= proposal.executableAt, 'The upgrade delay has not passed yet');
  const bytecode = new Args(binaryArgs).nextBytes().expect('bytecode is missing or invalid');
  assert(_equal(sha256(bytecode), proposal.codeHash), 'This is not the proposed code');
  Storage.del(UPGRADE_KEY);
  setBytecode(bytecode);
  generateEvent('UPGRADE_EXECUTED');
}

// Marketplace (phase 5), in lib/launchpad/marketplace.ts.
export {
  list,
  updatePrice,
  cancel,
  buy,
  getListing,
  getListings,
  getListingsBySeller,
  listingOf,
  isListingValid,
  buyProblem,
  getSales,
  getStats,
} from '../lib/launchpad/marketplace';

// Presale (phase 6), in lib/launchpad/presale.ts.
export {
  createPresale,
  contribute,
  finalize,
  claim,
  refund,
  withdrawRaised,
  cancelPresale,
  getPresale,
  getPresales,
  presaleOf,
  getContribution,
  getContributionsOf,
} from '../lib/launchpad/presale';

// ==================================================== //
// ====                   READS                    ==== //
// ==================================================== //

export function version(_: StaticArray<u8>): StaticArray<u8> {
  return stringToBytes(VERSION);
}

export function admin(_: StaticArray<u8>): StaticArray<u8> {
  return Storage.get(ADMIN_KEY);
}

/** Returns Config. */
export function config(_: StaticArray<u8>): StaticArray<u8> {
  return Storage.get(CONFIG_KEY);
}

/** Returns u64: platform fees collected and not withdrawn. */
export function fees(_: StaticArray<u8>): StaticArray<u8> {
  return u64ToBytes(accruedFees());
}

/** Args: kind (u8). Returns Args: version (u32, 0 = none), codeHash (bytes). */
export function template(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const kind = new Args(binaryArgs).nextU8().expect('kind is missing or invalid');
  const version = _templateVersion(kind);
  const hash = version > 0 ? Storage.get(templateHashKey(kind, version)) : new StaticArray<u8>(0);
  return new Args().add(version).add(hash).serialize();
}

/** Args: kind (u8). Returns u64: how many projects of this kind exist (ids are 1..count). */
export function count(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const kind = new Args(binaryArgs).nextU8().expect('kind is missing or invalid');
  return u64ToBytes(_count(kind));
}

/** Args: kind (u8), id (u64). Returns Project. */
export function getProject(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const kind = args.nextU8().expect('kind is missing or invalid');
  const id = args.nextU64().expect('id is missing or invalid');
  const key = projectKey(kind, id);
  assert(Storage.has(key), 'Unknown project');
  return Storage.get(key);
}

/** Args: address (string). Returns Project. */
export function getProjectByAddress(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const address = new Args(binaryArgs).nextString().expect('address is missing or invalid');
  const key = addressKey(address);
  assert(Storage.has(key), 'Not in the Launchpad');
  const ref = Storage.get(key);
  return Storage.get(projectKey(ref[0], u64FromBE(ref, 1)));
}

/**
 * Newest first. Args: kind (u8), offset (u64, from the newest), limit (u32, ≤ 50).
 * Returns Args: total (u64), projects (Project[]).
 */
export function getProjects(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const kind = args.nextU8().expect('kind is missing or invalid');
  const offset = args.nextU64().expect('offset is missing or invalid');
  const limit = args.nextU32().expect('limit is missing or invalid');
  assert(limit > 0 && limit <= MAX_PAGE, 'Limit must be 1-50');
  const total = _count(kind);
  const page: Project[] = [];
  if (offset < total) {
    let id = total - offset;
    while (id >= 1 && page.length < i32(limit)) {
      page.push(new Args(Storage.get(projectKey(kind, id))).nextSerializable<Project>().unwrap());
      id--;
    }
  }
  return new Args().add(total).addSerializableObjectArray<Project>(page).serialize();
}

/** Args: creator (string), kind (u8). Returns Args: ids (u64[]) the address launched or imported. */
export function getCreatedBy(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const creator = args.nextString().expect('creator is missing or invalid');
  const kind = args.nextU8().expect('kind is missing or invalid');
  const keys = Storage.getKeys(creatorPrefix(creator, kind));
  const ids: u64[] = [];
  for (let i = 0; i < keys.length; i++) ids.push(u64FromBE(keys[i], keys[i].length - 8));
  return new Args().add(ids).serialize();
}

/** Args: symbol (string). Returns a bool byte: true if a launch may use it. */
export function isSymbolAvailable(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const symbol = new Args(binaryArgs).nextString().expect('symbol is missing or invalid');
  return boolToByte(!Storage.has(symbolKey(symbol)));
}

/** Returns UpgradeProposal, or empty bytes when none is pending. */
export function pendingUpgrade(_: StaticArray<u8>): StaticArray<u8> {
  return Storage.has(UPGRADE_KEY) ? Storage.get(UPGRADE_KEY) : new StaticArray<u8>(0);
}

// ==================================================== //
// ====                  INTERNALS                 ==== //
// ==================================================== //

function _templateVersion(kind: u8): u32 {
  const key = templateVersionKey(kind);
  return Storage.has(key) ? bytesToU32(Storage.get(key)) : 0;
}

function _currentTemplate(kind: u8): u32 {
  const version = _templateVersion(kind);
  assert(version > 0, 'No template is available yet');
  return version;
}

/** Writes the record and its indexes (address, creator, category). */
function _record(project: Project): void {
  assert(!Storage.has(addressKey(project.address)), 'Already in the Launchpad');
  Storage.set(projectKey(project.kind, project.id), project.serialize());
  Storage.set(addressKey(project.address), projectRef(project.kind, project.id));
  Storage.set(creatorKey(project.creator, project.kind, project.id), new StaticArray<u8>(0));
  Storage.set(categoryKey(project.kind, project.category, project.id), new StaticArray<u8>(0));
}

function _onlyProjectOwner(project: Project): void {
  const owner = _ownerOf(new Address(project.address));
  assert(
    owner != '' && owner == Context.caller().toString(),
    'Only the contract owner can do this',
  );
}

/** A deployed contract, not yet listed, whose owner is the caller. */
function _importable(address: string): Address {
  assertIsSmartContract(address);
  assert(!Storage.has(addressKey(address)), 'Already in the Launchpad');
  const contract = new Address(address);
  const owner = _ownerOf(contract);
  assert(
    owner != '' && owner == Context.caller().toString(),
    'Only the contract owner can import it',
  );
  return contract;
}

function _assertImportedText(name: string, symbol: string): void {
  assert(
    name.length > 0 && name.length <= MAX_IMPORTED_TEXT,
    'The contract name is empty or too long',
  );
  assert(
    symbol.length > 0 && symbol.length <= MAX_IMPORTED_TEXT,
    'The contract symbol is empty or too long',
  );
}

function _equal(a: StaticArray<u8>, b: StaticArray<u8>): bool {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] != b[i]) return false;
  return true;
}
