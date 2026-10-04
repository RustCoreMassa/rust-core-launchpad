/** Public gateway used to show ipfs:// images and metadata (listed in the README's destinations). */
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

/** A link the browser can load: ipfs://CID/path → gateway URL; https stays; anything else → ''. */
export function httpUrl(url: string): string {
  if (url.startsWith('ipfs://'))
    return IPFS_GATEWAY + url.slice('ipfs://'.length).replace(/^ipfs\//, '');
  if (url.startsWith('https://')) return url;
  return '';
}
