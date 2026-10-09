// End-to-end check of declared tokenomics on buildnet (Launchpad v1.1.0+), with the app's own
// encoding, rules and cost code: a launch with tokenomics, an edit, the refusals (parts that miss
// the supply, a caller who isn't the owner, a token id that isn't in the Launchpad) and the
// removal, which frees storage.
//   npx tsx src/e2e-tokenomics.ts
// Sends real (test) transactions from PRIVATE_KEY (≈ 5 test MAS a run). Never on mainnet.
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
  createTokenArgs,
  EMPTY_DRAFT,
  tokenomicsBase,
} from '../../src/app/features/create/token-draft';
import { launchCost } from '../../src/app/core/launchpad/launch-cost';
import {
  Allocation,
  readConfig,
  readProject,
  readTokenomics,
  writeAllocations,
} from '../../src/app/core/launchpad/records';
import {
  allocationsError,
  newRow,
  rowsToAllocations,
  tokenomicsCost,
} from '../../src/app/core/launchpad/tokenomics';
import { contractReason, eventFields } from '../../src/app/core/launchpad/events';
import { deploymentFile } from './utils';

if (process.env['NETWORK'] === 'mainnet') throw new Error('e2e runs on buildnet only');
const LAUNCHPAD: string = JSON.parse(readFileSync(deploymentFile('buildnet'), 'utf8')).address;
const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);
const me = account.address.toString();
const fee = await provider.client.getMinimalFee();
const stranger = await Account.generate();

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function read(func: string, args = new Args(), coins?: bigint, caller = me) {
  const result = await provider.readSC({ target: LAUNCHPAD, func, parameter: args, caller, coins });
  if (result.info.error) throw new Error(result.info.error);
  return result.value;
}

/** The contract's reason when `caller` would make the call, or '' when it would go through. */
async function refusal(func: string, args: Args, coins: bigint, caller = me): Promise<string> {
  return read(func, args, coins, caller).then(
    () => '',
    (err: Error) => contractReason(err.message),
  );
}

/** Simulates, sends, waits for finality; returns the events and the MAS it consumed. */
async function send(func: string, args: Args, coins: bigint) {
  const reason = await refusal(func, args, coins);
  if (reason) throw new Error(`${func} simulation: ${reason}`);
  const before = await provider.balance(true);
  const op: Operation = await provider.callSC({ target: LAUNCHPAD, func, parameter: args, coins });
  const status = await op.waitFinalExecution();
  const events = (await op.getFinalEvents()).map((e) => e.data);
  if (status !== OperationStatus.Success)
    throw new Error(`${func} failed: ${contractReason(events.at(-1) ?? '')}`);
  return { events, consumed: before - (await provider.balance(true)) - fee };
}

const mas = (n: bigint) => `${n < 0n ? '-' : ''}${Mas.toString(n < 0n ? -n : n)} MAS`;
const tokenomicsOf = async (id: bigint) => {
  const bytes = await read('getTokenomics', new Args().addU64(id));
  return bytes.length ? readTokenomics(new Args(bytes)) : null;
};
const setArgs = (id: bigint, parts: Allocation[]) => writeAllocations(new Args().addU64(id), parts);

const version = new TextDecoder().decode(await read('version'));
console.log(`Launchpad ${LAUNCHPAD} v${version}`);
if (version < '1.1.0') throw new Error('Tokenomics need Launchpad v1.1.0 or later');
const config = readConfig(new Args(await read('config')));

// ---- launch with tokenomics ----------------------------------------------------------------
const symbol =
  'TKM' +
  Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X');
const draft = {
  ...EMPTY_DRAFT,
  name: 'E2E Tokenomics',
  symbol,
  decimals: 6,
  supply: '1000',
  mintable: true,
  maxSupply: '3000',
  category: 4,
  allocations: [
    newRow({ purpose: 'Team', percent: '33.33', description: '12 months cliff', holder: me }),
    newRow({ purpose: 'Liquidity', amount: '999.9', source: 'amount' as const }),
    newRow({ purpose: 'Community', percent: '33.34' }),
  ],
};
const declared = rowsToAllocations(draft.allocations, tokenomicsBase(draft), draft.decimals)!;
check('the app accepts the split', allocationsError(declared, 3000n * 10n ** 6n) === null);

