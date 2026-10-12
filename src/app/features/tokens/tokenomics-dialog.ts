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
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { Allocation, Project, Tokenomics, writeAllocations } from '../../core/launchpad/records';
import {
  AllocationRow,
  rowsError,
  rowsFromAllocations,
  rowsToAllocations,
  tokenomicsCost,
} from '../../core/launchpad/tokenomics';
import { Transactions } from '../../core/launchpad/transactions';
import { toUserMessage } from '../../core/utils/user-error';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { TokenomicsEditor } from '../../shared/ui/tokenomics-editor/tokenomics-editor';

/** Declares, edits or removes a token's tokenomics (setTokenomics). Token owner only. */
@Component({
  selector: 'app-tokenomics-dialog',
  imports: [MasPipe, TokenomicsEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="sheet wide" #dialog aria-labelledby="tokenomics-dialog-title">
      @if (project(); as p) {
        <div class="sheet-body">
          <div class="sheet-head">
            <h2 id="tokenomics-dialog-title">{{ existing() ? 'Edit' : 'Add' }} tokenomics</h2>
            <button class="icon-btn" type="button" aria-label="Close" (click)="close()">✕</button>
          </div>
          <p class="hint">
            The parts must add up to 100% of {{ baseLabel() }}. You pay only the storage (up to
            {{ cost() | mas }}, the rest is refunded; a shorter list gives storage back).
          </p>
          <app-tokenomics-editor
            [supply]="supply()"
            [decimals]="p.decimals"
            [symbol]="p.symbol"
            [showErrors]="tried()"
            [(rows)]="rows"
          />
          @if (tried() && problem(); as message) {
            <p class="error">{{ message }}</p>
          }
          @if (error(); as message) {
            <div class="notice notice-error" role="alert">{{ message }}</div>
          }
          <div class="actions">
            <button class="btn btn-red" type="button" [disabled]="busy()" (click)="save()">
              {{ busy() ? 'Confirm in your wallet…' : saveLabel() }}
            </button>
            <button class="btn btn-ghost" type="button" (click)="close()">Cancel</button>
          </div>
        </div>
      }
    </dialog>
  `,
  styles: `
    dialog.wide {
      width: min(980px, calc(100vw - 2 * var(--gutter)));
    }
  `,
})
export class TokenomicsDialog {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly transactions = inject(Transactions);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** The new declaration, or null once removed. */
  readonly saved = output<Tokenomics | null>();

  protected readonly project = signal<Project | null>(null);
  protected readonly existing = signal<Tokenomics | null>(null);
  protected readonly supply = signal<bigint | null>(null);
  protected readonly mintable = signal(false);
  protected readonly rows = signal<AllocationRow[]>([]);
  protected readonly tried = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly baseLabel = computed(() =>
    this.mintable() ? 'the max supply' : 'the total supply',
  );
  protected readonly problem = computed(() => {
    const project = this.project();
    return project ? rowsError(this.rows(), this.supply(), project.decimals) : null;
  });
  private readonly allocations = computed<Allocation[]>(() => {
    const project = this.project();
    if (!project) return [];
    return rowsToAllocations(this.rows(), this.supply(), project.decimals) ?? [];
  });
  protected readonly cost = computed(() => tokenomicsCost(this.allocations()));
  protected readonly saveLabel = computed(() =>
    this.rows().length || !this.existing() ? 'Save tokenomics' : 'Remove tokenomics',
  );

  /** `supply` is what the parts must add up to (baseSupply). */
  open(project: Project, existing: Tokenomics | null, supply: bigint, mintable: boolean): void {
    this.project.set(project);
    this.existing.set(existing);
    this.supply.set(supply);
    this.mintable.set(mintable);
    this.rows.set(existing ? rowsFromAllocations(existing.allocations, project.decimals) : []);
    this.tried.set(false);
    this.error.set(null);
    this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected async save(): Promise<void> {
    const project = this.project();
    const target = this.launchpad.address();
    if (!project || !target) return;
    this.tried.set(true);
    if (this.problem()) return;
    if (!this.rows().length && !this.existing()) {
      this.close();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const args = writeAllocations(new Args().addU64(project.id), this.allocations());
      await this.transactions.send({ target, func: 'setTokenomics', args, coins: this.cost() });
      this.saved.emit(await this.launchpad.tokenomics(project.id));
      this.close();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
