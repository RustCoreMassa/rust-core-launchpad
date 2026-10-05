import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Provider } from '@massalabs/massa-web3';
import type { Wallet } from '@massalabs/wallet-provider';
import { MassaReader } from '../massa/massa-reader';
import { NetworkStore } from '../network/network-store';
import { networkByChainId } from '../network/networks';
import { toUserMessage } from '../utils/user-error';
import { WALLET_DISCOVERY, WALLET_OPTIONS, WalletId, WalletOption } from './wallet-options';

export type WalletPhase = 'disconnected' | 'connecting' | 'connected';

export interface WalletAccount {
  readonly address: string;
  readonly name: string;
}

export interface WalletChoice extends WalletOption {
  readonly installed: boolean;
}

/**
 * The user's wallet connection. The app never holds keys: every transaction is signed by the
 * connected wallet, through `signer()`. Balances are read on the network selected in the app,
 * and a wallet on another network is flagged (`networkMismatch`) rather than silently used.
 * Nothing connects on its own: a connection starts only when the user picks a wallet.
 */
@Injectable({ providedIn: 'root' })
export class WalletStore {
  private readonly discover = inject(WALLET_DISCOVERY);
  private readonly reader = inject(MassaReader);
  private readonly networks = inject(NetworkStore);

  private readonly _detected = signal<readonly Wallet[] | null>(null);
  private readonly _detecting = signal(false);
  private readonly _phase = signal<WalletPhase>('disconnected');
  private readonly _connectingTo = signal<WalletId | null>(null);
  private readonly _walletId = signal<WalletId | null>(null);
  private readonly _accounts = signal<readonly WalletAccount[]>([]);
  private readonly _address = signal<string | null>(null);
  private readonly _walletChainId = signal<bigint | null>(null);
  private readonly _balance = signal<number | null>(null);
  private readonly _error = signal<string | null>(null);

  private wallet: Wallet | null = null;
  private providers: readonly Provider[] = [];
  private listeners: { unsubscribe(): void }[] = [];
  /** Bumped by every connect/disconnect, so a slower earlier attempt can't win. */
  private attempt = 0;
  private balanceRead = 0;

  readonly detecting = this._detecting.asReadonly();
  readonly phase = this._phase.asReadonly();
  /** The wallet the user asked to connect, while it answers; null otherwise. */
  readonly connectingTo = this._connectingTo.asReadonly();
  readonly walletId = this._walletId.asReadonly();
  readonly accounts = this._accounts.asReadonly();
  readonly address = this._address.asReadonly();
  /** MAS balance on the app's network; null while unknown (show a skeleton, never a fake 0). */
  readonly balance = this._balance.asReadonly();
  readonly error = this._error.asReadonly();

  readonly connected = computed(() => this._phase() === 'connected' && this._address() !== null);
  readonly walletLabel = computed(
    () => WALLET_OPTIONS.find((o) => o.id === this._walletId())?.label ?? '',
  );
  /** Every supported wallet, marked installed or not; null until detection ran. */
  readonly choices = computed<readonly WalletChoice[] | null>(() => {
    const detected = this._detected();
    if (!detected) return null;
    return WALLET_OPTIONS.map((option) => ({
      ...option,
      installed: detected.some((w) => w.name() === option.id),
    }));
  });
  readonly networkMismatch = computed(() => {
    const chainId = this._walletChainId();
    return this.connected() && chainId !== null && chainId !== this.networks.config().chainId;
  });
  /** Name of the network the wallet is on, for the mismatch notice. */
  readonly walletNetworkLabel = computed(() => {
    const chainId = this._walletChainId();
    return chainId === null ? '' : (networkByChainId(chainId)?.label ?? 'another network');
  });

  constructor() {
    // Re-read the balance whenever the account or the app's network changes.
    effect(() => {
      this.networks.network();
      if (this._address()) untracked(() => void this.refreshBalance());
    });
  }

  /** Looks for installed wallets (once; pass `force` to look again). */
  async detect(force = false): Promise<void> {
    if (this._detecting() || (this._detected() && !force)) return;
    this._detecting.set(true);
    try {
      this._detected.set(await this.discover());
    } catch (err) {
      console.error('[wallet detection]', err);
      this._detected.set([]);
    } finally {
      this._detecting.set(false);
    }
  }

