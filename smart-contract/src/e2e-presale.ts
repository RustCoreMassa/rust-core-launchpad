// End-to-end check of token presales on buildnet: create (escrow), contribute up to the hard
// cap, finalize early, claim, withdraw with the fee, and cancel before the start.
//   npx tsx src/e2e-presale.ts
// The owner is PRIVATE_KEY; a buyer is generated and funded from it (test MAS). Never on mainnet.
// The failure path needs the end to pass (≥ 1 hour) — the unit tests cover it.
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
import { createTokenArgs, EMPTY_DRAFT } from '../../src/app/features/create/token-draft';
import { launchCost } from '../../src/app/core/launchpad/launch-cost';
import {
  PRESALE_CANCELLED,
  PRESALE_SUCCESS,
  readConfig,
  readPresale,
  tokensFor,
} from '../../src/app/core/launchpad/records';
import { contractReason, eventFields } from '../../src/app/core/launchpad/events';

if (process.env['NETWORK'] === 'mainnet') throw new Error('e2e runs on buildnet only');
const LAUNCHPAD: string = JSON.parse(readFileSync('deployments/buildnet.json', 'utf8')).address;
const ownerAccount = await Account.fromEnv();
const owner = JsonRpcProvider.buildnet(ownerAccount);
const buyerAccount = await Account.generate();
const buyer = JsonRpcProvider.buildnet(buyerAccount);
const OWNER = ownerAccount.address.toString();
const BUYER = buyerAccount.address.toString();
const mas = (n: bigint) => `${n < 0n ? '-' : ''}${Mas.toString(n < 0n ? -n : n)} MAS`;
const DECIMALS = 9n;
const UNIT = 10n ** DECIMALS;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function read(target: string, func: string, args = new Args()) {
  const result = await owner.readSC({ target, func, parameter: args, caller: OWNER });
  if (result.info.error) throw new Error(result.info.error);
  return result.value;
}

async function send(who: JsonRpcProvider, target: string, func: string, args: Args, coins: bigint) {
  const sim = await who.readSC({ target, func, parameter: args, coins, caller: who.address });
  if (sim.info.error) throw new Error(`${func} simulation: ${contractReason(sim.info.error)}`);
  const op: Operation = await who.callSC({ target, func, parameter: args, coins });
  const status = await op.waitFinalExecution();
  const events = (await op.getFinalEvents()).map((e) => e.data);
  if (status !== OperationStatus.Success)
    throw new Error(`${func} failed: ${contractReason(events.at(-1) ?? '')}`);
  return events;
}

const tokenBalance = async (token: string, holder: string) =>
  new Args(await read(token, 'balanceOf', new Args().addString(holder))).nextU256();
const presale = async (id: bigint) =>
  readPresale(new Args(await read(LAUNCHPAD, 'getPresale', new Args().addU64(id))));
const fees = async () => new Args(await read(LAUNCHPAD, 'fees')).nextU64();

// ---- a token to sell: 1 000 000 units of 9 decimals ----------------------------------------
await (await owner.transfer(BUYER, Mas.fromString('20'))).waitFinalExecution();
const config = readConfig(new Args(await read(LAUNCHPAD, 'config')));
const [code] = await owner.readStorage(
  LAUNCHPAD,
  [new Uint8Array([...new TextEncoder().encode('tpl:'), 0, 0, 0, 0, 1])],
  true,
);
const symbol =
  'P' +
  Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X');
const launched = await send(
  owner,
  LAUNCHPAD,
  'createToken',
  createTokenArgs({
    ...EMPTY_DRAFT,
    name: 'Presale Token',
    symbol,
    decimals: 9,
    supply: '1000000',
  }),
  launchCost(config.tokenFee, config.deployDeposit, code!.length).total,
);
const [, token] = eventFields(launched, 'TOKEN_CREATED') ?? [];
console.log(`Token ${symbol} at ${token}; buyer ${BUYER}`);

