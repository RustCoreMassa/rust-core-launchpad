// Deploys the Launchpad SC, uploads both templates and checks the result with read-only calls.
//
//   cp .env.example .env   # PRIVATE_KEY of the deployer (becomes the Launchpad admin)
//   npm run deploy         # buildnet; NETWORK=mainnet npm run deploy for mainnet
//
// Fees come from .env (in MAS; buildnet defaults below). The result is written to
// deployments/<network>.json; copy the address into src/app/core/network/networks.ts.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import {
  Account,
  Args,
  JsonRpcProvider,
  Mas,
  OperationStatus,
  SmartContract,
  StorageCost,
} from '@massalabs/massa-web3';
import { getScByteCode } from './utils';

const KIND_TOKEN = 0;
const KIND_COLLECTION = 1;

const network = process.env['NETWORK'] === 'mainnet' ? 'mainnet' : 'buildnet';
const mas = (name: string, fallback: string) => Mas.fromString(process.env[name] ?? fallback);
const config = {
  tokenFee: mas('TOKEN_FEE_MAS', '1'),
  collectionFee: mas('COLLECTION_FEE_MAS', '1'),
  importFee: mas('IMPORT_FEE_MAS', '0.5'),
  presaleFeeBps: Number(process.env['PRESALE_FEE_BPS'] ?? '200'),
  deployDeposit: mas('DEPLOY_DEPOSIT_MAS', '0.1'),
};

const account = await Account.fromEnv();
const provider =
  network === 'mainnet' ? JsonRpcProvider.mainnet(account) : JsonRpcProvider.buildnet(account);
const admin = account.address.toString();
console.log(`Network ${network}, admin ${admin}`);
console.log(`Balance before: ${Mas.toString(await provider.balance(false))} MAS`);

// 1. The Launchpad itself. Constructor args = the Config record, field by field.
const launchpadCode = getScByteCode('build', 'launchpad.wasm');
const constructorArgs = new Args()
  .addU64(config.tokenFee)
  .addU64(config.collectionFee)
  .addU64(config.importFee)
  .addU16(BigInt(config.presaleFeeBps))
  .addU64(config.deployDeposit)
  .addBool(false);
console.log(`Deploying launchpad.wasm (${launchpadCode.length} bytes)…`);
const launchpad = await SmartContract.deploy(provider, launchpadCode, constructorArgs, {
  coins: Mas.fromString('0.1'), // constructor storage (config, admin, reserved symbols)
  waitFinalExecution: true,
});
console.log(`Launchpad deployed at ${launchpad.address}`);

// 2. Templates. Coins cover their storage; the contract refunds what is left.
const templates: Record<string, { version: number; sha256: string; bytes: number }> = {};
for (const [kind, file] of [
  [KIND_TOKEN, 'rc-token.wasm'],
  [KIND_COLLECTION, 'rc-collection.wasm'],
] as const) {
  const code = getScByteCode('build', file);
  const coins =
    StorageCost.datastoreEntry(new Uint8Array(9), code) +
    StorageCost.datastoreEntry(new Uint8Array(10), new Uint8Array(32)) +
    StorageCost.datastoreEntry(new Uint8Array(6), new Uint8Array(4)) +
    Mas.fromString('0.05');
  console.log(`Uploading ${file} (${code.length} bytes, sending ${Mas.toString(coins)} MAS)…`);
  const op = await launchpad.call(
    'setTemplate',
    new Args().addU8(BigInt(kind)).addUint8Array(code),
    {
      coins,
    },
  );
  const status = await op.waitFinalExecution();
  if (status !== OperationStatus.Success) {
    console.error(await op.getFinalEvents());
    throw new Error(`setTemplate(${file}) failed with status ${OperationStatus[status]}`);
  }
  templates[file] = {
    version: 0,
    sha256: createHash('sha256').update(code).digest('hex'),
    bytes: code.length,
  };
}

// 3. Read back what is on-chain.
for (const [kind, file] of [
  [KIND_TOKEN, 'rc-token.wasm'],
  [KIND_COLLECTION, 'rc-collection.wasm'],
] as const) {
  const read = await launchpad.read('template', new Args().addU8(BigInt(kind)));
  const result = new Args(read.value);
  const version = Number(result.nextU32());
  const hash = Buffer.from(result.nextUint8Array()).toString('hex');
  if (hash !== templates[file].sha256) throw new Error(`${file}: on-chain hash ${hash} differs`);
  templates[file].version = version;
  console.log(`${file}: version ${version}, sha256 ${hash} ✓`);
}
const adminOnChain = new TextDecoder().decode((await launchpad.read('admin')).value);
if (adminOnChain !== admin) throw new Error(`Admin on-chain is ${adminOnChain}`);
console.log(`Admin ✓, balance after: ${Mas.toString(await provider.balance(false))} MAS`);

mkdirSync('deployments', { recursive: true });
const record = {
  network,
  address: launchpad.address,
  admin,
  deployedAt: new Date().toISOString(),
  launchpadBytes: launchpadCode.length,
  config: {
    tokenFee: Mas.toString(config.tokenFee),
    collectionFee: Mas.toString(config.collectionFee),
    importFee: Mas.toString(config.importFee),
    presaleFeeBps: config.presaleFeeBps,
    deployDeposit: Mas.toString(config.deployDeposit),
  },
  templates,
};
writeFileSync(`deployments/${network}.json`, JSON.stringify(record, null, 2) + '\n');
console.log(`Saved deployments/${network}.json`);
