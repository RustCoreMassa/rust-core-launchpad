/** Production settings (the published build). `ng serve` swaps in environment.development.ts. */
export const environment = {
  /** Gateway for ipfs:// links; must end with /ipfs/. */
  ipfsGateway: 'https://ipfs.io/ipfs/',
  /** Also load http:// links on this machine (localhost, 127.0.0.1, [::1]). Never in production. */
  allowLocalUrls: false,
  /** Networks the app offers: the published app works on mainnet only. */
  networks: ['mainnet'],
};
