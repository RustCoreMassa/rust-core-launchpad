import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WalletStore } from '../wallet/wallet-store';
import { lessDiscount, lessDiscountBps } from './discount';
import { HolderDiscountStore } from './holder-discount';
import { launchCost } from './launch-cost';
import { LaunchpadReader } from './launchpad-reader';

const MAS = 1_000_000_000n;
const PASS = 'AS12qtY6289wWKz19dXn2GtPuKKAt8KnkG9XZAjotaWEVRjMhrN3e';
const HOLDER = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';

describe('holder discount', () => {
  it('takes the discount off like the contract (rounded down)', () => {
    expect(lessDiscount(100n * MAS, 1_000)).toBe(90n * MAS);
    expect(lessDiscount(9_999n, 1_000)).toBe(9_000n);
    expect(lessDiscount(18_446_744_073_709_551_615n, 5_000)).toBe(9_223_372_036_854_775_808n);
    expect(lessDiscount(50n * MAS, 0)).toBe(50n * MAS);
    expect(lessDiscountBps(200, 1_000)).toBe(180);
    expect(lessDiscountBps(100, 1_000)).toBe(90);
    expect(lessDiscountBps(15, 1_000)).toBe(14);
    expect(lessDiscountBps(1_000, 5_000)).toBe(500);
  });

  it('discounts only the fee of a launch, never the deposit or storage', () => {
    const full = launchCost(100n * MAS, MAS / 10n, 1_000);
    const held = launchCost(100n * MAS, MAS / 10n, 1_000, 1_000);
    expect(held.fee).toBe(90n * MAS);
    expect(held.fullFee).toBe(100n * MAS);
    expect(held.discountBps).toBe(1_000);
    expect(held.contract).toBe(full.contract);
    expect(held.deposit).toBe(full.deposit);
    expect(full.total - held.total).toBe(10n * MAS);
  });
});

describe('HolderDiscountStore', () => {
  function setup(version: string, holds: boolean, address: string | null = HOLDER) {
    const holderDiscount = vi.fn(async () =>
      version >= '1.4.0' ? { collection: PASS, bps: 1_000 } : null,
    );
    const discountFor = vi.fn(async () => (holds ? 1_000 : 0));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LaunchpadReader,
          useValue: { address: signal('AS1launchpad'), holderDiscount, discountFor },
        },
        { provide: WalletStore, useValue: { address: signal(address) } },
      ],
    });
    return { store: TestBed.inject(HolderDiscountStore), discountFor };
  }

  it('knows the program and the connected holder’s discount', async () => {
    const { store } = setup('1.4.0', true);
    await store.refresh();
    expect(store.program()).toEqual({ collection: PASS, bps: 1_000 });
    expect(store.bps()).toBe(1_000);
  });

  it('gives nothing to a wallet without the NFT', async () => {
    const { store } = setup('1.4.0', false);
    await store.refresh();
    expect(store.program()).not.toBeNull();
    expect(store.bps()).toBe(0);
  });

  it('asks nothing for a disconnected wallet, or on a Launchpad without the program', async () => {
    const disconnected = setup('1.4.0', true, null);
    await disconnected.store.refresh();
    expect(disconnected.store.bps()).toBe(0);
    expect(disconnected.discountFor).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const old = setup('1.3.1', true);
    await old.store.refresh();
    expect(old.store.program()).toBeNull();
    expect(old.store.bps()).toBe(0);
    expect(old.discountFor).not.toHaveBeenCalled();
  });
});
