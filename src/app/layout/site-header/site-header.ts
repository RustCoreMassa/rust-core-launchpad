import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { UpgradeProposal } from '../../core/launchpad/records';
import { NetworkStore } from '../../core/network/network-store';
import { NetworkId } from '../../core/network/networks';
import { WalletStore } from '../../core/wallet/wallet-store';
import { AmountPipe } from '../../shared/pipes/amount-pipe';
import { ShortAddressPipe } from '../../shared/pipes/short-address-pipe';
import { ConnectWalletDialog } from '../connect-wallet-dialog/connect-wallet-dialog';

export const NAV_LINKS = [
  { path: '/tokens', label: 'Tokens' },
  { path: '/collections', label: 'Collections' },
  { path: '/marketplace', label: 'Marketplace' },
  { path: '/presales', label: 'Presales' },
] as const;

@Component({
  selector: 'app-site-header',
  imports: [
    DatePipe,
    RouterLink,
    RouterLinkActive,
    AmountPipe,
    ShortAddressPipe,
    ConnectWalletDialog,
  ],
  templateUrl: './site-header.html',
  styleUrl: './site-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteHeader {
  protected readonly wallet = inject(WalletStore);
  protected readonly networks = inject(NetworkStore);
  protected readonly links = NAV_LINKS;
  protected readonly networkList = this.networks.available;
  /** The wallet is the Launchpad admin (or was offered the role): show the Admin link. */
  protected readonly showAdmin = signal(false);
  private readonly launchpad = inject(LaunchpadReader);
  private adminCheck = 0;
  /**
   * A pending upgrade of the Launchpad's code, shown to everyone on every page during its 72 h
   * delay; null when none.
   */
  protected readonly upgrade = signal<UpgradeProposal | null>(null);
  private upgradeCheck = 0;

  private readonly connectDialog = viewChild.required(ConnectWalletDialog);
  private readonly navMenu = viewChild.required<ElementRef<HTMLElement>>('navMenu');
  private readonly networkMenu = viewChild.required<ElementRef<HTMLElement>>('networkMenu');
  private readonly walletMenu = viewChild.required<ElementRef<HTMLElement>>('walletMenu');

  constructor() {
    effect(() => {
      const address = this.wallet.address();
      this.networks.network();
      const launchpad = this.launchpad.address();
      untracked(() => void this.checkAdmin(address, launchpad));
    });
    effect(() => {
      this.networks.network();
      const launchpad = this.launchpad.address();
      untracked(() => void this.checkUpgrade(launchpad));
    });
  }

  protected openConnect(): void {
    this.connectDialog().open();
  }

  protected selectNetwork(network: NetworkId): void {
    this.networks.select(network);
    hide(this.networkMenu());
  }

  protected selectAccount(address: string): void {
    this.wallet.selectAccount(address);
    hide(this.walletMenu());
  }

  protected async copyAddress(): Promise<void> {
    const address = this.wallet.address();
    if (address) await navigator.clipboard?.writeText(address).catch(() => undefined);
    hide(this.walletMenu());
  }

  protected async disconnect(): Promise<void> {
    hide(this.walletMenu());
    await this.wallet.disconnect();
  }

  protected closeWalletMenu(): void {
    hide(this.walletMenu());
  }

  protected closeNav(): void {
    hide(this.navMenu());
  }

  private async checkAdmin(address: string | null, launchpad: string | null): Promise<void> {
    const check = ++this.adminCheck;
    this.showAdmin.set(false);
    if (!address || !launchpad) return;
    try {
      const allowed = await this.launchpad.isAdminOrOffered(address);
      if (check === this.adminCheck) this.showAdmin.set(allowed);
    } catch {
      // Not critical: the link shows up on the next account or network change.
    }
  }

  private async checkUpgrade(launchpad: string | null): Promise<void> {
    const check = ++this.upgradeCheck;
    this.upgrade.set(null);
    if (!launchpad) return;
    try {
      const upgrade = await this.launchpad.pendingUpgrade();
      if (check === this.upgradeCheck) this.upgrade.set(upgrade);
    } catch {
      // Not critical: checked again on the next network change or reload.
    }
  }
}

function hide(menu: ElementRef<HTMLElement>): void {
  const el = menu.nativeElement;
  if (el.matches?.(':popover-open')) el.hidePopover();
}
