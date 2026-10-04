// End-to-end check of NFT collections on buildnet, with the app's own encoding and cost code:
//   npx tsx src/e2e-collections.ts
// Sends real (test) transactions from PRIVATE_KEY. Never on mainnet.
import 'dotenv/config';
import { readFileSync } from 'fs';
import {
  Account,
  Args,
  JsonRpcProvider,
  Mas,
  Operation,
  OperationStatus,
  SmartContract,
  U256,
} from '@massalabs/massa-web3';
import {
  createCollectionArgs,
  EMPTY_COLLECTION_DRAFT,
} from '../../src/app/features/create/collection-draft';
import { launchCost, recordCost } from '../../src/app/core/launchpad/launch-cost';
import {
  mintWithUriCoins,
  nftStorage,
  publicMintCoins,
  settingCoins,
} from '../../src/app/core/launchpad/mint-cost';
import {
  KIND_COLLECTION,
  readConfig,
  readProject,
  writeInfo,
} from '../../src/app/core/launchpad/records';
import { contractReason, eventFields } from '../../src/app/core/launchpad/events';

if (process.env['NETWORK'] === 'mainnet') throw new Error('e2e runs on buildnet only');
const LAUNCHPAD: string = JSON.parse(readFileSync('deployments/buildnet.json', 'utf8')).address;
const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);
const me = account.address.toString();
const fee = await provider.client.getMinimalFee();
const mas = (n: bigint) => `${n < 0n ? '-' : ''}${Mas.toString(n < 0n ? -n : n)} MAS`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function read(target: string, func: string, args = new Args(), coins?: bigint) {
  const result = await provider.readSC({ target, func, parameter: args, caller: me, coins });
  if (result.info.error) throw new Error(result.info.error);
  return result.value;
}

async function send(target: string, func: string, args: Args, coins: bigint) {
  await read(target, func, args, coins);
  const before = await provider.balance(true);
  const op: Operation = await provider.callSC({ target, func, parameter: args, coins });
  const status = await op.waitFinalExecution();
  const events = (await op.getFinalEvents()).map((e) => e.data);
  if (status !== OperationStatus.Success)
    throw new Error(`${func} failed: ${contractReason(events.at(-1) ?? '')}`);
  return { events, consumed: before - (await provider.balance(true)) - fee };
}

async function contractBalance(address: string): Promise<bigint> {
  return (await provider.balanceOf([address], true))[0].balance;
}

/** NFT ids and holders, read like the app's CollectionReader.items(). */
async function items(address: string): Promise<{ id: bigint; owner: string }[]> {
  const keys = (await provider.getStorageKeys(address, new Uint8Array([0x04]), true)).filter(
    (k) => k.length === 33 && k[0] === 0x04,
  );
  const owners = await provider.readStorage(address, keys, true);
  return keys.map((k, i) => ({
    id: U256.fromBytes(k.slice(1)),
    owner: new TextDecoder().decode(owners[i]!),
  }));
}

function mintInfo(bytes: Uint8Array) {
  const a = new Args(bytes);
  return {
    maxSupply: a.nextU256(),
    minted: a.nextU256(),
    totalSupply: a.nextU256(),
    mintPrice: a.nextU64(),
    maxPerWallet: Number(a.nextU32()),
    publicMint: a.nextBool(),
    baseURI: a.nextString(),
    frozen: a.nextBool(),
  };
}

const config = readConfig(new Args(await read(LAUNCHPAD, 'config')));
const template = new Args(await read(LAUNCHPAD, 'template', new Args().addU8(1n)));
const version = Number(template.nextU32());
const codeKey = new Uint8Array([...new TextEncoder().encode('tpl:'), 1, 0, 0, 0, version]);
const [code] = await provider.readStorage(LAUNCHPAD, [codeKey], true);
const cost = launchCost(config.collectionFee, config.deployDeposit, code!.length);
const symbol =
  'C' +
  Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X');

// ---- launch, folder metadata, public mint 0.5 MAS, 3 per wallet ----------------------------
const draft = {
  ...EMPTY_COLLECTION_DRAFT,
  name: 'E2E Cats',
  symbol,
  maxSupply: '10',
  baseURI: 'ipfs://bafyE2E/',
  publicMint: true,
  mintPrice: '0.5',
  maxPerWallet: '3',
  royalty: '5',
  category: 1,
};
console.log(`Launching collection ${symbol}, sending ${mas(cost.total)}`);
const launch = await send(LAUNCHPAD, 'createCollection', createCollectionArgs(draft), cost.total);
const [id, collection] = eventFields(launch.events, 'COLLECTION_CREATED') ?? [];
check(
  'COLLECTION_CREATED',
  !!collection,
  `${collection}, consumed ${mas(launch.consumed)} of ${mas(cost.total)}`,
);
const info = mintInfo(await read(collection, 'mintInfo'));
check(
  'mint config stored',
  info.mintPrice === 500_000_000n && info.maxPerWallet === 3 && info.publicMint,
);
check(
  'creator is the owner',
  new TextDecoder().decode(await read(collection, 'ownerAddress')) === me,
);

