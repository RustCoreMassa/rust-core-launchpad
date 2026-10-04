// End-to-end check on buildnet, with the app's own encoding and cost code:
//   npx tsx src/e2e.ts
// Sends real (test) transactions from PRIVATE_KEY: launch, edit, mint, import. Never on mainnet.
import 'dotenv/config';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import {
  Account,
  Args,
  ArrayTypes,
  JsonRpcProvider,
  Mas,
  Operation,
  OperationStatus,
  SmartContract,
  StorageCost,
} from '@massalabs/massa-web3';
import { createTokenArgs, EMPTY_DRAFT } from '../../src/app/features/create/token-draft';
import { launchCost, recordCost } from '../../src/app/core/launchpad/launch-cost';
import {
  KIND_TOKEN,
  SOURCE_IMPORTED,
  hex,
  readConfig,
  readProject,
  readProjectPage,
  writeInfo,
} from '../../src/app/core/launchpad/records';
import { contractReason, eventFields } from '../../src/app/core/launchpad/events';

if (process.env['NETWORK'] === 'mainnet') throw new Error('e2e runs on buildnet only');
const deployment = JSON.parse(readFileSync('deployments/buildnet.json', 'utf8'));
const LAUNCHPAD: string = deployment.address;
const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);
const me = account.address.toString();
const fee = await provider.client.getMinimalFee();

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

/** Simulates, sends, waits for finality; returns the events and the MAS it consumed. */
async function send(target: string, func: string, args: Args, coins: bigint) {
  await read(target, func, args, coins); // what the app does before asking for a signature
  const before = await provider.balance(true);
  const op: Operation = await provider.callSC({ target, func, parameter: args, coins });
  const status = await op.waitFinalExecution();
  const events = (await op.getFinalEvents()).map((e) => e.data);
  if (status !== OperationStatus.Success)
    throw new Error(`${func} failed: ${contractReason(events.at(-1) ?? '')}`);
  const after = await provider.balance(true);
  return { events, consumed: before - after - fee };
}

const mas = (n: bigint) => `${n < 0n ? '-' : ''}${Mas.toString(n < 0n ? -n : n)} MAS`;

// ---- reads -------------------------------------------------------------------------------
const config = readConfig(new Args(await read(LAUNCHPAD, 'config')));
const template = new Args(await read(LAUNCHPAD, 'template', new Args().addU8(0n)));
const templateVersion = Number(template.nextU32());
const templateHash = hex(template.nextUint8Array());
console.log(
  `Launchpad ${LAUNCHPAD}, token fee ${mas(config.tokenFee)}, template v${templateVersion}`,
);

// ---- a refused launch: the app shows the contract's own reason ------------------------------
const reserved = createTokenArgs({
  ...EMPTY_DRAFT,
  name: 'Fake Coin',
  symbol: 'USDC',
  supply: '1',
});
try {
  await read(LAUNCHPAD, 'createToken', reserved, 10_000_000_000n);
  check('reserved symbol refused', false, 'the simulation passed');
} catch (err) {
  const raw = (err as Error).message;
  const reason = contractReason(raw);
  check(
    'reserved symbol refused, reason extracted',
    reason === 'This symbol is already taken or reserved',
    `"${reason}" from: ${raw.slice(0, 160)}…`,
  );
}

// ---- launch ------------------------------------------------------------------------------
const symbol =
  'E2E' +
  Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X');
const draft = {
  ...EMPTY_DRAFT,
  name: 'E2E Test Token',
  symbol,
  decimals: 9,
  supply: '1000',
  mintable: true,
  maxSupply: '5000',
  burnable: true,
  category: 1,
  info: {
    ...EMPTY_DRAFT.info,
    description: 'Buildnet test — țară',
    website: 'https://rustcore.example',
  },
};
const codeKey = new Uint8Array([...new TextEncoder().encode('tpl:'), 0, 0, 0, 0, templateVersion]);
const [templateCode] = await provider.readStorage(LAUNCHPAD, [codeKey], true);
check(
  'template code readable for "Download original code"',
  !!templateCode && createHash('sha256').update(templateCode!).digest('hex') === templateHash,
);
const cost = launchCost(config.tokenFee, config.deployDeposit, templateCode!.length);
console.log(
  `Launching ${symbol}: sending ${mas(cost.total)} (fee ${mas(cost.fee)}, code ${mas(cost.contract)}, deposit ${mas(cost.deposit)}, margin ${mas(cost.margin)})`,
);
const launch = await send(LAUNCHPAD, 'createToken', createTokenArgs(draft), cost.total);
const [id, tokenAddress] = eventFields(launch.events, 'TOKEN_CREATED') ?? [];
check('TOKEN_CREATED event', !!id && !!tokenAddress, `id ${id}, ${tokenAddress}`);
check(
  'excess refunded (consumed < sent)',
  launch.consumed < cost.total,
  `consumed ${mas(launch.consumed)} of ${mas(cost.total)}, refunded ${mas(cost.total - launch.consumed)}`,
);

