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
import { Args } from '@massalabs/massa-web3';
import { urlError } from '../../core/launchpad/launch-rules';
import { mintWithUriCoins, nftStorage } from '../../core/launchpad/mint-cost';
import { Transactions } from '../../core/launchpad/transactions';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { MasPipe } from '../../shared/pipes/units-pipe';

const ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;
const MAX_BATCH = 50;

/**
 * Owner mint: a batch with the folder's metadata (ownerMint), or — when the collection has no
 * folder link — one NFT with its own metadata link (ownerMintWithURI).
 */
@Component({
  selector: 'app-owner-mint-dialog',
  imports: [MasPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="sheet" #dialog aria-labelledby="owner-mint-title">
      <div class="sheet-body">
        <div class="sheet-head">
          <h2 id="owner-mint-title">Mint NFTs</h2>
          <button class="icon-btn" type="button" aria-label="Close" (click)="close()">✕</button>
        </div>
        <p class="hint">
          {{ room() }} can still be minted. Minting as the owner is free; you send only the storage.
        </p>

        @if (withUri()) {
          <label class="field">
            <span>Metadata link of this NFT</span>
            <input
              class="input mono"
              placeholder="ipfs://…/meta.json"
              [value]="uri()"
              (input)="uri.set(value($event))"
            />
            @if (uriError(); as error) {
              <span class="error">{{ error }}</span>
            }
          </label>
        } @else {
          <label class="field">
            <span>How many (1-{{ maxCount() }})</span>
            <input class="input" inputmode="numeric" [value]="count()" (input)="setCount($event)" />
          </label>
        }
        <label class="field">
          <span>Recipient</span>
          <input class="input mono" [value]="to()" (input)="to.set(value($event))" />
          @if (to() && !validTo()) {
            <span class="error">Enter a Massa address.</span>
          }
        </label>
        <p class="hint">
          Storage sent: {{ coins() | mas }}. What isn't used stays in the collection for later
          transfers.
        </p>
        @if (error(); as message) {
          <div class="notice notice-error" role="alert">{{ message }}</div>
        }
        <div class="actions">
          <button class="btn btn-red" type="button" [disabled]="!canMint()" (click)="mint()">
            {{ busy() ? 'Confirm in your wallet…' : 'Mint' }}
          </button>
          <button class="btn btn-ghost" type="button" (click)="close()">Cancel</button>
        </div>
      </div>
    </dialog>
  `,
})
export class OwnerMintDialog {
  private readonly transactions = inject(Transactions);
  private readonly wallet = inject(WalletStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly minted = output<void>();

  private readonly collection = signal('');
  protected readonly withUri = signal(false);
  private readonly remaining = signal(0);
  protected readonly count = signal(1);
  protected readonly uri = signal('');
  protected readonly to = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly maxCount = computed(() => Math.min(MAX_BATCH, this.remaining()));
  protected readonly room = computed(
    () => `${this.remaining()} NFT${this.remaining() === 1 ? '' : 's'}`,
  );
  protected readonly validTo = computed(() => ADDRESS.test(this.to()));
  protected readonly uriError = computed(() =>
    this.uri() === '' ? null : (urlError(this.uri()) ?? null),
  );
  protected readonly coins = computed(() =>
    this.withUri() ? mintWithUriCoins(this.uri()) : nftStorage(this.count()),
  );
  protected readonly canMint = computed(
    () =>
      !this.busy() &&
      this.validTo() &&
      this.remaining() > 0 &&
      (this.withUri()
        ? this.uri() !== '' && !this.uriError()
        : this.count() >= 1 && this.count() <= this.maxCount()),
  );

  /** `remaining` = max supply − minted; `withUri` when the collection has no base URI. */
  open(collection: string, remaining: number, withUri: boolean): void {
    this.collection.set(collection);
    this.remaining.set(remaining);
    this.withUri.set(withUri);
    this.count.set(1);
    this.uri.set('');
    this.to.set(this.wallet.address() ?? '');
    this.error.set(null);
    this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value.trim();
  }

  protected setCount(event: Event): void {
    const n = Number(this.value(event));
    this.count.set(Number.isInteger(n) ? n : 0);
  }

  protected async mint(): Promise<void> {
    if (!this.canMint()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const args = this.withUri()
        ? new Args().addString(this.to()).addString(this.uri())
        : new Args().addString(this.to()).addU32(BigInt(this.count()));
      await this.transactions.send({
        target: this.collection(),
        func: this.withUri() ? 'ownerMintWithURI' : 'ownerMint',
        args,
        coins: this.coins(),
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