// ---- public mint (the price goes to the owner, here ourselves) -----------------------------
const pub = await send(
  collection,
  'publicMint',
  new Args().addU32(2n),
  publicMintCoins(info.mintPrice, 2),
);
check(
  'public mint of 2',
  (await items(collection)).length === 2,
  `wallet paid ${mas(pub.consumed)} net (storage; the price came back to the owner)`,
);
console.log(
  `  storage actually used: ${mas(pub.consumed)} for 2 NFTs + first-holder entries (estimate ${mas(nftStorage(2))})`,
);

// ---- the per-wallet limit stops a third and fourth mint ------------------------------------
try {
  await read(collection, 'publicMint', new Args().addU32(2n), publicMintCoins(info.mintPrice, 2));
  check('per-wallet limit', false, 'the simulation passed');
} catch (err) {
  const reason = contractReason((err as Error).message);
  check('per-wallet limit', reason === 'Mint limit per wallet reached', reason);
}

// ---- owner mint: measure what the storage really costs per NFT ------------------------------
const before = await contractBalance(collection);
await send(collection, 'ownerMint', new Args().addString(me).addU32(3n), nftStorage(3));
const after = await contractBalance(collection);
const storagePerNft = (nftStorage(3) - (after - before)) / 3n;
check(
  'owner mint of 3',
  (await items(collection)).length === 5,
  `real storage ≈ ${mas(storagePerNft)} per NFT (estimate ${mas(nftStorage(1) - nftStorage(0))})`,
);
check('estimate covers the real storage', storagePerNft <= 20_000_000n);

// ---- metadata, index, settings ----------------------------------------------------------------
check(
  'uri(1) = base + 1.json',
  new TextDecoder().decode(await read(collection, 'uri', new Args().addU256(1n))) ===
    'ipfs://bafyE2E/1.json',
);
const prefix = new TextEncoder().encode('ownedTokens' + me);
const owned = (await provider.getStorageKeys(collection, prefix, true)).filter(
  (k) => k.length === prefix.length + 32,
);
check('owner index lists my 5 NFTs', owned.length === 5);
await send(
  collection,
  'setMintConfig',
  new Args().addU64(0n).addU32(0n).addBool(false),
  settingCoins(),
);
check('public mint closed', !mintInfo(await read(collection, 'mintInfo')).publicMint);
await send(
  LAUNCHPAD,
  'setRoyalty',
  new Args().addU64(BigInt(id)).addU16(700n).addString(me),
  recordCost(0n),
);
const record = readProject(
  new Args(await read(LAUNCHPAD, 'getProject', new Args().addU8(1n).addU64(BigInt(id)))),
);
check('royalty updated in the Launchpad', record.royaltyBps === 700);

// ---- per-NFT metadata collection + ownerMintWithURI -----------------------------------------
const perToken = await send(
  LAUNCHPAD,
  'createCollection',
  createCollectionArgs({
    ...draft,
    symbol: symbol + 'U',
    metadataMode: 'perToken',
    publicMint: false,
  }),
  cost.total,
);
const [, uriCollection] = eventFields(perToken.events, 'COLLECTION_CREATED') ?? [];
const uri = 'ipfs://bafyOne/meta.json';
await send(
  uriCollection,
  'ownerMintWithURI',
  new Args().addString(me).addString(uri),
  mintWithUriCoins(uri),
);
check(
  'mint with its own URI',
  new TextDecoder().decode(await read(uriCollection, 'uri', new Args().addU256(1n))) === uri,
);

// ---- import -----------------------------------------------------------------------------------
const external = await SmartContract.deploy(
  provider,
  readFileSync('build/rc-collection.wasm'),
  new Args()
    .addString('External Cats')
    .addString('EXTC')
    .addString(me)
    .addU256(100n)
    .addString('')
    .addU64(0n)
    .addU32(0n)
    .addBool(false)
    .addBool(false),
  { coins: Mas.fromString('0.1'), waitFinalExecution: true },
);
const imported = await send(
  LAUNCHPAD,
  'importCollection',
  writeInfo(
    new Args().addString(external.address).addU16(250n).addString('').addU8(2n),
    draft.info,
  ),
  recordCost(config.importFee),
);
const [importedId] = eventFields(imported.events, 'COLLECTION_IMPORTED') ?? [];
const importedRecord = readProject(
  new Args(
    await read(
      LAUNCHPAD,
      'getProject',
      new Args().addU8(BigInt(KIND_COLLECTION)).addU64(BigInt(importedId)),
    ),
  ),
);
check(
  'import',
  importedRecord.name === 'External Cats' && importedRecord.royaltyReceiver === me,
  `consumed ${mas(imported.consumed)}`,
);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