// ---- presale: 1 000 tokens per MAS, soft cap 2 MAS, hard cap 5 MAS, 5 000 tokens -----------
const RATE = 1_000n * UNIT;
const FOR_SALE = 5_000n * UNIT;
const HARD_CAP = Mas.fromString('5');
// Starts at once: a past start means "now" in the contract.
const start = BigInt(Date.now());
const end = start + 3_600_000n + 300_000n;
await send(
  owner,
  token,
  'increaseAllowance',
  new Args().addString(LAUNCHPAD).addU256(FOR_SALE),
  Mas.fromString('0.02'),
);
const created = await send(
  owner,
  LAUNCHPAD,
  'createPresale',
  new Args()
    .addString(token)
    .addU256(FOR_SALE)
    .addU256(RATE)
    .addU64(Mas.fromString('2'))
    .addU64(HARD_CAP)
    .addU64(Mas.fromString('0.5'))
    .addU64(0n)
    .addU64(start)
    .addU64(end),
  Mas.fromString('0.2'),
);
const id = BigInt((eventFields(created, 'PRESALE_CREATED') ?? ['0'])[0]);
check(
  'created, tokens in escrow',
  (await tokenBalance(token, LAUNCHPAD)) === FOR_SALE,
  `presale ${id}`,
);
check(
  'owner balance down by the tokens for sale',
  (await tokenBalance(token, OWNER)) === 1_000_000n * UNIT - FOR_SALE,
);
try {
  await read(
    LAUNCHPAD,
    'createPresale',
    new Args()
      .addString(token)
      .addU256(1n)
      .addU256(RATE)
      .addU64(1n)
      .addU64(1n)
      .addU64(0n)
      .addU64(0n)
      .addU64(start)
      .addU64(end),
  );
  check('one open presale per token', false, 'the simulation passed');
} catch (err) {
  check(
    'one open presale per token',
    contractReason((err as Error).message) === 'This token already has an open presale',
  );
}

// ---- wait for the start, contribute up to the hard cap ---------------------------------------
const buyerBefore = await buyer.balance(true);
await send(
  buyer,
  LAUNCHPAD,
  'contribute',
  new Args().addU64(id).addU64(HARD_CAP),
  HARD_CAP + Mas.fromString('0.05'),
);
const paid = buyerBefore - (await buyer.balance(true));
check(
  'contribution kept, the rest refunded',
  paid > HARD_CAP && paid < HARD_CAP + Mas.fromString('0.05'),
  `paid ${mas(paid)}`,
);
check('raised = hard cap', (await presale(id)).raised === HARD_CAP);

// ---- finalize early (hard cap reached), claim, withdraw -------------------------------------
await send(buyer, LAUNCHPAD, 'finalize', new Args().addU64(id), Mas.fromString('0.05'));
check('finalized as a success', (await presale(id)).status === PRESALE_SUCCESS);
await send(buyer, LAUNCHPAD, 'claim', new Args().addU64(id), Mas.fromString('0.05'));
const claimed = await tokenBalance(token, BUYER);
check(
  'buyer claimed the tokens',
  claimed === tokensFor(HARD_CAP, RATE),
  `${claimed / UNIT} tokens`,
);
const feesBefore = await fees();
const ownerBefore = await owner.balance(true);
await send(owner, LAUNCHPAD, 'withdrawRaised', new Args().addU64(id), Mas.fromString('0.02'));
const fee = (await fees()) - feesBefore;
check('2 % presale fee', fee === (HARD_CAP * BigInt(config.presaleFeeBps)) / 10_000n, mas(fee));
const ownerGot = (await owner.balance(true)) - ownerBefore;
check('owner received the rest', ownerGot > HARD_CAP - fee - Mas.fromString('0.03'), mas(ownerGot));

// ---- a second presale, cancelled before its start: the tokens come back ---------------------
const later = BigInt(Date.now() + 3_600_000);
await send(
  owner,
  token,
  'increaseAllowance',
  new Args().addString(LAUNCHPAD).addU256(1_000n * UNIT),
  Mas.fromString('0.02'),
);
const second = await send(
  owner,
  LAUNCHPAD,
  'createPresale',
  new Args()
    .addString(token)
    .addU256(1_000n * UNIT)
    .addU256(RATE)
    .addU64(0n)
    .addU64(Mas.fromString('1'))
    .addU64(0n)
    .addU64(0n)
    .addU64(later)
    .addU64(later + 3_600_000n),
  Mas.fromString('0.2'),
);
const secondId = BigInt((eventFields(second, 'PRESALE_CREATED') ?? ['0'])[0]);
const ownerTokens = await tokenBalance(token, OWNER);
await send(owner, LAUNCHPAD, 'cancelPresale', new Args().addU64(secondId), Mas.fromString('0.05'));
check('cancelled', (await presale(secondId)).status === PRESALE_CANCELLED);
check(
  'tokens back to the owner',
  (await tokenBalance(token, OWNER)) === ownerTokens + 1_000n * UNIT,
);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
