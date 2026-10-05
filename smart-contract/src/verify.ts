// Checks that the contracts on-chain are exactly the ones this source builds: the Launchpad's
// bytecode and the templates it launches from. Read-only — no key, no MAS.
//   npm run verify                    # buildnet
//   NETWORK=mainnet npm run verify    # once deployed there
// Reads deployments/<network>.json for the address; compares sha256 of build/*.wasm with the
// bytecode on-chain (getAddressesBytecode) and with the Launchpad's `template(kind)` hashes.
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { Args, JsonRpcPublicProvider } from '@massalabs/massa-web3';
import { getScByteCode } from './utils';

const network = process.env['NETWORK'] === 'mainnet' ? 'mainnet' : 'buildnet';
const file = `deployments/${network}.json`;
if (!existsSync(file)) throw new Error(`No ${file}: the Launchpad isn't deployed on ${network}.`);
const address: string = JSON.parse(readFileSync(file, 'utf8')).address;
const provider =
  network === 'mainnet' ? JsonRpcPublicProvider.mainnet() : JsonRpcPublicProvider.buildnet();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

let failures = 0;
function check(label: string, onChain: string, built: string): void {
  const ok = onChain === built;
  console.log(`${ok ? '✓' : '✗'} ${label}\n    on-chain ${onChain}\n    built    ${built}`);
  if (!ok) failures++;
}

console.log(`Launchpad ${address} on ${network}`);
const code = await provider.client.getAddressesBytecode({ address, is_final: true });
check('Launchpad bytecode', sha256(code), sha256(getScByteCode('build', 'launchpad.wasm')));

for (const [kind, wasm] of [
  [0, 'rc-token.wasm'],
  [1, 'rc-collection.wasm'],
] as const) {
  const result = await provider.readSC({
    target: address,
    func: 'template',
    parameter: new Args().addU8(BigInt(kind)),
  });
  if (result.info.error) throw new Error(result.info.error);
  const args = new Args(result.value);
  const version = Number(args.nextU32());
  const hash = Buffer.from(args.nextUint8Array()).toString('hex');
  check(`${wasm} (template v${version})`, hash, sha256(getScByteCode('build', wasm)));
}

console.log(failures ? `${failures} mismatch(es)` : 'All contracts match this source');
process.exit(failures ? 1 : 0);
