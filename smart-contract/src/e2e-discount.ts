// End-to-end check of the holder discount on buildnet (Launchpad v1.4.0+), with the app's own
// encoding and cost code: a "pass" collection is launched, the admin names it, and the fees of a
// holder are checked on a token launch, an import and a listing — then the NFT leaves and the
// discount with it. At the end the discount stays on, with a second NFT held by PRIVATE_KEY, so
// the app can be tried with it.
//   npx tsx src/e2e-discount.ts
// The admin is PRIVATE_KEY (≈ 17 test MAS a run). Run it alone: it measures fees collected. Never on mainnet.
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
} from '@massalabs/massa-web3';
import {
  createCollectionArgs,
  EMPTY_COLLECTION_DRAFT,
} from '../../src/app/features/create/collection-draft';
import { createTokenArgs, EMPTY_DRAFT } from '../../src/app/features/create/token-draft';
import { lessDiscount, lessDiscountBps } from '../../src/app/core/launchpad/discount';
import { launchCost, recordCost } from '../../src/app/core/launchpad/launch-cost';
import { nftStorage } from '../../src/app/core/launchpad/mint-cost';
import {
  readConfig,
  readHolderDiscount,
  readListing,
  writeInfo,
} from '../../src/app/core/launchpad/records';
import { contractReason, eventFields } from '../../src/app/core/launchpad/events';
import { ADMIN_COINS } from '../../src/app/features/admin/admin-forms';
import { deploymentFile } from './utils';

if (process.env['NETWORK'] === 'mainnet') throw new Error('e2e runs on buildnet only');
const LAUNCHPAD: string = JSON.parse(readFileSync(deploymentFile('buildnet'), 'utf8')).address;
const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);
const me = account.address.toString();
const stranger = (await Account.generate()).address.toString();
const DISCOUNT_BPS = 1_000;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function read(target: string, func: string, args = new Args(), coins?: bigint, caller = me) {
  const result = await provider.readSC({ target, func, parameter: args, caller, coins });
  if (result.info.error) throw new Error(result.info.error);
  return result.value;
}

async function refusal(func: string, args: Args, coins: bigint, caller = me): Promise<string> {
  return read(LAUNCHPAD, func, args, coins, caller).then(
    () => '',
    (err: Error) => contractReason(err.message),
  );
}

async function send(target: string, func: string, args: Args, coins: bigint) {
  await read(target, func, args, coins);
  const op: Operation = await provider.callSC({ target, func, parameter: args, coins });
  const status = await op.waitFinalExecution();
  const events = (await op.getFinalEvents()).map((e) => e.data);
  if (status !== OperationStatus.Success)
    throw new Error(`${func} failed: ${contractReason(events.at(-1) ?? '')}`);
  return events;
}

const discountFor = async (address: string) =>
  Number(
    new Args(await read(LAUNCHPAD, 'getHolderDiscount', new Args().addString(address))).nextU16(),
  );
const collectedFees = async () => new Args(await read(LAUNCHPAD, 'fees')).nextU64();
const setDiscount = (collection: string, bps: number) =>
  new Args().addString(collection).addU16(BigInt(bps));
const randomSymbol = (prefix: string) =>
  prefix +
  Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X');

async function templateBytes(kind: number): Promise<number> {
  const template = new Args(await read(LAUNCHPAD, 'template', new Args().addU8(BigInt(kind))));
  const version = Number(template.nextU32());
  const key = new Uint8Array([...new TextEncoder().encode('tpl:'), kind, 0, 0, 0, version]);
  const [code] = await provider.readStorage(LAUNCHPAD, [key], true);
  return code!.length;
}

const version = new TextDecoder().decode(await read(LAUNCHPAD, 'version'));
console.log(`Launchpad ${LAUNCHPAD} v${version}`);
if (version < '1.4.0') throw new Error('The holder discount needs Launchpad v1.4.0 or later');
const config = readConfig(new Args(await read(LAUNCHPAD, 'config')));

// ---- the pass collection, named by the admin ---------------------------------------------
await send(LAUNCHPAD, 'setHolderDiscount', setDiscount('', 0), ADMIN_COINS);
const passCost = launchCost(config.collectionFee, config.deployDeposit, await templateBytes(1));
const launched = await send(
  LAUNCHPAD,
  'createCollection',
  createCollectionArgs({
    ...EMPTY_COLLECTION_DRAFT,
    name: 'E2E Pass',
    symbol: randomSymbol('P'),
    maxSupply: '100',
    baseURI: 'ipfs://bafyE2EPass/',
  }),
  passCost.total,
);
const [, pass] = eventFields(launched, 'COLLECTION_CREATED') ?? [];
console.log(`Pass collection ${pass}`);

