import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { WalletStore } from '../wallet/wallet-store';
import { LaunchpadReader } from './launchpad-reader';
import { HolderDiscount } from './records';

/**
 * The holder discount (Launchpad v1.4.0): the program (which collection, how much) and what the
 * connected wallet gets now. Reloaded when the account or the network changes; pages showing a
 * fee call `refresh()` right before, since an NFT can change hands at any time.
 */
@Injectable({ providedIn: 'root' })
export class HolderDiscountStore {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly wallet = inject(WalletStore);

  private readonly _program = signal<HolderDiscount | null>(null);
  private readonly _bps = signal(0);
  private run = 0;

  /** Null when there is no discount on this network (or it isn't known yet). */
  readonly program = this._program.asReadonly();
  /** The connected wallet's discount on the platform fees, basis points; 0 when none. */
  readonly bps = this._bps.asReadonly();

  constructor() {
    effect(() => {
      this.wallet.address();
      this.launchpad.address();
      untracked(() => void this.refresh());
    });
  }

  async refresh(): Promise<void> {
    const run = ++this.run;
    const address = this.wallet.address();
    let program: HolderDiscount | null = null;
    let bps = 0;
    try {
      if (this.launchpad.address()) program = await this.launchpad.holderDiscount();
      if (program && address) bps = await this.launchpad.discountFor(address);
    } catch {
      // Unknown means no discount shown; the contract decides the real fee anyway.
    }
    if (run !== this.run) return;
    this._program.set(program);
    this._bps.set(bps);
  }
}
