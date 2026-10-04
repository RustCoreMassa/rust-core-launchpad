import { InjectionToken } from '@angular/core';
import type { Wallet } from '@massalabs/wallet-provider';

/** wallet-provider's WalletName values. */
export type WalletId = 'BEARBY' | 'MASSA WALLET' | 'METAMASK';

export interface WalletOption {
  readonly id: WalletId;
  readonly label: string;
  readonly installUrl: string;
}

/**
 * The wallets @massalabs/wallet-provider 3.3 can talk to. RustCore Wallet joins this list once
 * its provider is added to wallet-provider (planned in the wallet project).
 */
export const WALLET_OPTIONS: readonly WalletOption[] = [
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
