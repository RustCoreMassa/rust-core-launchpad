import { CHAIN_ID } from '@massalabs/massa-web3';

export type NetworkId = 'mainnet' | 'buildnet';

export interface NetworkConfig {
  readonly id: NetworkId;
  readonly label: string;
  readonly chainId: bigint;
  /**
   * Launchpad SC address on this network; null until it is deployed there. Phase 2 deploys to
   * buildnet, phase 7 to mainnet.
   */
  readonly launchpadAddress: string | null;
}

export const NETWORKS: Readonly<Record<NetworkId, NetworkConfig>> = {
  mainnet: { id: 'mainnet', label: 'Mainnet', chainId: CHAIN_ID.Mainnet, launchpadAddress: null },
  buildnet: {
    id: 'buildnet',
    label: 'Buildnet',
    chainId: CHAIN_ID.Buildnet,
    // smart-contract/deployments/buildnet.json
    launchpadAddress: 'AS1Ngm242VSgb8MyxM4HJ9qB8fEB4QjJ7omKDMTA4dyvMpirvyo1',
  },
};

/** Development happens on buildnet until the Launchpad SC is live on mainnet. */
export const DEFAULT_NETWORK: NetworkId = 'buildnet';

export function networkByChainId(chainId: bigint): NetworkConfig | undefined {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId);
}
