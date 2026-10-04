import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Args, StorageCost } from '@massalabs/massa-web3';
import { parseSupply } from '../../core/launchpad/launch-rules';
import { Project } from '../../core/launchpad/records';
import { Transactions } from '../../core/launchpad/transactions';
import { MassaReader } from '../../core/massa/massa-reader';
import { formatUnits } from '../../core/utils/token-amount';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';

/** Mints new tokens (owner only, mintable tokens only, up to the max supply). */
@Component({
  selector: 'app-mint-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="sheet" #dialog aria-labelledby="mint-title">
      @if (project(); as p) {
        <div class="sheet-body">
          <div class="sheet-head">
            <h2 id="mint-title">Mint {{ p.symbol }}</h2>
            <button class="icon-btn" type="button" aria-label="Close" (click)="close()">✕</button>
          </div>
          <p class="hint">Up to {{ room() }} {{ p.symbol }} can still be minted.</p>
          <label class="field">
            <span>Amount</span>
            <input
              class="input"
              inputmode="decimal"
              [value]="amount()"
              (input)="amount.set(value($event))"
            />
            @if (amountError(); as error) {
              <span class="error">{{ error }}</span>
            }
          </label>
          <label class="field">
            <span>Recipient</span>
            <input
              class="input mono"
              [value]="recipient()"
              (input)="recipient.set(value($event).trim())"
            />
          </label>
          @if (error(); as message) {
            <div class="notice notice-error" role="alert">{{ message }}</div>
          }
          <div class="actions">
            <button
              class="btn btn-red"
              type="button"
              [disabled]="!!amountError() || !recipient() || busy()"
              (click)="mint()"
            >
              {{ busy() ? 'Confirm in your wallet…' : 'Mint' }}
            </button>
            <button class="btn btn-ghost" type="button" (click)="close()">Cancel</button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class MintDialog {
  private readonly transactions = inject(Transactions);
  private readonly reader = inject(MassaReader);
  private readonly wallet = inject(WalletStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly minted = output<void>();

  protected readonly project = signal<Project | null>(null);
  /** max supply − current supply, in smallest units. */
  private readonly roomUnits = signal(0n);
  protected readonly amount = signal('');
  protected readonly recipient = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly room = computed(() =>
    formatUnits(this.roomUnits(), this.project()?.decimals ?? 0),
  );
  private readonly units = computed(() =>
    parseSupply(this.amount(), this.project()?.decimals ?? 0),
  );
  protected readonly amountError = computed(() => {
    const units = this.units();
    if (units === null) return this.amount() ? 'Enter a number.' : 'Enter an amount.';
    if (units <= 0n) return 'Must be greater than zero.';
    if (units > this.roomUnits()) return 'Above the max supply.';
    return null;
  });

  open(project: Project, room: bigint): void {
    this.project.set(project);
    this.roomUnits.set(room);
    this.amount.set('');
    this.recipient.set(this.wallet.address() ?? '');
    this.error.set(null);
    this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async mint(): Promise<void> {
    const project = this.project();
    const units = this.units();
    if (!project || units === null) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      // Storage for a new holder's balance entry; 0 when the recipient already holds some.
      const coins = await StorageCost.MRC20BalanceCreationCost(
        this.reader.provider(),
        project.address,
        this.recipient(),
      );
      await this.transactions.send({
        target: project.address,
        func: 'mint',
        args: new Args().addString(this.recipient()).addU256(units),
        coins,
      });
      this.minted.emit();
      this.close();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
