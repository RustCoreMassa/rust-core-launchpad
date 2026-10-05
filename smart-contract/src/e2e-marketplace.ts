// End-to-end check of the marketplace on buildnet: list, buy with royalty, cancel, stale cleanup.
//   npx tsx src/e2e-marketplace.ts
// The seller is PRIVATE_KEY; a buyer and a royalty receiver are generated and funded from it
// (test MAS). Never on mainnet.
import 'dotenv/config';
import { readFileSync } from 'fs';
import {
  Account,
  Args,
  JsonRpcProvider,
  Mas,
  Operation,
  OperationStatus,
} from '@massalabs/massa-web3';
import {
  createCollectionArgs,
  EMPTY_COLLECTION_DRAFT,
} from '../../src/app/features/create/collection-draft';
import { launchCost } from '../../src/app/core/launchpad/launch-cost';
import { nftStorage } from '../../src/app/core/launchpad/mint-cost';
import { readConfig, readListing } from '../../src/app/core/launchpad/records';
import { saleSplit } from '../../src/app/core/launchpad/market-cost';
import { contractReason, eventFields } from '../../src/app/core/launchpad/events';

if (process.env['NETWORK'] === 'mainnet') throw new Error('e2e runs on buildnet only');
const LAUNCHPAD: string = JSON.parse(readFileSync('deployments/buildnet.json', 'utf8')).address;
const sellerAccount = await Account.fromEnv();
const seller = JsonRpcProvider.buildnet(sellerAccount);
const buyerAccount = await Account.generate();
const buyer = JsonRpcProvider.buildnet(buyerAccount);
const receiver = (await Account.generate()).address.toString();
const SELLER = sellerAccount.address.toString();
const BUYER = buyerAccount.address.toString();
const fee = await seller.client.getMinimalFee();
const mas = (n: bigint) => `${n < 0n ? '-' : ''}${Mas.toString(n < 0n ? -n : n)} MAS`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function read(target: string, func: string, args = new Args(), caller = SELLER) {
  const result = await seller.readSC({ target, func, parameter: args, caller });
  if (result.info.error) throw new Error(result.info.error);
  return result.value;
}

async function send(who: JsonRpcProvider, target: string, func: string, args: Args, coins: bigint) {
  const result = await who.readSC({ target, func, parameter: args, coins, caller: who.address });
  if (result.info.error)
    throw new Error(`${func} simulation: ${contractReason(result.info.error)}`);
  const op: Operation = await who.callSC({ target, func, parameter: args, coins });
  const status = await op.waitFinalExecution();
  const events = (await op.getFinalEvents()).map((e) => e.data);
  if (status !== OperationStatus.Success)
    throw new Error(`${func} failed: ${contractReason(events.at(-1) ?? '')}`);
  return events;
}

const balanceOf = async (address: string) => (await seller.balanceOf([address], true))[0].balance;
const ownerOf = async (collection: string, id: bigint) =>
  new TextDecoder().decode(await read(collection, 'ownerOf', new Args().addU256(id)));
const listingOf = async (collection: string, id: bigint) =>
  new Args(
    await read(LAUNCHPAD, 'listingOf', new Args().addString(collection).addU256(id)),
  ).nextU64();
const problem = async (listing: bigint, who: string) =>
  new TextDecoder().decode(
    await read(LAUNCHPAD, 'buyProblem', new Args().addU64(listing).addString(who)),
  );

// ---- set up: fund the buyer, launch a collection with a 5% royalty to `receiver` ------------
const funding = await seller.transfer(BUYER, Mas.fromString('30'));
await funding.waitFinalExecution();
console.log(`Buyer ${BUYER} funded with 30 MAS; royalty receiver ${receiver}`);

const config = readConfig(new Args(await read(LAUNCHPAD, 'config')));
const tpl = new Args(await read(LAUNCHPAD, 'template', new Args().addU8(1n)));
const version = Number(tpl.nextU32());
const [code] = await seller.readStorage(
  LAUNCHPAD,
  [new Uint8Array([...new TextEncoder().encode('tpl:'), 1, 0, 0, 0, version])],
  true,
);
const symbol =
  'M' +
  Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X');
const launched = await send(
  seller,
  LAUNCHPAD,
  'createCollection',
  createCollectionArgs({
    ...EMPTY_COLLECTION_DRAFT,
    name: 'Market Cats',
    symbol,
    maxSupply: '10',
    baseURI: 'ipfs://bafyMarket/',
    royalty: '5',
    royaltyReceiver: receiver,
  }),
  launchCost(config.collectionFee, config.deployDeposit, code!.length).total,
);
const [collectionId, collection] = eventFields(launched, 'COLLECTION_CREATED') ?? [];
await send(seller, collection, 'ownerMint', new Args().addString(SELLER).addU32(2n), nftStorage(2));
console.log(`Collection ${collection}, NFTs #1 and #2 minted to the seller`);