const project = readProject(
  new Args(await read(LAUNCHPAD, 'getProjectByAddress', new Args().addString(tokenAddress))),
);
check(
  'record',
  project.symbol === symbol &&
    project.creator === me &&
    project.info.description === draft.info.description,
);
const supply = new Args(await read(tokenAddress, 'totalSupply')).nextU256();
check(
  'supply went to the creator',
  supply === 1000n * 10n ** 9n &&
    new Args(await read(tokenAddress, 'balanceOf', new Args().addString(me))).nextU256() === supply,
);
check(
  'creator is the owner',
  new TextDecoder().decode(await read(tokenAddress, 'ownerAddress')) === me,
);
const code = await provider.client.getAddressesBytecode({ address: tokenAddress, is_final: true });
check(
  'bytecode = original (codeHash)',
  createHash('sha256').update(code).digest('hex') === hex(project.codeHash),
);

// ---- edit --------------------------------------------------------------------------------
const edit = await send(
  LAUNCHPAD,
  'updateInfo',
  writeInfo(new Args().addU8(BigInt(KIND_TOKEN)).addU64(project.id).addU8(3n), {
    ...draft.info,
    website: 'https://new.example',
  }),
  recordCost(0n),
);
const edited = readProject(
  new Args(await read(LAUNCHPAD, 'getProject', new Args().addU8(0n).addU64(project.id))),
);
check(
  'edit saved',
  edited.info.website === 'https://new.example' && edited.category === 3,
  `consumed ${mas(edit.consumed)}`,
);

// ---- mint ---------------------------------------------------------------------------------
const mintCoins = await StorageCost.MRC20BalanceCreationCost(provider, tokenAddress, me);
await send(tokenAddress, 'mint', new Args().addString(me).addU256(500n * 10n ** 9n), mintCoins);
check('mint', new Args(await read(tokenAddress, 'totalSupply')).nextU256() === 1500n * 10n ** 9n);

// ---- import -------------------------------------------------------------------------------
const external = await SmartContract.deploy(
  provider,
  readFileSync('build/rc-token.wasm'),
  new Args()
    .addString('External Token')
    .addString('EXT')
    .addU8(6n)
    .addU256(10n ** 12n)
    .addString(me)
    .addBool(false)
    .addU256(0n)
    .addBool(false)
    .addBool(false),
  { coins: Mas.fromString('0.1'), waitFinalExecution: true },
);
const imported = await send(
  LAUNCHPAD,
  'importToken',
  writeInfo(new Args().addString(external.address).addU8(4n), draft.info),
  recordCost(config.importFee),
);
const [importedId] = eventFields(imported.events, 'TOKEN_IMPORTED') ?? [];
const importedProject = readProject(
  new Args(await read(LAUNCHPAD, 'getProject', new Args().addU8(0n).addU64(BigInt(importedId)))),
);
check(
  'import',
  importedProject.source === SOURCE_IMPORTED && importedProject.symbol === 'EXT',
  `consumed ${mas(imported.consumed)}`,
);

// ---- lists --------------------------------------------------------------------------------
const page = readProjectPage(
  await read(LAUNCHPAD, 'getProjects', new Args().addU8(0n).addU64(0n).addU32(50n)),
);
check(
  'newest first in getProjects',
  page.projects[0]?.address === external.address,
  `${page.total} tokens`,
);
const mine = new Args(
  await read(LAUNCHPAD, 'getCreatedBy', new Args().addString(me).addU8(0n)),
).nextArray<bigint>(ArrayTypes.U64);
check('getCreatedBy lists both', mine.includes(project.id) && mine.includes(BigInt(importedId)));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
