// End-to-end check of the admin tools on buildnet, with the admin page's own code (admin-forms):
// fees and their cap, pause, verified / hidden, reserved symbols, fee withdrawal, the two-step
// admin handover and the upgrade timelock. Leaves the Launchpad as it found it.
//   npx tsx src/e2e-admin.ts
// The admin is PRIVATE_KEY; a second account is generated and funded from it (test MAS).
import 'dotenv/config';
import { createHash } from 'crypto';
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
  ADMIN_COINS,
  configFromForm,
  feeFormOf,
} from '../../src/app/features/admin/admin-forms';
import { contractReason } from '../../src/app/core/launchpad/events';
import {
  KIND_TOKEN,
  readConfig,
  readProject,
  readUpgradeProposal,
  writeConfig,
} from '../../src/app/core/launchpad/records';
import { getScByteCode } from './utils';

if (process.env['NETWORK'] === 'mainnet') throw new Error('e2e runs on buildnet only');
const LAUNCHPAD: string = JSON.parse(readFileSync('deployments/buildnet.json', 'utf8')).address;
const adminAccount = await Account.fromEnv();
const admin = JsonRpcProvider.buildnet(adminAccount);
const otherAccount = await Account.generate();
const other = JsonRpcProvider.buildnet(otherAccount);
const ADMIN = adminAccount.address.toString();
const OTHER = otherAccount.address.toString();

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function read(func: string, args = new Args()): Promise<Uint8Array> {
  const result = await admin.readSC({ target: LAUNCHPAD, func, parameter: args, caller: ADMIN });
  if (result.info.error) throw new Error(result.info.error);
  return result.value;
}

/** The contract's reason when `who` would call `func`, or '' when it would go through. */
async function refusal(who: JsonRpcProvider, func: string, args: Args, coins = ADMIN_COINS) {
  const result = await who.readSC({
    target: LAUNCHPAD,
    func,
    parameter: args,
    coins,
    caller: who.address,
  });
  return result.info.error ? contractReason(result.info.error) : '';
}

