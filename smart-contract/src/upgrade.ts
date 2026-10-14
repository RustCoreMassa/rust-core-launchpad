// Upgrades the deployed Launchpad in place, through its 72-hour timelock, with build/launchpad.wasm:
//
//   npm run upgrade -- propose   # records the new code's hash; executable 72 h later
//   npm run upgrade -- status    # what is pending, and when it can run
//   npm run upgrade -- cancel    # withdraws the pending proposal (before proposing another)
//   npm run upgrade -- snapshot  # retakes the storage snapshot (do it right before execute)
//   npm run upgrade -- execute   # after the delay: installs the code, then checks the storage
//
// The admin is PRIVATE_KEY; NETWORK=mainnet for mainnet (the Admin page does the same there).
// `propose` saves a snapshot of the whole datastore (sha256 of every value) in
// deployments/upgrades/<network>-<version>.json; `execute` compares the storage with it, so a
// change of code that loses or rewrites records shows up. Keys written by normal use of the
// Launchpad in between (launches, listings…) are listed as added or changed, not as errors.
import 'dotenv/config';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { Account, Args, JsonRpcProvider, Mas, OperationStatus } from '@massalabs/massa-web3';
import { contractReason } from '../../src/app/core/launchpad/events';
import { readUpgradeProposal } from '../../src/app/core/launchpad/records';
import { deploymentFile, getScByteCode } from './utils';

const network = process.env['NETWORK'] === 'mainnet' ? 'mainnet' : 'buildnet';
const file = deploymentFile(network);
const deployment = JSON.parse(readFileSync(file, 'utf8'));
const LAUNCHPAD: string = deployment.address;
const account = await Account.fromEnv();
const provider =
  network === 'mainnet' ? JsonRpcProvider.mainnet(account) : JsonRpcProvider.buildnet(account);
const admin = account.address.toString();

const code = getScByteCode('build', 'launchpad.wasm');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const codeHash = sha256(code);
const newVersion: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
const snapshotFile = `deployments/upgrades/${process.env['DEPLOYMENT'] || network}-${newVersion}.json`;
/** Storage of a bigger code is paid by the admin; the unused part is refunded. */
const MARGIN = 100_000_000n; // 0.1 MAS

async function read(func: string, parameter = new Args()): Promise<Uint8Array> {
  const result = await provider.readSC({ target: LAUNCHPAD, func, parameter, caller: admin });
  if (result.info.error) throw new Error(contractReason(result.info.error));
  return result.value;
}

async function send(func: string, parameter: Args, coins: bigint): Promise<string[]> {
  const simulation = await provider.readSC({
    target: LAUNCHPAD,
    func,
    parameter,
    coins,
    caller: admin,
  });
  if (simulation.info.error) throw new Error(`${func}: ${contractReason(simulation.info.error)}`);
  const op = await provider.callSC({ target: LAUNCHPAD, func, parameter, coins });
  console.log(`  operation ${op.id}`);
  const status = await op.waitFinalExecution();
  const events = (await op.getFinalEvents()).map((e) => e.data);
  if (status !== OperationStatus.Success)
    throw new Error(`${func} failed: ${contractReason(events.at(-1) ?? '')}`);
  return events;
}

/** The pending proposal's own entry: executeUpgrade deletes it, as expected. */
const UPGRADE_KEY_HEX = Buffer.from('upg').toString('hex');

/** sha256 of every value in the Launchpad's datastore, by key (hex), except the proposal. */
async function snapshot(): Promise<Record<string, string>> {
  const keys = await provider.getStorageKeys(LAUNCHPAD, new Uint8Array(), true);
  const out: Record<string, string> = {};
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const values = await provider.readStorage(LAUNCHPAD, batch, true);
    batch.forEach(
      (key, j) => (out[Buffer.from(key).toString('hex')] = sha256(values[j] ?? new Uint8Array())),
    );
  }
  delete out[UPGRADE_KEY_HEX];
  return out;
}

const printable = (hex: string) =>
  Buffer.from(hex, 'hex')
    .toString('latin1')
    .replace(/[^\x20-\x7e]/g, '·');

async function onChainCode(): Promise<Uint8Array> {
  return provider.client.getAddressesBytecode({ address: LAUNCHPAD, is_final: true });
}

async function pending() {
  const bytes = await read('pendingUpgrade');
  return bytes.length ? readUpgradeProposal(new Args(bytes)) : null;
}

const command = process.argv[2];
const current = new TextDecoder().decode(await read('version'));
console.log(`Launchpad ${LAUNCHPAD} on ${network}: v${current}, admin ${admin}`);
console.log(`New code: v${newVersion}, ${code.length} bytes, sha256 ${codeHash}`);