const template = new Args(await read('template', new Args().addU8(0n)));
const templateVersion = Number(template.nextU32());
const codeKey = new Uint8Array([...new TextEncoder().encode('tpl:'), 0, 0, 0, 0, templateVersion]);
const [templateCode] = await provider.readStorage(LAUNCHPAD, [codeKey], true);
const cost = launchCost(config.tokenFee, config.deployDeposit, templateCode!.length);
const launchCoins = cost.total + tokenomicsCost(declared);

const short = createTokenArgs({
  ...draft,
  allocations: [newRow({ purpose: 'Only part', amount: '1000', source: 'amount' })],
});
check(
  'a split of the initial supply of a mintable token is refused',
  (await refusal('createToken', short, launchCoins)) ===
    'The parts must add up to the whole supply',
);

console.log(`Launching ${symbol} with 3 parts, sending ${mas(launchCoins)}`);
const launch = await send('createToken', createTokenArgs(draft), launchCoins);
const [id, address] = eventFields(launch.events, 'TOKEN_CREATED') ?? [];
const tokenId = BigInt(id);
check(
  'TOKEN_CREATED and TOKENOMICS_UPDATED',
  !!address && !!eventFields(launch.events, 'TOKENOMICS_UPDATED'),
);
let t = await tokenomicsOf(tokenId);
check(
  'tokenomics stored with the launch',
  JSON.stringify(t?.allocations, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) ===
    JSON.stringify(declared, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
  `consumed ${mas(launch.consumed)}`,
);

// ---- edit, refusals ------------------------------------------------------------------------
const fair: Allocation[] = [
  { purpose: 'Public sale', amount: 2400n * 10n ** 6n, description: '', holder: '' },
  { purpose: 'Liquidity', amount: 600n * 10n ** 6n, description: 'Locked 1 year', holder: '' },
];
const editCoins = tokenomicsCost(fair);
/** Checks that the simulation is refused with exactly this reason (shown when it isn't). */
async function refused(label: string, reason: Promise<string>, expected: string) {
  const got = await reason;
  check(label, got === expected, got === expected ? '' : `got "${got}"`);
}
// The stranger is a fresh account without MAS: its simulation sends no coins.
await refused(
  'a caller who is not the owner is refused',
  refusal('setTokenomics', setArgs(tokenId, fair), 0n, stranger.address.toString()),
  'Only the contract owner can do this',
);
await refused(
  'a token id that is not in the Launchpad is refused',
  refusal('setTokenomics', setArgs(10n ** 12n, fair), editCoins),
  'Unknown project',
);
await refused(
  'parts above the supply are refused',
  refusal('setTokenomics', setArgs(tokenId, [...fair, { ...fair[1], amount: 1n }]), editCoins),
  'The parts add up to more than the supply',
);
const edit = await send('setTokenomics', setArgs(tokenId, fair), editCoins);
t = await tokenomicsOf(tokenId);
check(
  'edit replaces the whole list',
  t?.allocations.length === 2 && t.allocations[1].description === 'Locked 1 year',
  `consumed ${mas(edit.consumed)} (sent ${mas(editCoins)})`,
);

// ---- removal -------------------------------------------------------------------------------
const removal = await send('setTokenomics', setArgs(tokenId, []), tokenomicsCost([]));
check('an empty list removes it', (await tokenomicsOf(tokenId)) === null);
check(
  'removal frees storage (refunded)',
  removal.consumed < 0n,
  `consumed ${mas(removal.consumed)}`,
);
check(
  'removing again is refused',
  (await refusal('setTokenomics', setArgs(tokenId, []), tokenomicsCost([]))) ===
    'This token has no tokenomics',
);
const project = readProject(
  new Args(await read('getProject', new Args().addU8(0n).addU64(tokenId))),
);
check('the Project record is unchanged', project.symbol === symbol && project.address === address);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
