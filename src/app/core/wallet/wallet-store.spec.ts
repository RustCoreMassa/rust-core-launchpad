import { TestBed } from '@angular/core/testing';
import type { Network, Provider, PublicProvider } from '@massalabs/massa-web3';
import type { Wallet } from '@massalabs/wallet-provider';
import { PUBLIC_PROVIDER_FACTORY } from '../massa/massa-reader';
import { NetworkStore } from '../network/network-store';
import { NETWORKS } from '../network/networks';
import { KeyValueStore, LOCAL_STORE, memoryStore } from '../platform/storage';
import { WALLET_DISCOVERY, WalletId } from './wallet-options';
import { WalletStore } from './wallet-store';

const ALICE = 'AU1alice';
const BOB = 'AU1bob';

interface FakeWalletOptions {
  accounts?: string[];
  connects?: boolean;
  trusted?: boolean;
  chainId?: bigint;
}

/** Just what WalletStore uses of wallet-provider's Wallet. */
function fakeWallet(id: WalletId, options: FakeWalletOptions = {}) {
  let accountListener: ((address: string) => void) | null = null;
  let networkListener: ((network: Network) => void) | null = null;
  const accounts = options.accounts ?? [ALICE, BOB];
  const wallet = {
    name: () => id,
    connect: vi.fn(async () => options.connects ?? true),
    connected: vi.fn(async () => options.trusted ?? false),
    disconnect: vi.fn(async () => true),
    accounts: vi.fn(async () =>
      accounts.map((address) => ({ address, accountName: `name-${address}` }) as Provider),
    ),
    networkInfos: vi.fn(async () => ({
      name: 'buildnet',
      chainId: options.chainId ?? NETWORKS.buildnet.chainId,
      minimalFee: 0n,
    })),
    listenAccountChanges: (cb: (address: string) => void) => {
      accountListener = cb;
      return { unsubscribe: () => (accountListener = null) };
    },
    listenNetworkChanges: (cb: (network: Network) => void) => {
      networkListener = cb;
      return { unsubscribe: () => (networkListener = null) };
    },
  };
  return {
    wallet: wallet as unknown as Wallet,
    mock: wallet,
    switchAccount: (address: string) => accountListener?.(address),
    switchNetwork: (chainId: bigint) =>
      networkListener?.({ name: 'x', chainId, minimalFee: 0n } as Network),
  };
}

function setup(wallets: Wallet[], store: KeyValueStore = memoryStore()) {
  const balanceOf = vi.fn(async (addresses: string[]) =>
    addresses.map((address) => ({ address, balance: address === ALICE ? 12_345_000_000n : 0n })),
  );
  TestBed.configureTestingModule({
    providers: [
      { provide: LOCAL_STORE, useValue: store },
      { provide: WALLET_DISCOVERY, useValue: async () => wallets },
      {
        provide: PUBLIC_PROVIDER_FACTORY,
        useValue: () => ({ balanceOf }) as unknown as PublicProvider,
      },
    ],
  });
  return { wallets: TestBed.inject(WalletStore), store, balanceOf };
}

