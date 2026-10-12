// End-to-end check of the admin's removal of a project on buildnet (Launchpad v1.2.0+): a token
// launched with tokenomics and an imported token are removed; the registry, the pages, the
// symbol and the re-import are checked with the app's own reads and rules.
//   npx tsx src/e2e-removal.ts
// The admin is PRIVATE_KEY (≈ 7 test MAS a run). Never on mainnet.
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
import { createTokenArgs, EMPTY_DRAFT } from '../../src/app/features/create/token-draft';
import { launchCost, recordCost } from '../../src/app/core/launchpad/launch-cost';
import {
  KIND_TOKEN,
  readConfig,
  readProjectPage,
  writeInfo,
} from '../../src/app/core/launchpad/records';
import { newRow, tokenomicsCost } from '../../src/app/core/launchpad/tokenomics';
import { contractReason, eventFields } from '../../src/app/core/launchpad/events';
import { ADMIN_COINS } from '../../src/app/features/admin/admin-forms';
import { deploymentFile } from './utils';

if (process.env['NETWORK'] === 'mainnet') throw new Error('e2e runs on buildnet only');
const LAUNCHPAD: string = JSON.parse(readFileSync(deploymentFile('buildnet'), 'utf8')).address;
const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);
const me = account.address.toString();
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

async function refusal(func: string, args: Args, coins: bigint, caller = me): Promise<string> {
  return read(func, args, coins, caller).then(
    () => '',
    (err: Error) => contractReason(err.message),
  );
}

async function send(func: string, args: Args, coins: bigint) {
  const reason = await refusal(func, args, coins);
  if (reason) throw new Error(`${func} simulation: ${reason}`);
  const op: Operation = await provider.callSC({ target: LAUNCHPAD, func, parameter: args, coins });
  const status = await op.waitFinalExecution();
  const events = (await op.getFinalEvents()).map((e) => e.data);
  if (status !== OperationStatus.Success)
    throw new Error(`${func} failed: ${contractReason(events.at(-1) ?? '')}`);
  return events;
}

const removeArgs = (kind: number, id: bigint) => new Args().addU8(BigInt(kind)).addU64(id);
const isRemoved = async (address: string) =>
  (await read('isRemoved', new Args().addString(address)))[0] === 1;
const symbolFree = async (symbol: string) =>
  (await read('isSymbolAvailable', new Args().addString(symbol)))[0] === 1;
const tokenPage = async () =>
  readProjectPage(
    await read('getProjects', new Args().addU8(BigInt(KIND_TOKEN)).addU64(0n).addU32(50n)),
  );

const version = new TextDecoder().decode(await read('version'));
console.log(`Launchpad ${LAUNCHPAD} v${version}`);
if (version < '1.2.0') throw new Error('Removal needs Launchpad v1.2.0 or later');
const config = readConfig(new Args(await read('config')));

// ---- a launched token, with tokenomics -----------------------------------------------------
const symbol =
  'RMV' +
  Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X');
const draft = {
  ...EMPTY_DRAFT,
  name: 'E2E Removal',
  symbol,
  supply: '1000',
  allocations: [newRow({ purpose: 'All', percent: '100' })],
};
const template = new Args(await read('template', new Args().addU8(0n)));
const templateVersion = Number(template.nextU32());
const codeKey = new Uint8Array([...new TextEncoder().encode('tpl:'), 0, 0, 0, 0, templateVersion]);
const [templateCode] = await provider.readStorage(LAUNCHPAD, [codeKey], true);
const parts = [{ purpose: 'All', amount: 1000n * 10n ** 18n, description: '', holder: '' }];
const coins =
  launchCost(config.tokenFee, config.deployDeposit, templateCode!.length).total +
  tokenomicsCost(parts);
const launched = await send('createToken', createTokenArgs(draft), coins);
const [id, address] = eventFields(launched, 'TOKEN_CREATED') ?? [];
const tokenId = BigInt(id);
console.log(`Launched ${symbol} (#${id}) at ${address}`);
check('the symbol is taken', !(await symbolFree(symbol)));

check(
  'someone else cannot remove it',
  (await refusal(
    'removeProject',
    removeArgs(KIND_TOKEN, tokenId),
    0n,
    stranger.address.toString(),
  )) === 'Caller is not the admin',
);
const events = await send('removeProject', removeArgs(KIND_TOKEN, tokenId), ADMIN_COINS);
check('PROJECT_REMOVED event', !!eventFields(events, 'PROJECT_REMOVED'));
check('marked as removed', await isRemoved(address));
check(
  'not in the registry any more',
  (await refusal('getProjectByAddress', new Args().addString(address), 0n)) ===
    'Not in the Launchpad',
);
const after = await tokenPage();
check(
  'the list skips it, the count stays',
  !after.projects.some((p) => p.address === address) && after.total >= tokenId,
  `${after.projects.length} of ${after.total} ids`,
);
check('its symbol is free again', await symbolFree(symbol));
check(
  'its tokenomics are gone',
  (await read('getTokenomics', new Args().addU64(tokenId))).length === 0,
);
check(
  'removing it again is refused',
  (await refusal('removeProject', removeArgs(KIND_TOKEN, tokenId), ADMIN_COINS)) ===
    'Unknown project',
);

// ---- an imported token: it can never come back ------------------------------------------
const external = await SmartContract.deploy(
  provider,
  readFileSync('build/rc-token.wasm'),
  new Args()
    .addString('Removed Import')
    .addString('RIMP')
    .addU8(6n)
    .addU256(10n ** 12n)
    .addString(me)
    .addBool(false)
    .addU256(0n)
    .addBool(false)
    .addBool(false),
  { coins: Mas.fromString('0.1'), waitFinalExecution: true },
);
const importArgs = writeInfo(new Args().addString(external.address).addU8(0n), EMPTY_DRAFT.info);
const imported = await send('importToken', importArgs, recordCost(config.importFee));
const [importedId] = eventFields(imported, 'TOKEN_IMPORTED') ?? [];
await send('removeProject', removeArgs(KIND_TOKEN, BigInt(importedId)), ADMIN_COINS);
check(
  'the owner cannot import it again',
  (await refusal('importToken', importArgs, recordCost(config.importFee))) ===
    'This contract was removed from the Launchpad',
);
check(
  'its contract keeps working (the Launchpad has no power over it)',
  new TextDecoder().decode(
    (
      await provider.readSC({
        target: external.address,
        func: 'ownerAddress',
        parameter: new Args(),
      })
    ).value,
  ) === me,
);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
