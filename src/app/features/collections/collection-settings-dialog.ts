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
import { MintInfo } from '../../core/launchpad/collection-reader';
import { recordCost } from '../../core/launchpad/launch-cost';
import { urlError } from '../../core/launchpad/launch-rules';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { settingCoins } from '../../core/launchpad/mint-cost';
import { Project } from '../../core/launchpad/records';
import { Transactions } from '../../core/launchpad/transactions';
import { formatUnits } from '../../core/utils/token-amount';
import { toUserMessage } from '../../core/utils/user-error';
import { maxPerWalletValue, priceNano, royaltyBps } from '../create/collection-draft';

const ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;
type Action = 'mint' | 'uri' | 'freeze' | 'royalty';

/**
 * Owner settings of an RC-Collection: public mint (price, limit, open/closed), the folder link
 * until it's frozen, freezing it, and the royalty (kept in the Launchpad). One transaction each.
 */
@Component({
  selector: 'app-collection-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="sheet" #dialog aria-labelledby="settings-title">
      <div class="sheet-body">
        <div class="sheet-head">
          <h2 id="settings-title">Collection settings</h2>
          <button class="icon-btn" type="button" aria-label="Close" (click)="close()">✕</button>
        </div>
        @if (error(); as message) {
          <div class="notice notice-error" role="alert">{{ message }}</div>
        }

        <section class="group">
          <h3>Public mint</h3>
          @if (baseUri()) {
            <label class="toggle">
              <input type="checkbox" [checked]="open()" (change)="open.set(!open())" />
              <span
                ><strong>Open</strong
                ><span class="hint"> Anyone can mint at this price.</span></span
              >
            </label>
            <div class="form-grid">
              <label class="field">
                <span>Price (MAS)</span>
                <input
                  class="input"
                  inputmode="decimal"
                  [value]="price()"
                  (input)="price.set(value($event))"
                />
              </label>
              <label class="field">
                <span>Limit per wallet</span>
                <input
                  class="input"
                  inputmode="numeric"
                  placeholder="empty = no limit"
                  [value]="perWallet()"
                  (input)="perWallet.set(value($event))"
                />
              </label>
            </div>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              [disabled]="!mintValid() || !!busy()"
              (click)="saveMint()"
            >
              {{ busy() === 'mint' ? 'Confirm in your wallet…' : 'Save mint settings' }}
            </button>
          } @else {
            <p class="hint">A public mint needs a folder link: set one below first.</p>
          }
        </section>

        <section class="group">
          <h3>Metadata folder</h3>
          @if (frozen()) {
            <p class="hint">
              Frozen — the folder link can never change: <span class="mono">{{ baseUri() }}</span>
            </p>
          } @else {
            <label class="field">
              <span>Folder link (base URI)</span>
              <input
                class="input mono"
                [value]="newUri()"
                (input)="newUri.set(value($event))"
                placeholder="ipfs://bafy…/"
              />
              @if (newUri() && uriError(); as error) {
                <span class="error">{{ error }}</span>
              }
            </label>
            <div class="actions">
              <button
                class="btn btn-ghost btn-sm"
                type="button"
                [disabled]="!newUri() || !!uriError() || newUri() === baseUri() || !!busy()"
                (click)="saveUri()"
              >
                {{ busy() === 'uri' ? 'Confirm in your wallet…' : 'Save link' }}
              </button>
              @if (baseUri()) {
                <button
                  class="btn btn-ghost btn-sm"
                  type="button"
                  [disabled]="!!busy()"
                  (click)="confirmFreeze.set(true)"
                >
                  Freeze metadata…
                </button>
              }
            </div>
            @if (confirmFreeze()) {
              <div class="notice">
                <span
                  >Freezing is permanent: nobody, you included, can change the folder link
                  again.</span
                >
                <button
                  class="btn btn-red btn-sm"
                  type="button"
                  [disabled]="!!busy()"
                  (click)="freeze()"
                >
                  {{ busy() === 'freeze' ? 'Confirm…' : 'Freeze' }}
                </button>
              </div>
            }
          }
        </section>

        <section class="group">
          <h3>Royalty</h3>
          <div class="form-grid">
            <label class="field">
              <span>Royalty (%)</span>
              <input
                class="input"
                inputmode="decimal"
                [value]="royalty()"
                (input)="royalty.set(value($event))"
              />
            </label>
            <label class="field">
              <span>Receiver</span>
              <input
                class="input mono"
                [value]="receiver()"
                (input)="receiver.set(value($event))"
              />
            </label>
          </div>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            [disabled]="!royaltyValid() || !!busy()"
            (click)="saveRoyalty()"
          >
            {{ busy() === 'royalty' ? 'Confirm in your wallet…' : 'Save royalty' }}
          </button>
        </section>
      </div>
    </dialog>
  `,
  styles: `
    .group {
      display: grid;
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      justify-items: start;
    }

    .group > * {
      width: 100%;
    }

    .group > .btn {
      width: auto;
    }

    h3 {
      font-size: 16px;
    }
  `,
})
export class CollectionSettingsDialog {
  private readonly transactions = inject(Transactions);
  private readonly launchpad = inject(LaunchpadReader);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** Something changed on-chain; the page re-reads. */
  readonly changed = output<void>();

  private project: Project | null = null;
  protected readonly baseUri = signal('');
  protected readonly frozen = signal(false);
  protected readonly open = signal(false);
  protected readonly price = signal('');
  protected readonly perWallet = signal('');
  protected readonly newUri = signal('');
  protected readonly confirmFreeze = signal(false);
  protected readonly royalty = signal('');
  protected readonly receiver = signal('');
  protected readonly busy = signal<Action | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly mintValid = computed(
    () => priceNano(this.price()) !== null && maxPerWalletValue(this.perWallet()) !== null,
  );
  protected readonly uriError = computed(() => urlError(this.newUri()));
  protected readonly royaltyValid = computed(() => {
    const bps = royaltyBps(this.royalty());
    return bps !== null && bps <= 1_000 && ADDRESS.test(this.receiver());
  });

  openFor(project: Project, mint: MintInfo): void {
    this.project = project;
    this.baseUri.set(mint.baseURI);
    this.frozen.set(mint.frozen);
    this.open.set(mint.publicMint);
    this.price.set(formatUnits(mint.mintPrice, 9).replace(/,/g, ''));
    this.perWallet.set(mint.maxPerWallet ? String(mint.maxPerWallet) : '');
    this.newUri.set(mint.baseURI);
    this.confirmFreeze.set(false);
    this.royalty.set(String(project.royaltyBps / 100));
    this.receiver.set(project.royaltyReceiver);
    this.error.set(null);
    this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value.trim();
  }

  protected saveMint(): Promise<void> {
    return this.run('mint', 'setMintConfig', () =>
      new Args()
        .addU64(priceNano(this.price()) ?? 0n)
        .addU32(BigInt(maxPerWalletValue(this.perWallet()) ?? 0))
        .addBool(this.open()),
    );
  }

  protected async saveUri(): Promise<void> {
    await this.run(
      'uri',
      'setBaseURI',
      () => new Args().addString(this.newUri()),
      settingCoins(this.newUri()),
    );
    if (!this.error()) this.baseUri.set(this.newUri());
  }

  protected async freeze(): Promise<void> {
    await this.run('freeze', 'freezeMetadata', () => new Args());
    if (!this.error()) this.frozen.set(true);
  }

  protected async saveRoyalty(): Promise<void> {
    const project = this.project;
    const target = this.launchpad.address();
    if (!project || !target) return;
    this.busy.set('royalty');
    this.error.set(null);
    try {
      await this.transactions.send({
        target,
        func: 'setRoyalty',
        args: new Args()
          .addU64(project.id)
          .addU16(BigInt(royaltyBps(this.royalty()) ?? 0))
          .addString(this.receiver()),
        coins: recordCost(0n),
      });
      this.changed.emit();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  private async run(
    action: Action,
    func: string,
    args: () => Args,
    coins = settingCoins(),
  ): Promise<void> {
    if (!this.project) return;
    this.busy.set(action);
    this.error.set(null);
    try {
      await this.transactions.send({ target: this.project.address, func, args: args(), coins });
      this.changed.emit();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(null);
    }
  }
}
