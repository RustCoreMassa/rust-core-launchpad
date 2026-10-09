import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

export function getScByteCode(folderName: string, fileName: string): Buffer {
  // Obtain the current file name and directory paths
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(path.dirname(__filename));
  return readFileSync(path.join(__dirname, folderName, fileName));
}

/**
 * The deployment record the scripts use: deployments/<network>.json, or
 * deployments/<DEPLOYMENT>.json when DEPLOYMENT names a second Launchpad on the same network
 * (e.g. DEPLOYMENT=buildnet-tokenomics, a fresh one next to the one waiting for an upgrade).
 */
export function deploymentFile(network: string): string {
  return `deployments/${process.env['DEPLOYMENT'] || network}.json`;
}
