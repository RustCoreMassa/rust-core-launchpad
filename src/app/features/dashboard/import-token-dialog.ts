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
import { recordCost } from '../../core/launchpad/launch-cost';
import { infoErrors } from '../../core/launchpad/launch-rules';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import {
  EMPTY_INFO,
  KIND_TOKEN,
  Project,
  ProjectInfo,
  writeInfo,
} from '../../core/launchpad/records';
import { TokenReader } from '../../core/launchpad/token-reader';
import { Transactions, eventFields } from '../../core/launchpad/transactions';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { InfoForm } from '../../shared/ui/info-form/info-form';

interface Candidate {
  address: string;
  name: string;
  symbol: string;
}

/**
 * Imports an existing MRC20 token the connected wallet owns (docs/ANALYSIS.md, "Import"). The
 * app checks what it can first — standard token, owner, not listed yet — and the contract checks
 * it all again.
 */
@Component({
  selector: 'app-import-token-dialog',
  imports: [InfoForm, MasPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="sheet" #dialog aria-labelledby="import-title">
      <div class="sheet-body">
        <div class="sheet-head">
          <h2 id="import-title">Import a token</h2>
          <button class="icon-btn" type="button" aria-label="Close" (click)="close()">✕</button>
        </div>

        @if (!candidate()) {
          <p class="hint">
            Already launched an MRC20 token elsewhere? If your wallet is its owner, list it here to
            show it and run a presale.
          </p>
          <label class="field">
            <span>Token contract address</span>
            <input
              class="input mono"
              placeholder="AS1…"
              [value]="address()"
              (input)="address.set(value($event))"
            />
          </label>
          @if (error(); as message) {
            <div class="notice notice-error" role="alert">{{ message }}</div>
          }
          <div class="actions">
            <button
              class="btn btn-red"
              type="button"
              [disabled]="!address() || busy()"
              (click)="check()"
            >
              {{ busy() ? 'Checking…' : 'Check token' }}
            </button>
          </div>
        } @else {
          @let c = candidate()!;
          <div class="notice">
            <span
              ><strong>{{ c.name }}</strong> ({{ c.symbol }}) — you are the owner.</span
            >
          </div>
          <app-info-form [symbol]="c.symbol" [(info)]="info" [(category)]="category" />
          <p class="hint">
            Import fee {{ fee() | mas }} + storage (up to {{ margin | mas }}, the rest is refunded).
            Imported tokens keep their symbol and show an "Imported" badge.
          </p>
          @if (error(); as message) {
            <div class="notice notice-error" role="alert">{{ message }}</div>
          }
          <div class="actions">
            <button
              class="btn btn-red"
              type="button"
              [disabled]="!valid() || busy()"
              (click)="submit()"
            >
              {{ busy() ? 'Confirm in your wallet…' : 'Import token' }}
            </button>
            <button
              class="btn btn-ghost"
              type="button"
              [disabled]="busy()"
              (click)="candidate.set(null)"
            >
              Back
            </button>
          </div>
        }
      </div>
    </dialog>
  `,
})
export class ImportTokenDialog {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly tokens = inject(TokenReader);
  private readonly transactions = inject(Transactions);
  private readonly wallet = inject(WalletStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly imported = output<Project>();

  protected readonly address = signal('');
  protected readonly candidate = signal<Candidate | null>(null);
  protected readonly info = signal<ProjectInfo>(EMPTY_INFO);
  protected readonly category = signal(0);
  protected readonly fee = signal(0n);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly valid = computed(() => Object.keys(infoErrors(this.info())).length === 0);
  protected readonly margin = recordCost(0n);

  open(): void {
    this.address.set('');
    this.candidate.set(null);
    this.info.set({ ...EMPTY_INFO });
    this.category.set(0);
    this.error.set(null);
    this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value.trim();
  }

  protected async check(): Promise<void> {
    const address = this.address();
    this.busy.set(true);
    this.error.set(null);
    try {
      if (!/^AS[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(address))
        throw new Error('Enter a smart contract address (it starts with AS).');
      if (await this.launchpad.projectByAddress(address))
        throw new Error('This contract is already in the Launchpad.');
      const [name, symbol, state, config] = [
        await this.tokens.text(address, 'name'),
        await this.tokens.text(address, 'symbol'),
        await this.tokens.state(address),
        await this.launchpad.config(),
      ];
      if (!state.owner || state.owner !== this.wallet.address())
        throw new Error('Only the token’s owner can import it — connect the owner wallet.');
      this.fee.set(config.importFee);
      this.candidate.set({ address, name, symbol });
    } catch (err) {
      this.error.set(
        err instanceof Error && /readonly call|VM Error|not found/i.test(err.message)
          ? 'This address is not a standard MRC20 token.'
          : toUserMessage(err),
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async submit(): Promise<void> {
    const candidate = this.candidate();
    const target = this.launchpad.address();
    if (!candidate || !target) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const args = writeInfo(
        new Args().addString(candidate.address).addU8(BigInt(this.category())),
        this.info(),
      );
      const result = await this.transactions.send({
        target,
        func: 'importToken',
        args,
        coins: recordCost(this.fee()),
      });
      const [id] = eventFields(result.events, 'TOKEN_IMPORTED') ?? [];
      const project = id
        ? await this.launchpad.project(KIND_TOKEN, BigInt(id))
        : await this.launchpad.projectByAddress(candidate.address);
      if (project) this.imported.emit(project);
      this.close();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
