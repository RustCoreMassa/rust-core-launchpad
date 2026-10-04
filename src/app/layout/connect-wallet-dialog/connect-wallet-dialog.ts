import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { WalletId } from '../../core/wallet/wallet-options';
import { WalletStore } from '../../core/wallet/wallet-store';

/** Lists the supported wallets: connect to an installed one, or a link to install it. */
@Component({
  selector: 'app-connect-wallet-dialog',
  templateUrl: './connect-wallet-dialog.html',
  styleUrl: './connect-wallet-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectWalletDialog {
  protected readonly wallet = inject(WalletStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(): void {
    this.dialog().nativeElement.showModal();
    void this.wallet.detect(true);
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected async connect(id: WalletId): Promise<void> {
    if (await this.wallet.connect(id)) this.close();
  }

  /** A click on the backdrop (outside the panel) closes the dialog. */
  protected onDialogClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }
}
