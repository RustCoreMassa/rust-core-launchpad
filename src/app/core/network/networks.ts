import { CHAIN_ID } from '@massalabs/massa-web3';

export type NetworkId = 'mainnet' | 'buildnet';

export interface NetworkConfig {
  readonly id: NetworkId;
  readonly label: string;
  readonly chainId: bigint;
  /** Launchpad SC address on this network (smart-contract/deployments/<network>.json). */
  readonly launchpadAddress: string | null;
  /**
   * RustCore's membership collection, shown on the home page before the Launchpad's holder
   * discount names it (holderDiscount wins once set); null when there is none yet.
   */
  readonly membershipCollection: string | null;
}

export const NETWORKS: Readonly<Record<NetworkId, NetworkConfig>> = {
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    chainId: CHAIN_ID.Mainnet,
    // smart-contract/deployments/mainnet.json — deployed as v1.0.0, upgraded in place since
    launchpadAddress: 'AS1LbJFfhZpq8DehV7Uw5XQxCyfXtwgUUoiZSTsHcyhEGB7RPWyP',
    // Core Keepers (CKEEP), RustCore's collection.
    membershipCollection: 'AS125HSzXL9sphoniiqezuYKX3mGNuuS19yLQKvaJUGyEkfALpVTB',
  },
  buildnet: {
    id: 'buildnet',
    label: 'Buildnet',
    chainId: CHAIN_ID.Buildnet,
    // smart-contract/deployments/buildnet-1.4.0.json (v1.4.0: holder discount). Older ones:
    // buildnet-1.2.0.json, and buildnet.json (upgraded in place to v1.1.0).
    launchpadAddress: 'AS1ZgNKUWr5kFRUKEfbt3LEoSwWFtnSz1UGCu7HR6Nqob2bkaB1n',
    membershipCollection: null,
  },
};

/** The Launchpad is live on mainnet; buildnet stays one click away for testing. */
export const DEFAULT_NETWORK: NetworkId = 'mainnet';

export function networkByChainId(chainId: bigint): NetworkConfig | undefined {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId);
}
