import { CHAIN_ID } from '@massalabs/massa-web3';

export type NetworkId = 'mainnet' | 'buildnet';

export interface NetworkConfig {
  readonly id: NetworkId;
  readonly label: string;
  readonly chainId: bigint;
  /** Launchpad SC address on this network (smart-contract/deployments/<network>.json). */
  readonly launchpadAddress: string | null;
}

export const NETWORKS: Readonly<Record<NetworkId, NetworkConfig>> = {
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    chainId: CHAIN_ID.Mainnet,
    // smart-contract/deployments/mainnet.json — Launchpad v1.0.0
    launchpadAddress: 'AS1LbJFfhZpq8DehV7Uw5XQxCyfXtwgUUoiZSTsHcyhEGB7RPWyP',
  },
  buildnet: {
    id: 'buildnet',
    label: 'Buildnet',
    chainId: CHAIN_ID.Buildnet,
    // smart-contract/deployments/buildnet-1.4.0.json (v1.4.0: holder discount). Older ones:
    // buildnet-1.2.0.json, and buildnet.json (upgraded in place to v1.1.0).
    launchpadAddress: 'AS1ZgNKUWr5kFRUKEfbt3LEoSwWFtnSz1UGCu7HR6Nqob2bkaB1n',
  },
};

/** The Launchpad is live on mainnet (v1.0.0); buildnet stays one click away for testing. */
export const DEFAULT_NETWORK: NetworkId = 'mainnet';

export function networkByChainId(chainId: bigint): NetworkConfig | undefined {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId);
}