// ---- list #1 at 5 MAS -----------------------------------------------------------------------
const PRICE = Mas.fromString('5');
await send(
  seller,
  collection,
  'approve',
  new Args().addString(LAUNCHPAD).addU256(1n),
  Mas.fromString('0.02'),
);
await send(
  seller,
  LAUNCHPAD,
  'list',
  new Args().addString(collection).addU256(1n).addU64(PRICE).addU64(0n),
  Mas.fromString('0.1'),
);
const listing = await listingOf(collection, 1n);
check('listed', listing > 0n, `listing ${listing}`);
check(
  'seller cannot buy their own',
  (await problem(listing, SELLER)) === 'This is your own listing',
);
check('buyer can buy', (await problem(listing, BUYER)) === '');

// ---- buy -------------------------------------------------------------------------------------
const sellerBefore = await balanceOf(SELLER);
const receiverBefore = await balanceOf(receiver).catch(() => 0n);
const buyerBefore = await buyer.balance(true);
const coins = PRICE + Mas.fromString('0.15');
// A buyer who saw an older price: refused, whatever coins they send.
const stale = await buyer.readSC({
  target: LAUNCHPAD,
  func: 'buy',
  parameter: new Args().addU64(listing).addU64(PRICE - 1n),
  coins: coins * 2n,
  caller: buyer.address,
});
check(
  'a buy at another price than listed is refused',
  contractReason(stale.info.error ?? '') === 'The price changed, check it again',
  stale.info.error ?? 'no error',
);
const listed = readListing(new Args(await read(LAUNCHPAD, 'getListing', new Args().addU64(listing))));
check(
  'the listing keeps the marketplace fee in force',
  listed.feeBps === config.marketFeeBps,
  `${listed.feeBps / 100}%`,
);
const feesBefore = new Args(await read(LAUNCHPAD, 'fees')).nextU64();
const sold = await send(buyer, LAUNCHPAD, 'buy', new Args().addU64(listing).addU64(PRICE), coins);
check('SOLD event', eventFields(sold, 'SOLD') !== null);
check('the NFT moved to the buyer', (await ownerOf(collection, 1n)) === BUYER);
const { royalty, fee: marketFee } = saleSplit(PRICE, 500, listed.feeBps);
const feesGot = new Args(await read(LAUNCHPAD, 'fees')).nextU64() - feesBefore;
check('marketplace fee collected by the Launchpad', feesGot === marketFee, mas(feesGot));
const receiverGot = (await balanceOf(receiver)) - receiverBefore;
// A first payment to a brand-new address pays its ledger entry (10 bytes = 0.001 MAS).
const newAccountCost = receiverBefore === 0n ? Mas.fromString('0.001') : 0n;
check(
  'royalty paid (minus the new account’s ledger entry)',
  receiverGot === royalty - newAccountCost,
  mas(receiverGot),
);
const sellerGot = (await balanceOf(SELLER)) - sellerBefore;
check(
  'seller paid price − royalty − fee (+ the listing’s storage back)',
  sellerGot >= PRICE - royalty - marketFee &&
    sellerGot < PRICE - royalty - marketFee + Mas.fromString('0.1'),
  mas(sellerGot),
);
const buyerPaid = buyerBefore - (await buyer.balance(true)) - fee;
check(
  'buyer paid the price + storage, the rest refunded',
  buyerPaid > PRICE && buyerPaid < coins,
  mas(buyerPaid),
);
const stats = new Args(await read(LAUNCHPAD, 'getStats', new Args().addU64(BigInt(collectionId))));
const [volume, sales] = [stats.nextU64(), stats.nextU64()];
check('stats', volume >= PRICE && sales >= 1n, `volume ${mas(volume)}, ${sales} sale(s)`);
check('listing gone', (await listingOf(collection, 1n)) === 0n);

// ---- cancel by the seller ----------------------------------------------------------------------
await send(
  seller,
  collection,
  'approve',
  new Args().addString(LAUNCHPAD).addU256(2n),
  Mas.fromString('0.02'),
);
await send(
  seller,
  LAUNCHPAD,
  'list',
  new Args().addString(collection).addU256(2n).addU64(PRICE).addU64(0n),
  Mas.fromString('0.1'),
);
let second = await listingOf(collection, 2n);
await send(seller, LAUNCHPAD, 'cancel', new Args().addU64(second), 0n);
check('seller cancels', (await listingOf(collection, 2n)) === 0n);

// ---- a stale listing, cleaned up by someone else -------------------------------------------
await send(
  seller,
  LAUNCHPAD,
  'list',
  new Args().addString(collection).addU256(2n).addU64(PRICE).addU64(0n),
  Mas.fromString('0.1'),
);
second = await listingOf(collection, 2n);
await send(
  seller,
  collection,
  'transferFrom',
  new Args().addString(SELLER).addString(BUYER).addU256(2n),
  Mas.fromString('0.03'),
);
check(
  'listing became stale',
  (await problem(second, receiver)) === 'The seller no longer owns this NFT',
);
const sellerBeforeCleanup = await balanceOf(SELLER);
await send(buyer, LAUNCHPAD, 'cancel', new Args().addU64(second), 0n);
const refunded = (await balanceOf(SELLER)) - sellerBeforeCleanup;
check(
  'anyone cleans it up; the storage goes back to the seller',
  (await listingOf(collection, 2n)) === 0n && refunded > 0n,
  mas(refunded),
);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
