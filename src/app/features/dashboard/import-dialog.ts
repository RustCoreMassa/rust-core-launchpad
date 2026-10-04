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
import { CollectionReader } from '../../core/launchpad/collection-reader';
import { recordCost } from '../../core/launchpad/launch-cost';
import { infoErrors } from '../../core/launchpad/launch-rules';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import {
  EMPTY_INFO,
  KIND_TOKEN,
  Project,
  ProjectInfo,
  ProjectKind,
  writeInfo,
} from '../../core/launchpad/records';
import { TokenReader } from '../../core/launchpad/token-reader';
import { Transactions, eventFields } from '../../core/launchpad/transactions';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { InfoForm } from '../../shared/ui/info-form/info-form';
import { royaltyBps } from '../create/collection-draft';

interface Candidate {
  address: string;
  name: string;
  symbol: string;
}

const CONTRACT = /^AS[1-9A-HJ-NP-Za-km-z]{40,60}$/;
const ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;

/**
 * Imports an existing MRC20 token or MRC721 collection the connected wallet owns
 * (docs/ANALYSIS.md, "Import"). The app checks what it can first — standard contract, owner,
 * not listed yet — and the contract checks it all again.
 */
@Component({
  selector: 'app-import-dialog',
  imports: [InfoForm, MasPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="sheet" #dialog aria-labelledby="import-title">
      <div class="sheet-body">
        <div class="sheet-head">
          <h2 id="import-title">Import {{ isToken() ? 'a token' : 'a collection' }}</h2>
          <button class="icon-btn" type="button" aria-label="Close" (click)="close()">✕</button>
        </div>

        @if (!candidate()) {
          <p class="hint">
            @if (isToken()) {
              Already launched an MRC20 token elsewhere? If your wallet is its owner, list it here
              to show it and run a presale.
            } @else {
              Already launched an MRC721 collection elsewhere? If your wallet is its owner, list it
              here to show its NFTs and sell them on the marketplace.
            }
          </p>
          <label class="field">
            <span>Contract address</span>
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
              {{ busy() ? 'Checking…' : 'Check contract' }}
            </button>
          </div>
        } @else {
          @let c = candidate()!;
          <div class="notice">
            <span
              ><strong>{{ c.name }}</strong> ({{ c.symbol }}) — you are the owner.</span
            >
          </div>
          @if (!isToken()) {
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
                <span>Royalty receiver</span>
                <input
                  class="input mono"
                  placeholder="empty = your wallet"
                  [value]="receiver()"
                  (input)="receiver.set(value($event))"
                />
              </label>
            </div>
          }
          <app-info-form
            [kind]="kind()"
            [symbol]="c.symbol"
            [(info)]="info"
            [(category)]="category"
          />
          <p class="hint">
            Import fee {{ fee() | mas }} + storage (up to {{ margin | mas }}, the rest is refunded).
            Imported contracts keep their name and symbol and show an "Imported" badge.
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
              {{ busy() ? 'Confirm in your wallet…' : 'Import' }}
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
export class ImportDialog {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly tokens = inject(TokenReader);
  private readonly collections = inject(CollectionReader);
  private readonly transactions = inject(Transactions);
  private readonly wallet = inject(WalletStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly imported = output<Project>();

  protected readonly kind = signal<ProjectKind>(KIND_TOKEN);
  protected readonly isToken = computed(() => this.kind() === KIND_TOKEN);
  protected readonly address = signal('');
  protected readonly candidate = signal<Candidate | null>(null);
  protected readonly info = signal<ProjectInfo>(EMPTY_INFO);
  protected readonly category = signal(0);
  protected readonly royalty = signal('5');
  protected readonly receiver = signal('');
  protected readonly fee = signal(0n);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly valid = computed(() => {
    if (Object.keys(infoErrors(this.info())).length) return false;
    if (this.isToken()) return true;
    const bps = royaltyBps(this.royalty());
    return (
      bps !== null && bps <= 1_000 && (this.receiver() === '' || ADDRESS.test(this.receiver()))
    );
  });
  protected readonly margin = recordCost(0n);

  open(kind: ProjectKind): void {
    this.kind.set(kind);
    this.address.set('');
    this.candidate.set(null);
    this.info.set({ ...EMPTY_INFO });
    this.category.set(0);
    this.royalty.set('5');
    this.receiver.set('');
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
      if (!CONTRACT.test(address))
        throw new Error('Enter a smart contract address (it starts with AS).');
      if (await this.launchpad.projectByAddress(address))
        throw new Error('This contract is already in the Launchpad.');
      const candidate = this.isToken()
        ? await this.tokenCandidate(address)
        : await this.collectionCandidate(address);
      this.fee.set((await this.launchpad.config()).importFee);
      this.candidate.set(candidate);
    } catch (err) {
      this.error.set(toUserMessage(err));
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
      const head = this.isToken()
        ? new Args().addString(candidate.address).addU8(BigInt(this.category()))
        : new Args()
            .addString(candidate.address)
            .addU16(BigInt(royaltyBps(this.royalty()) ?? 0))
            .addString(this.receiver())
            .addU8(BigInt(this.category()));
      const result = await this.transactions.send({
        target,
        func: this.isToken() ? 'importToken' : 'importCollection',
        args: writeInfo(head, this.info()),
        coins: recordCost(this.fee()),
      });
      const event = this.isToken() ? 'TOKEN_IMPORTED' : 'COLLECTION_IMPORTED';
      const [id] = eventFields(result.events, event) ?? [];
      const project = id
        ? await this.launchpad.project(this.kind(), BigInt(id))
        : await this.launchpad.projectByAddress(candidate.address);
      if (project) this.imported.emit(project);
      this.close();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async tokenCandidate(address: string): Promise<Candidate> {
    let name: string, symbol: string, owner: string;
    try {
      name = await this.tokens.text(address, 'name');
      symbol = await this.tokens.text(address, 'symbol');
      owner = (await this.tokens.state(address)).owner;
    } catch {
      throw new Error('This address is not a standard MRC20 token.');
    }
    this.assertOwner(owner);
    return { address, name, symbol };
  }

  private async collectionCandidate(address: string): Promise<Candidate> {
    const identity = await this.collections.identity(address).catch(() => null);
    if (!identity) throw new Error('This address is not a standard MRC721 collection.');
    this.assertOwner((await this.collections.state(address)).owner);
    return { address, ...identity };
  }

  private assertOwner(owner: string): void {
    if (!owner || owner !== this.wallet.address())
      throw new Error('Only the contract’s owner can import it — connect the owner wallet.');
  }
}
