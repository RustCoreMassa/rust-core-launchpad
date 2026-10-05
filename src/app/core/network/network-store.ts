import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { LOCAL_STORE } from '../platform/storage';
import { DEFAULT_NETWORK, NETWORKS, NetworkConfig, NetworkId } from './networks';

const STORAGE_KEY = 'launchpad.network';

/**
 * The networks the app offers: mainnet only in the published build, buildnet too with `ng serve`
 * (src/environments). Replaced in tests.
 */
export const ENABLED_NETWORKS = new InjectionToken<readonly NetworkId[]>('ENABLED_NETWORKS', {
  providedIn: 'root',
  factory: () => environment.networks.filter((n): n is NetworkId => n in NETWORKS),
});

/** The network the app reads from and expects the wallet to be on. */
@Injectable({ providedIn: 'root' })
export class NetworkStore {
  private readonly store = inject(LOCAL_STORE);
  private readonly enabled = inject(ENABLED_NETWORKS);
  private readonly _network = signal<NetworkId>(this.restore());

  readonly network = this._network.asReadonly();
  readonly config = computed(() => NETWORKS[this._network()]);
  /** The networks to choose from; one in the published build (then there's nothing to pick). */
  readonly available: readonly NetworkConfig[] = this.enabled.map((id) => NETWORKS[id]);

  /** Switches network; a network this build doesn't offer is ignored. */
  select(network: NetworkId): void {
    if (!this.enabled.includes(network)) return;
    this._network.set(network);
    this.store.setItem(STORAGE_KEY, network);
  }

  private restore(): NetworkId {
    const saved = this.store.getItem(STORAGE_KEY) as NetworkId | null;
    if (saved && this.enabled.includes(saved)) return saved;
    return this.enabled.includes(DEFAULT_NETWORK) ? DEFAULT_NETWORK : this.enabled[0];
  }
}
