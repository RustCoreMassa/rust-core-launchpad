import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NetworkStore } from '../../core/network/network-store';
import { NETWORKS, NetworkId } from '../../core/network/networks';
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
  imports: [RouterLink, RouterLinkActive, AmountPipe, ShortAddressPipe, ConnectWalletDialog],
  templateUrl: './site-header.html',
  styleUrl: './site-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteHeader {
  protected readonly wallet = inject(WalletStore);
  protected readonly networks = inject(NetworkStore);
  protected readonly links = NAV_LINKS;
  protected readonly networkList = Object.values(NETWORKS);

  private readonly connectDialog = viewChild.required(ConnectWalletDialog);
  private readonly navMenu = viewChild.required<ElementRef<HTMLElement>>('navMenu');
  private readonly networkMenu = viewChild.required<ElementRef<HTMLElement>>('networkMenu');
  private readonly walletMenu = viewChild.required<ElementRef<HTMLElement>>('walletMenu');

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
}

function hide(menu: ElementRef<HTMLElement>): void {
  const el = menu.nativeElement;
  if (el.matches?.(':popover-open')) el.hidePopover();
}
