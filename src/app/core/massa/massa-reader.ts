import { Injectable, InjectionToken, inject } from '@angular/core';
import { JsonRpcPublicProvider, PublicProvider } from '@massalabs/massa-web3';
import { NetworkStore } from '../network/network-store';
import { NetworkId } from '../network/networks';
import { fromUnits } from '../utils/token-amount';

export const MAS_DECIMALS = 9;

/** Builds the public (read-only) JSON-RPC provider for a network. Replaced in tests. */
export const PUBLIC_PROVIDER_FACTORY = new InjectionToken<(network: NetworkId) => PublicProvider>(
  'PUBLIC_PROVIDER_FACTORY',
  {
    providedIn: 'root',
    factory: () => (network) =>
      network === 'mainnet' ? JsonRpcPublicProvider.mainnet() : JsonRpcPublicProvider.buildnet(),
  },
);

/**
 * Every read the app makes goes through here: free, no wallet needed, always on the network
 * selected in the app (never the wallet's own network).
 */
@Injectable({ providedIn: 'root' })
export class MassaReader {
  private readonly networks = inject(NetworkStore);
  private readonly factory = inject(PUBLIC_PROVIDER_FACTORY);
  private readonly providers = new Map<NetworkId, PublicProvider>();

  /** The read provider for the selected network (one instance per network). */
  provider(network: NetworkId = this.networks.network()): PublicProvider {
    let provider = this.providers.get(network);
    if (!provider) {
      provider = this.factory(network);
      this.providers.set(network, provider);
    }
    return provider;
  }

  /** Final MAS balance of an address, in MAS. */
  async masBalance(address: string, network: NetworkId = this.networks.network()): Promise<number> {
    const [entry] = await this.provider(network).balanceOf([address], true);
    return fromUnits(entry?.balance ?? 0n, MAS_DECIMALS);
  }
}