async function send(who: JsonRpcProvider, func: string, args: Args, coins = ADMIN_COINS) {
  const reason = await refusal(who, func, args, coins);
  if (reason) throw new Error(`${func} simulation: ${reason}`);
  const op: Operation = await who.callSC({ target: LAUNCHPAD, func, parameter: args, coins });
  const status = await op.waitFinalExecution();
  if (status !== OperationStatus.Success) {
    const events = (await op.getFinalEvents()).map((e) => e.data);
    throw new Error(`${func} failed: ${contractReason(events.at(-1) ?? '')}`);
  }
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const config = async () => readConfig(new Args(await read('config')));
const fees = async () => new Args(await read('fees')).nextU64();
const symbolEntry = async (symbol: string) =>
  (await admin.readStorage(LAUNCHPAD, [new TextEncoder().encode(`s:${symbol}:`)], true))[0];

const funding = await admin.transfer(OTHER, Mas.fromString('3'));
await funding.waitFinalExecution();
console.log(`Second account ${OTHER} funded with 3 MAS`);

// ---- fees, through the admin page's form ----------------------------------------------------
const original = await config();
const form = { ...feeFormOf(original), presaleFee: '3' };
const parsed = configFromForm(form, original.paused);
if ('errors' in parsed) throw new Error(JSON.stringify(parsed.errors));
await send(admin, 'setConfig', writeConfig(new Args(), parsed.config));
check('fees saved from the form', (await config()).presaleFeeBps === 300);
check(
  'a presale fee above 10% is refused',
  (await refusal(
    admin,
    'setConfig',
    writeConfig(new Args(), { ...original, presaleFeeBps: 1_050 }),
  )) === 'The presale fee must be at most 10%',
);
check(
  'a marketplace fee above 5% is refused',
  (await refusal(
    admin,
    'setConfig',
    writeConfig(new Args(), { ...original, marketFeeBps: 501 }),
  )) === 'The marketplace fee must be at most 5%',
);
check(
  'another wallet is refused',
  (await refusal(other, 'setPaused', new Args().addBool(true))) === 'Caller is not the admin',
);
await send(admin, 'setConfig', writeConfig(new Args(), original));
check('fees restored', (await config()).presaleFeeBps === original.presaleFeeBps);

// ---- pause ----------------------------------------------------------------------------------
await send(admin, 'setPaused', new Args().addBool(true));
check('paused', (await config()).paused);
await send(admin, 'setPaused', new Args().addBool(false));
check('resumed', !(await config()).paused);

// ---- verified / hidden ----------------------------------------------------------------------
const tokenCount = new Args(await read('count', new Args().addU8(BigInt(KIND_TOKEN)))).nextU64();
if (tokenCount > 0n) {
  const project = async () =>
    readProject(
      new Args(await read('getProject', new Args().addU8(BigInt(KIND_TOKEN)).addU64(1n))),
    );
  const flag = (func: string, value: boolean) =>
    send(admin, func, new Args().addU8(BigInt(KIND_TOKEN)).addU64(1n).addBool(value));
  await flag('setVerified', true);
  check('verified', (await project()).verified);
  await flag('setVerified', false);
  await flag('setHidden', true);
  check('hidden', (await project()).hidden && !(await project()).verified);
  await flag('setHidden', false);
  check('back to normal', !(await project()).hidden);
}

// ---- reserved symbols -----------------------------------------------------------------------
const symbol = `Z${Date.now().toString(36).toUpperCase().slice(-6)}`;
check('a new symbol is free', (await symbolEntry(symbol)) === null);
await send(admin, 'reserveSymbol', new Args().addString(symbol).addBool(true));
check('reserved (empty entry)', (await symbolEntry(symbol))?.length === 0);
await send(admin, 'reserveSymbol', new Args().addString(symbol).addBool(false));
check('freed', (await symbolEntry(symbol)) === null);

// ---- fee withdrawal -------------------------------------------------------------------------
const feesBefore = await fees();
const amount = Mas.fromString('0.1');
if (feesBefore >= amount) {
  const otherBefore = (await admin.balanceOf([OTHER], false))[0].balance;
  await send(admin, 'withdrawFees', new Args().addString(OTHER).addU64(amount));
  const otherAfter = (await admin.balanceOf([OTHER], false))[0].balance;
  check('fees withdrawn to another address', otherAfter - otherBefore === amount);
  check('fees counter lowered', (await fees()) === feesBefore - amount);
}
check(
  'never more than the fees collected',
  (await refusal(
    admin,
    'withdrawFees',
    new Args().addString(ADMIN).addU64((await fees()) + 1n),
  )) === 'Amount exceeds the collected fees',
);

// ---- two-step admin handover ----------------------------------------------------------------
await send(admin, 'transferAdmin', new Args().addString(OTHER));
check('offer pending', text(await read('pendingAdmin')) === OTHER);
check('admin unchanged until accepted', text(await read('admin')) === ADMIN);
check(
  'only the named address can accept',
  (await refusal(admin, 'acceptAdmin', new Args())) === 'Caller is not the pending admin',
);
await send(other, 'acceptAdmin', new Args());
check('the new admin accepted', text(await read('admin')) === OTHER);
await send(other, 'transferAdmin', new Args().addString(ADMIN));
await send(admin, 'acceptAdmin', new Args());
check('handed back', text(await read('admin')) === ADMIN && !(await read('pendingAdmin')).length);

// ---- upgrade timelock -----------------------------------------------------------------------
const code = getScByteCode('build', 'launchpad.wasm');
const hash = createHash('sha256').update(code).digest();
await send(admin, 'proposeUpgrade', new Args().addUint8Array(hash));
const proposal = readUpgradeProposal(new Args(await read('pendingUpgrade')));
const delayHours = (proposal.executableAt - Date.now()) / 3_600_000;
check('upgrade pending ~72 h', delayHours > 71.5 && delayHours <= 72, `${delayHours.toFixed(2)} h`);
check(
  'not before the delay',
  (await refusal(
    admin,
    'executeUpgrade',
    new Args().addUint8Array(code),
    Mas.fromString('20'),
  )) === 'The upgrade delay has not passed yet',
);
await send(admin, 'cancelUpgrade', new Args());
check('upgrade cancelled', (await read('pendingUpgrade')).length === 0);

console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
