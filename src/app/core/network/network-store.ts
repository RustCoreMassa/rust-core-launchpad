import { Injectable, computed, inject, signal } from '@angular/core';
import { LOCAL_STORE } from '../platform/storage';
import { DEFAULT_NETWORK, NETWORKS, NetworkId } from './networks';

const STORAGE_KEY = 'launchpad.network';

/** The network the app reads from and expects the wallet to be on. */
@Injectable({ providedIn: 'root' })
export class NetworkStore {
  private readonly store = inject(LOCAL_STORE);
  private readonly _network = signal<NetworkId>(this.restore());

  readonly network = this._network.asReadonly();
  readonly config = computed(() => NETWORKS[this._network()]);

  select(network: NetworkId): void {
    this._network.set(network);
    this.store.setItem(STORAGE_KEY, network);
  }

  private restore(): NetworkId {
    const saved = this.store.getItem(STORAGE_KEY);
    return saved === 'mainnet' || saved === 'buildnet' ? saved : DEFAULT_NETWORK;
  }
}