check(
  'someone else cannot set the discount',
  (await refusal('setHolderDiscount', setDiscount(pass, DISCOUNT_BPS), 0n, stranger)) ===
    'Caller is not the admin',
);
check(
  'a wallet is not a collection',
  (await refusal('setHolderDiscount', setDiscount(stranger, DISCOUNT_BPS), ADMIN_COINS)) ===
    'Not a standard MRC721 collection',
);
check(
  'above 50% is refused',
  (await refusal('setHolderDiscount', setDiscount(pass, 5_001), ADMIN_COINS)) ===
    'The discount must be 0.01-50%',
);
await send(LAUNCHPAD, 'setHolderDiscount', setDiscount(pass, DISCOUNT_BPS), ADMIN_COINS);
const program = readHolderDiscount(new Args(await read(LAUNCHPAD, 'holderDiscount')));
check('holderDiscount reads it back', program.collection === pass && program.bps === DISCOUNT_BPS);
check('no discount before holding an NFT', (await discountFor(me)) === 0);

await send(pass, 'ownerMint', new Args().addString(me).addU32(1n), nftStorage(1));
check('a holder gets 10%', (await discountFor(me)) === DISCOUNT_BPS);
check('someone else does not', (await discountFor(stranger)) === 0);

// ---- a holder's fees ------------------------------------------------------------------------
const tokenCost = launchCost(
  config.tokenFee,
  config.deployDeposit,
  await templateBytes(0),
  DISCOUNT_BPS,
);
let fees = await collectedFees();
const token = await send(
  LAUNCHPAD,
  'createToken',
  createTokenArgs({
    ...EMPTY_DRAFT,
    name: 'E2E Discount',
    symbol: randomSymbol('D'),
    supply: '1000',
  }),
  tokenCost.total,
);
check(
  'a token launch with the discounted cost goes through',
  !!eventFields(token, 'TOKEN_CREATED'),
);
check(
  'the token fee booked is 90%',
  (await collectedFees()) - fees === lessDiscount(config.tokenFee, DISCOUNT_BPS),
  `${Mas.toString((await collectedFees()) - fees)} MAS`,
);

const external = await SmartContract.deploy(
  provider,
  readFileSync('build/rc-token.wasm'),
  new Args()
    .addString('Discount Import')
    .addString(randomSymbol('I'))
    .addU8(6n)
    .addU256(10n ** 12n)
    .addString(me)
    .addBool(false)
    .addU256(0n)
    .addBool(false)
    .addBool(false),
  { coins: Mas.fromString('0.1'), waitFinalExecution: true },
);
fees = await collectedFees();
await send(
  LAUNCHPAD,
  'importToken',
  writeInfo(new Args().addString(external.address).addU8(0n), EMPTY_DRAFT.info),
  recordCost(lessDiscount(config.importFee, DISCOUNT_BPS)),
);
check(
  'the import fee booked is 90%',
  (await collectedFees()) - fees === lessDiscount(config.importFee, DISCOUNT_BPS),
);

await send(pass, 'approve', new Args().addString(LAUNCHPAD).addU256(1n), Mas.fromString('0.02'));
await send(
  LAUNCHPAD,
  'list',
  new Args().addString(pass).addU256(1n).addU64(Mas.fromString('5')).addU64(0n),
  Mas.fromString('0.1'),
);
const listingId = new Args(
  await read(LAUNCHPAD, 'listingOf', new Args().addString(pass).addU256(1n)),
).nextU64();
const listing = readListing(
  new Args(await read(LAUNCHPAD, 'getListing', new Args().addU64(listingId))),
);
check(
  'the listing keeps the discounted marketplace fee',
  listing.feeBps === lessDiscountBps(config.marketFeeBps, DISCOUNT_BPS),
  `${listing.feeBps} bps`,
);
await send(LAUNCHPAD, 'cancel', new Args().addU64(listingId), 0n);

// ---- the NFT leaves, the discount with it ----------------------------------------------------
await send(
  pass,
  'transferFrom',
  new Args().addString(me).addString(stranger).addU256(1n),
  Mas.fromString('0.03'),
);
check('a former holder (balance 0) gets nothing', (await discountFor(me)) === 0);
check('the new holder gets it', (await discountFor(stranger)) === DISCOUNT_BPS);
// A holder's 10% of a test fee hides in the storage margin, so the fee booked is what tells.
fees = await collectedFees();
await send(
  LAUNCHPAD,
  'createToken',
  createTokenArgs({ ...EMPTY_DRAFT, name: 'E2E Full', symbol: randomSymbol('F'), supply: '1' }),
  launchCost(config.tokenFee, config.deployDeposit, await templateBytes(0)).total,
);
check(
  'a former holder pays the full token fee',
  (await collectedFees()) - fees === config.tokenFee,
  `${Mas.toString((await collectedFees()) - fees)} MAS`,
);

await send(LAUNCHPAD, 'setHolderDiscount', setDiscount('', 0), ADMIN_COINS);
check('turned off', (await read(LAUNCHPAD, 'holderDiscount')).length === 0);
check('no discount while off', (await discountFor(stranger)) === 0);

// ---- left on for the app: PRIVATE_KEY holds #2 ------------------------------------------
await send(LAUNCHPAD, 'setHolderDiscount', setDiscount(pass, DISCOUNT_BPS), ADMIN_COINS);
await send(pass, 'ownerMint', new Args().addString(me).addU32(1n), nftStorage(1));
check('on again, PRIVATE_KEY holds #2', (await discountFor(me)) === DISCOUNT_BPS);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
