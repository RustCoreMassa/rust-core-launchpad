// Uploads a new template version to the deployed Launchpad (setTemplate), from build/:
//
//   npx tsx src/set-template.ts collection   # or: token
//
// The admin is PRIVATE_KEY; NETWORK=mainnet / DEPLOYMENT=<name> as for the other scripts (the
// Admin page's Templates section does the same with a wallet). Only the newest template the app
// knows (KNOWN_TEMPLATES) is accepted: the app launches only from that one. The upload is
// simulated first, read back and recorded in the deployment file.
import 'dotenv/config';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import {
  Account,
  Args,
  JsonRpcProvider,
  Mas,
  OperationStatus,
  StorageCost,
} from '@massalabs/massa-web3';
import { contractReason } from '../../src/app/core/launchpad/events';
import { newestTemplate } from '../../src/app/core/launchpad/templates';
import { deploymentFile, getScByteCode } from './utils';

const kinds = { token: [0, 'rc-token.wasm'], collection: [1, 'rc-collection.wasm'] } as const;
const which = process.argv[2] as keyof typeof kinds;
if (!(which in kinds)) throw new Error('Usage: npx tsx src/set-template.ts token | collection');
const [kind, file] = kinds[which];

const network = process.env['NETWORK'] === 'mainnet' ? 'mainnet' : 'buildnet';
const recordFile = deploymentFile(network);
const deployment = JSON.parse(readFileSync(recordFile, 'utf8'));
const LAUNCHPAD: string = deployment.address;
const account = await Account.fromEnv();
const provider =
  network === 'mainnet' ? JsonRpcProvider.mainnet(account) : JsonRpcProvider.buildnet(account);
const admin = account.address.toString();

const code = getScByteCode('build', file);
const hash = createHash('sha256').update(code).digest('hex');
const newest = newestTemplate(kind);
if (hash !== newest.hash)
  throw new Error(
    `build/${file} (${hash}) is not the app's newest ${which} template (v${newest.version})`,
  );

async function onChain(): Promise<{ version: number; hash: string }> {
  const result = await provider.readSC({
    target: LAUNCHPAD,
    func: 'template',
    parameter: new Args().addU8(BigInt(kind)),
    caller: admin,
  });
  if (result.info.error) throw new Error(contractReason(result.info.error));
  const args = new Args(result.value);
  return {
    version: Number(args.nextU32()),
    hash: Buffer.from(args.nextUint8Array()).toString('hex'),
  };
}

console.log(`Launchpad ${LAUNCHPAD} on ${network}, admin ${admin}`);
const before = await onChain();
console.log(`On-chain ${which} template: v${before.version} ${before.hash}`);
console.log(`Uploading ${file}: source v${newest.version}, ${code.length} bytes, sha256 ${hash}`);
if (before.hash === hash) throw new Error('This template is already the current one.');

const parameter = new Args().addU8(BigInt(kind)).addUint8Array(code);
// Code + hash + version entries (as deploy.ts), plus a margin; the contract refunds the rest.
const coins =
  StorageCost.datastoreEntry(new Uint8Array(9), code) +
  StorageCost.datastoreEntry(new Uint8Array(10), new Uint8Array(32)) +
  StorageCost.datastoreEntry(new Uint8Array(6), new Uint8Array(4)) +
  Mas.fromString('0.05');
const simulation = await provider.readSC({
  target: LAUNCHPAD,
  func: 'setTemplate',
  parameter,
  coins,
  caller: admin,
});
if (simulation.info.error) throw new Error(`setTemplate: ${contractReason(simulation.info.error)}`);
const balanceBefore = await provider.balance(true);
const op = await provider.callSC({ target: LAUNCHPAD, func: 'setTemplate', parameter, coins });
console.log(`  operation ${op.id}, sending ${Mas.toString(coins)} MAS`);
const status = await op.waitFinalExecution();
if (status !== OperationStatus.Success) {
  const events = (await op.getFinalEvents()).map((e) => e.data);
  throw new Error(`setTemplate failed: ${contractReason(events.at(-1) ?? '')}`);
}
const paid = balanceBefore - (await provider.balance(true));

const after = await onChain();
const ok = after.hash === hash && after.version === before.version + 1;
console.log(
  `${ok ? '✓' : '✗'} on-chain ${which} template: v${after.version} ${after.hash} (paid ${Mas.toString(paid)} MAS)`,
);
if (!ok) process.exit(1);
deployment.templates[file] = {
  version: after.version,
  sha256: hash,
  bytes: code.length,
  setAt: new Date().toISOString(),
};
writeFileSync(recordFile, JSON.stringify(deployment, null, 2) + '\n');
console.log(`Updated ${recordFile}.`);