describe('WalletStore', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

  it('lists every supported wallet, marking the installed ones', async () => {
    const { wallets } = setup([fakeWallet('BEARBY').wallet]);
    expect(wallets.choices()).toBeNull();
    await wallets.detect();
    expect(wallets.choices()?.map((c) => [c.id, c.installed])).toEqual([
      ['BEARBY', true],
      ['MASSA WALLET', false],
      ['METAMASK', false],
    ]);
  });

  it('connects, selects the first account and reads its balance', async () => {
    const { wallets, store } = setup([fakeWallet('BEARBY').wallet]);
    expect(await wallets.connect('BEARBY')).toBe(true);
    expect(wallets.connected()).toBe(true);
    expect(wallets.address()).toBe(ALICE);
    expect(wallets.accounts().map((a) => a.address)).toEqual([ALICE, BOB]);
    expect(wallets.signer()?.address).toBe(ALICE);
    await wallets.refreshBalance();
    expect(wallets.balance()).toBe(12.345);
    expect(JSON.parse(store.getItem('launchpad.wallet')!)).toEqual({
      wallet: 'BEARBY',
      address: ALICE,
    });
  });

  it('reports a refused connection and changes nothing', async () => {
    const { wallets, store } = setup([fakeWallet('BEARBY', { connects: false }).wallet]);
    expect(await wallets.connect('BEARBY')).toBe(false);
    expect(wallets.connected()).toBe(false);
    expect(wallets.error()).toBe('Bearby refused the connection.');
    expect(store.getItem('launchpad.wallet')).toBeNull();
  });

  it('reports a wallet that is not installed', async () => {
    const { wallets } = setup([]);
    await wallets.connect('MASSA WALLET');
    expect(wallets.error()).toBe('Massa Station is not installed in this browser.');
  });

  it('reports a wallet without accounts', async () => {
    const { wallets } = setup([fakeWallet('BEARBY', { accounts: [] }).wallet]);
    await wallets.connect('BEARBY');
    expect(wallets.error()).toBe('There is no account in Bearby.');
  });

  it('follows account switches made in the wallet', async () => {
    const fake = fakeWallet('BEARBY');
    const { wallets } = setup([fake.wallet]);
    await wallets.connect('BEARBY');
    fake.switchAccount(BOB);
    expect(wallets.address()).toBe(BOB);
    expect(wallets.balance()).toBeNull(); // re-read for the new account, never the old value
  });

  it('only selects accounts the wallet gave', async () => {
    const { wallets } = setup([fakeWallet('BEARBY').wallet]);
    await wallets.connect('BEARBY');
    wallets.selectAccount('AU1stranger');
    expect(wallets.address()).toBe(ALICE);
  });

  it('flags a wallet on another network than the app', async () => {
    const fake = fakeWallet('BEARBY', { chainId: NETWORKS.mainnet.chainId });
    const { wallets } = setup([fake.wallet]);
    await wallets.connect('BEARBY');
    expect(wallets.networkMismatch()).toBe(true);
    expect(wallets.walletNetworkLabel()).toBe('Mainnet');
    TestBed.inject(NetworkStore).select('mainnet');
    expect(wallets.networkMismatch()).toBe(false);
    fake.switchNetwork(NETWORKS.buildnet.chainId);
    expect(wallets.networkMismatch()).toBe(true);
  });

  it('reconnects on start only to a wallet that still trusts the site', async () => {
    const store = memoryStore();
    store.setItem('launchpad.wallet', JSON.stringify({ wallet: 'BEARBY', address: BOB }));
    const trusted = fakeWallet('BEARBY', { trusted: true });
    const { wallets } = setup([trusted.wallet], store);
    await wallets.restore();
    expect(wallets.address()).toBe(BOB);

    TestBed.resetTestingModule();
    const untrusted = fakeWallet('BEARBY', { trusted: false });
    const second = setup([untrusted.wallet], store).wallets;
    await second.restore();
    expect(second.connected()).toBe(false);
    expect(untrusted.mock.connect).not.toHaveBeenCalled();
  });

  it('ignores a corrupt saved wallet', async () => {
    const store = memoryStore();
    store.setItem('launchpad.wallet', '{not json');
    const fake = fakeWallet('BEARBY', { trusted: true });
    const { wallets } = setup([fake.wallet], store);
    await wallets.restore();
    expect(wallets.connected()).toBe(false);
  });

  it('disconnects and forgets the wallet', async () => {
    const fake = fakeWallet('BEARBY');
    const { wallets, store } = setup([fake.wallet]);
    await wallets.connect('BEARBY');
    await wallets.disconnect();
    expect(wallets.connected()).toBe(false);
    expect(wallets.signer()).toBeNull();
    expect(store.getItem('launchpad.wallet')).toBeNull();
    expect(fake.mock.disconnect).toHaveBeenCalled();
    fake.switchAccount(BOB); // listeners are gone
    expect(wallets.address()).toBeNull();
  });
});
