import { InjectionToken } from '@angular/core';
import type { Wallet } from '@massalabs/wallet-provider';

/** wallet-provider's WalletName values. */
export type WalletId = 'RUSTCORE' | 'BEARBY' | 'MASSA WALLET' | 'METAMASK';

export interface WalletOption {
  readonly id: WalletId;
  readonly label: string;
  readonly installUrl: string;
}

/** The wallets @massalabs/wallet-provider can talk to. */
export const WALLET_OPTIONS: readonly WalletOption[] = [
  { id: 'RUSTCORE', label: 'RustCore Wallet', installUrl: 'https://wrustcore.massa.network' },
  { id: 'BEARBY', label: 'Bearby', installUrl: 'https://bearby.io' },
  { id: 'MASSA WALLET', label: 'Massa Station', installUrl: 'https://station.massa.net/' },
  {
    id: 'METAMASK',
    label: 'MetaMask (Massa Snap)',
    installUrl: 'https://snaps.metamask.io/snap/npm/massalabs/metamask-snap/',
  },
];

/**
 * Finds the wallets installed in this browser. wallet-provider (and the MetaMask libraries it
 * pulls in) is loaded only here, on first use, so it stays out of the initial bundle.
 */
export const WALLET_DISCOVERY = new InjectionToken<() => Promise<Wallet[]>>('WALLET_DISCOVERY', {
  providedIn: 'root',
  factory: () => async () => (await import('@massalabs/wallet-provider')).getWallets(),
});
