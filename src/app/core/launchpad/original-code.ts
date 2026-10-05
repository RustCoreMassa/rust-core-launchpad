import { Injectable, inject } from '@angular/core';
import { sha256 } from '../utils/sha256';
import { ZipEntry, createZip } from '../utils/zip';
import { LaunchpadReader } from './launchpad-reader';
import { KIND_TOKEN, Project, SOURCE_LAUNCHED, hex } from './records';

/** Source files of each template version, served by the app from public/templates/. */
const TEMPLATE_FILES: Record<string, string[]> = {
  'rc-token/v1': [
    'package.json',
    'asconfig.json',
    'assembly/contracts/rc-token.ts',
    'assembly/lib/ownable.ts',
    'assembly/lib/mutable.ts',
    'assembly/lib/validation.ts',
  ],
  'rc-collection/v1': [
    'package.json',
    'asconfig.json',
    'assembly/contracts/rc-collection.ts',
    'assembly/lib/ownable.ts',
    'assembly/lib/mutable.ts',
    'assembly/lib/validation.ts',
  ],
};

export const KEEP_ONLY_ORIGINAL =
  'We keep only the original code. If you upgrade your contract, RustCore Launchpad does not ' +
  'store the new code — keep it yourself.';

/**
 * "Download original code": a zip built in the browser with the template source at the version
 * used, the compiled .wasm read from the Launchpad SC, its sha256 and a README on rebuilding and
 * upgrading. Nothing is fetched from anywhere but the app itself and the Massa RPC.
 */
@Injectable({ providedIn: 'root' })
export class OriginalCode {
  private readonly launchpad = inject(LaunchpadReader);

  async zip(project: Project): Promise<Blob> {
    if (project.source !== SOURCE_LAUNCHED)
      throw new Error('Imported contracts were not launched from our templates.');
    const template = project.kind === KIND_TOKEN ? 'rc-token' : 'rc-collection';
    const folder = `${template}/v${project.templateVersion}`;
    const files = TEMPLATE_FILES[folder];
    if (!files) throw new Error(`No source is bundled for ${folder}.`);

    const wasm = await this.launchpad.templateCode(project.kind, project.templateVersion);
    const wasmHash = await sha256Hex(wasm);
    if (wasmHash !== hex(project.codeHash))
      throw new Error('The stored template does not match this contract’s original code.');

    const entries: ZipEntry[] = [];
    for (const file of files) {
      const response = await fetch(`templates/${folder}/${file}`);
      if (!response.ok) throw new Error(`Couldn't load ${file}.`);
      entries.push({ name: file, data: new Uint8Array(await response.arrayBuffer()) });
    }
    const text = new TextEncoder();
    entries.push(
      { name: `original/${template}.wasm`, data: wasm },
      { name: 'original/sha256.txt', data: text.encode(`${wasmHash}  ${template}.wasm\n`) },
      { name: 'project.json', data: text.encode(projectJson(project)) },
      { name: 'README.md', data: text.encode(readme(project, template, wasmHash)) },
    );
    const bytes = createZip(entries);
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  return hex(await sha256(data));
}

function projectJson(p: Project): string {
  return (
    JSON.stringify(
      {
        address: p.address,
        name: p.name,
        symbol: p.symbol,
        decimals: p.kind === KIND_TOKEN ? p.decimals : undefined,
        creator: p.creator,
        createdAt: new Date(p.createdAt).toISOString(),
        templateVersion: p.templateVersion,
        mutable: p.mutable,
        originalCodeSha256: hex(p.codeHash),
      },
      null,
      2,
    ) + '\n'
  );
}

function readme(p: Project, template: string, wasmHash: string): string {
  return `# ${p.name} (${p.symbol}) — original code

Contract: ${p.address}
Template: ${template} v${p.templateVersion}
Original bytecode sha256: ${wasmHash}

${KEEP_ONLY_ORIGINAL}

## Rebuild and verify

Requires Node 24.

    npm install
    npm run build
    shasum -a 256 build/${template}.wasm   # must equal original/sha256.txt

## Upgrade (only if the contract was launched with mutable code)

Edit the sources, rebuild, then call \`upgrade\` on your contract with the new bytecode as its
argument (Args: bytes), signed by the owner. Keep the new sources: the Launchpad will show your
contract as "Code modified" and can only give back this original.
`;
}
