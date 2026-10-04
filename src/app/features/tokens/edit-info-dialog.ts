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
import { EMPTY_INFO, Project, ProjectInfo, writeInfo } from '../../core/launchpad/records';
import { Transactions } from '../../core/launchpad/transactions';
import { toUserMessage } from '../../core/utils/user-error';
import { InfoForm } from '../../shared/ui/info-form/info-form';
import { MasPipe } from '../../shared/pipes/units-pipe';

/** Edits a project's presentation (updateInfo). Only the contract's current owner can save. */
@Component({
  selector: 'app-edit-info-dialog',
  imports: [InfoForm, MasPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="sheet" #dialog aria-labelledby="edit-title">
      @if (project(); as p) {
        <div class="sheet-body">
          <div class="sheet-head">
            <h2 id="edit-title">Edit {{ p.symbol }}</h2>
            <button class="icon-btn" type="button" aria-label="Close" (click)="close()">✕</button>
          </div>
          <p class="hint">
            Name, symbol and supply never change. You pay only the storage difference (up to
            {{ cost | mas }}, the rest is refunded).
          </p>
          <app-info-form
            [kind]="p.kind"
            [symbol]="p.symbol"
            [(info)]="info"
            [(category)]="category"
          />
          @if (error(); as message) {
            <div class="notice notice-error" role="alert">{{ message }}</div>
          }
          <div class="actions">
            <button
              class="btn btn-red"
              type="button"
              [disabled]="!valid() || saving()"
              (click)="save()"
            >
              {{ saving() ? 'Confirm in your wallet…' : 'Save changes' }}
            </button>
            <button class="btn btn-ghost" type="button" (click)="close()">Cancel</button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class EditInfoDialog {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly transactions = inject(Transactions);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly saved = output<Project>();

  protected readonly project = signal<Project | null>(null);
  protected readonly info = signal<ProjectInfo>(EMPTY_INFO);
  protected readonly category = signal(0);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly valid = computed(() => Object.keys(infoErrors(this.info())).length === 0);
  protected readonly cost = recordCost(0n);

  open(project: Project): void {
    this.project.set(project);
    this.info.set({ ...project.info });
    this.category.set(project.category);
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
    this.saving.set(true);
    this.error.set(null);
    try {
      const args = writeInfo(
        new Args().addU8(BigInt(project.kind)).addU64(project.id).addU8(BigInt(this.category())),
        this.info(),
      );
      await this.transactions.send({ target, func: 'updateInfo', args, coins: this.cost });
      this.saved.emit(await this.launchpad.project(project.kind, project.id));
      this.close();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
