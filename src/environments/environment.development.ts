/** `ng serve` settings: local files and a local IPFS node can be used while developing. */
export const environment = {
  /**
   * Gateway for ipfs:// links. To use your own IPFS node (Kubo), set it to its gateway, e.g.
   * 'http://127.0.0.1:8080/ipfs/'.
   */
  ipfsGateway: 'https://ipfs.io/ipfs/',
  /** Load http://localhost… metadata and images, e.g. from `npx http-server ./metadata --cors`. */
  allowLocalUrls: true,
  /** Networks the app offers: buildnet (the test network) only while developing. */
  networks: ['mainnet', 'buildnet'],
};