  async connect(id: WalletId): Promise<boolean> {
    const attempt = ++this.attempt;
    this.stopListening();
    this._error.set(null);
    this._phase.set('connecting');
    this._connectingTo.set(id);
    try {
      await this.detect();
      const wallet = this._detected()?.find((w) => w.name() === id);
      if (!wallet) throw new Error(`${labelOf(id)} is not installed in this browser.`);
      if (!(await wallet.connect())) throw new Error(`${labelOf(id)} refused the connection.`);
      const providers = await wallet.accounts();
      if (!providers.length) throw new Error(`There is no account in ${labelOf(id)}.`);
      const network = await wallet.networkInfos().catch(() => null);
      if (attempt !== this.attempt) return false;

      this.wallet = wallet;
      this.providers = providers;
      this._walletId.set(id);
      this._accounts.set(providers.map(toAccount));
      this._walletChainId.set(network?.chainId ?? null);
      this.setAddress(providers[0].address);
      this._phase.set('connected');
      this.listen(wallet, attempt);
      return true;
    } catch (err) {
      if (attempt !== this.attempt) return false;
      this.reset();
      this._error.set(toUserMessage(err));
      return false;
    } finally {
      if (attempt === this.attempt) this._connectingTo.set(null);
    }
  }

  selectAccount(address: string): void {
    if (this.providers.some((p) => p.address === address)) this.setAddress(address);
  }

  async disconnect(): Promise<void> {
    const wallet = this.wallet;
    this.attempt++;
    this.reset();
    this._error.set(null);
    try {
      await wallet?.disconnect();
    } catch (err) {
      console.error('[wallet disconnect]', err);
    }
  }

  async refreshBalance(): Promise<void> {
    const address = this._address();
    if (!address) return;
    const read = ++this.balanceRead;
    try {
      const balance = await this.reader.masBalance(address);
      if (read === this.balanceRead && address === this._address()) this._balance.set(balance);
    } catch (err) {
      console.error('[balance]', err);
    }
  }

  /** The signing provider of the selected account, for transactions; null when disconnected. */
  signer(): Provider | null {
    const address = this._address();
    return this.providers.find((p) => p.address === address) ?? null;
  }

  private setAddress(address: string): void {
    if (address !== this._address()) this._balance.set(null);
    this._address.set(address);
  }

  /**
   * Follows account and network switches made in the wallet. wallet-provider 3.3 throws "not yet
   * implemented" for account changes in Massa Station and MetaMask: those wallets still work,
   * the account is then picked in the app's wallet menu.
   */
  private listen(wallet: Wallet, attempt: number): void {
    const accounts = subscribe(() =>
      wallet.listenAccountChanges(async (address) => {
        if (attempt !== this.attempt) return;
        if (!this.providers.some((p) => p.address === address)) {
          this.providers = await wallet.accounts();
          if (attempt !== this.attempt) return;
          this._accounts.set(this.providers.map(toAccount));
        }
        this.selectAccount(address);
      }),
    );
    const network = subscribe(() =>
      wallet.listenNetworkChanges((info) => {
        if (attempt === this.attempt) this._walletChainId.set(info.chainId);
      }),
    );
    this.listeners = [accounts, network].filter((l) => !!l);
  }

  private stopListening(): void {
    for (const listener of this.listeners) listener.unsubscribe();
    this.listeners = [];
  }

  private reset(): void {
    this.stopListening();
    this._connectingTo.set(null);
    this.wallet = null;
    this.providers = [];
    this._phase.set('disconnected');
    this._walletId.set(null);
    this._accounts.set([]);
    this._address.set(null);
    this._walletChainId.set(null);
    this._balance.set(null);
  }
}

type Subscription = { unsubscribe(): void } | undefined;

function subscribe(listen: () => Subscription): Subscription {
  try {
    return listen();
  } catch {
    return undefined;
  }
}

function toAccount(provider: Provider): WalletAccount {
  return { address: provider.address, name: provider.accountName };
}

function labelOf(id: WalletId): string {
  return WALLET_OPTIONS.find((o) => o.id === id)?.label ?? id;
}