if (command === 'status') {
  const proposal = await pending();
  if (!proposal) console.log('No upgrade is pending.');
  else {
    const hash = Buffer.from(proposal.codeHash).toString('hex');
    console.log(`Pending: ${hash}${hash === codeHash ? ' (= this build)' : ' (NOT this build)'}`);
    console.log(`Executable at ${new Date(proposal.executableAt).toISOString()}`);
  }
} else if (command === 'cancel') {
  const proposal = await pending();
  if (!proposal) throw new Error('No upgrade is pending.');
  const hash = Buffer.from(proposal.codeHash).toString('hex');
  console.log(`Cancelling the pending upgrade ${hash}`);
  await send('cancelUpgrade', new Args(), MARGIN);
  if (await pending()) throw new Error('The upgrade is still pending.');
  console.log('Cancelled: no upgrade is pending.');
} else if (command === 'propose') {
  if (sha256(await onChainCode()) === codeHash) throw new Error('This code is already deployed.');
  if (await pending())
    throw new Error(
      'An upgrade is already pending: npm run upgrade -- cancel (or the Admin page).',
    );
  const before = await snapshot();
  console.log(`Snapshot: ${Object.keys(before).length} storage entries`);
  await send('proposeUpgrade', new Args().addUint8Array(Buffer.from(codeHash, 'hex')), MARGIN);
  const proposal = (await pending())!;
  mkdirSync('deployments/upgrades', { recursive: true });
  writeFileSync(
    snapshotFile,
    JSON.stringify(
      {
        network,
        address: LAUNCHPAD,
        from: current,
        to: newVersion,
        sha256: codeHash,
        bytes: code.length,
        proposedAt: new Date().toISOString(),
        executableAt: new Date(proposal.executableAt).toISOString(),
        storage: before,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Proposed. Executable at ${new Date(proposal.executableAt).toISOString()}.`);
  console.log(`Snapshot saved to ${snapshotFile}.`);
} else if (command === 'snapshot') {
  if (!existsSync(snapshotFile)) throw new Error(`No ${snapshotFile}: propose first.`);
  const saved = JSON.parse(readFileSync(snapshotFile, 'utf8'));
  const storage = await snapshot();
  writeFileSync(
    snapshotFile,
    JSON.stringify({ ...saved, snapshotAt: new Date().toISOString(), storage }, null, 2) + '\n',
  );
  console.log(`Snapshot retaken: ${Object.keys(storage).length} storage entries.`);
} else if (command === 'execute') {
  if (!existsSync(snapshotFile)) throw new Error(`No ${snapshotFile}: propose first.`);
  const saved = JSON.parse(readFileSync(snapshotFile, 'utf8'));
  if (saved.sha256 !== codeHash) throw new Error('build/launchpad.wasm is not the proposed code.');
  const proposal = await pending();
  if (!proposal) throw new Error('No upgrade is pending.');
  const wait = proposal.executableAt - Date.now();
  if (wait > 0) throw new Error(`Too early: executable in ${(wait / 3_600_000).toFixed(1)} h.`);
  const oldCode = await onChainCode();
  const grows = BigInt(Math.max(0, code.length - oldCode.length));
  const coins = grows * 100_000n + MARGIN;
  const balanceBefore = await provider.balance(true);
  console.log(`Sending ${Mas.toString(coins)} MAS (the code grows by ${grows} bytes)`);
  await send('executeUpgrade', new Args().addUint8Array(code), coins);
  const paid = balanceBefore - (await provider.balance(true));

  let failures = 0;
  const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
  };
  check('on-chain code = this build', sha256(await onChainCode()) === codeHash);
  const version = new TextDecoder().decode(await read('version'));
  check(`version ${version}`, version === newVersion);
  check('no upgrade pending', (await pending()) === null);
  console.log(`  the admin paid ${Mas.toString(paid)} MAS (network fee included)`);

  const after = await snapshot();
  const removed = Object.keys(saved.storage).filter((k) => !(k in after));
  const changed = Object.keys(saved.storage).filter(
    (k) => k in after && after[k] !== saved.storage[k],
  );
  const added = Object.keys(after).filter((k) => !(k in saved.storage));
  const kept = Object.keys(saved.storage).length - removed.length - changed.length;
  check(
    'no storage entry lost',
    removed.length === 0,
    `${kept} unchanged, ${changed.length} changed, ${added.length} added since the proposal`,
  );
  for (const k of removed) console.log(`    removed ${printable(k)}`);
  for (const k of changed) console.log(`    changed ${printable(k)}`);
  for (const k of added) console.log(`    added   ${printable(k)}`);

  if (!failures) {
    mkdirSync('deployments/history', { recursive: true });
    renameSync(file, `deployments/history/${network}-v${deployment.version}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          ...deployment,
          version: newVersion,
          launchpadBytes: code.length,
          upgradedAt: new Date().toISOString(),
          upgradedFrom: deployment.version,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`Updated ${file} (previous one in deployments/history/).`);
  }
  process.exit(failures ? 1 : 0);
} else {
  console.log('Usage: npm run upgrade -- propose | status | snapshot | execute');
  process.exit(1);
}
