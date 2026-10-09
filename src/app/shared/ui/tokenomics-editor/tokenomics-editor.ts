import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import {
  ALLOCATION_DESCRIPTION_MAX,
  AllocationRow,
  MAX_ALLOCATIONS,
  PRESETS,
  PURPOSE_MAX,
  RowErrors,
  TokenomicsPreset,
  chartSlices,
  chartSummary,
  formatBps,
  newRow,
  partColor,
  rowAmounts,
  rowErrors,
  rowsFromPreset,
  shareOf,
} from '../../../core/launchpad/tokenomics';
import { formatUnits } from '../../../core/utils/token-amount';
import { TokenomicsChart } from '../tokenomics-chart/tokenomics-chart';

/**
 * The parts of a token's supply, as rows: purpose, percentage or amount (type one, the other
 * follows from the supply), description, optional address. Used by the launch wizard and by the
 * token page's "Edit tokenomics". The parent decides when the rows can be saved (rowsError).
 */
@Component({
  selector: 'app-tokenomics-editor',
  imports: [TokenomicsChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="editor">
      <div class="rows-col">
        @if (!rows().length) {
          <p class="hint">
            Optional. Split the supply into parts (team, liquidity, community…): the token page
            shows them as a chart. Start from a template or add parts one by one.
          </p>
          <div class="presets">
            @for (preset of presets; track preset.name) {
              <button class="btn btn-ghost btn-sm" type="button" (click)="usePreset(preset)">
                {{ preset.name }}
              </button>
            }
          </div>
        }

        <ol class="rows">
          @for (row of rows(); track row.key; let i = $index) {
            @let errors = errorsOf(i);
            <li
              class="row"
              [class.dragging]="dragged() === i"
              [class.drop-target]="dropTarget() === i && dragged() !== i"
              [style.--part-color]="color(i)"
              (dragover)="dragOver($event, i)"
              (dragleave)="dropTarget.set(null)"
              (drop)="drop($event, i)"
            >
              <button
                class="handle"
                type="button"
                draggable="true"
                [attr.aria-label]="
                  'Move ' + (row.purpose || 'part ' + (i + 1)) + ': drag, or use the arrow keys'
                "
                title="Drag to reorder (or focus and use ↑ ↓)"
                (dragstart)="dragStart($event, i)"
                (dragend)="dragEnd()"
                (keydown.arrowup)="move(i, -1, $event)"
                (keydown.arrowdown)="move(i, 1, $event)"
              >
                ⋮⋮
              </button>
              <div class="fields">
                <label class="field purpose">
                  <span>Purpose</span>
                  <input
                    class="input"
                    [maxLength]="purposeMax"
                    placeholder="Team"
                    [class.invalid]="shows(row, 'purpose') && errors.purpose"
                    [value]="row.purpose"
                    (input)="edit(i, { purpose: text($event) })"
                    (blur)="touch(row, 'purpose')"
                  />
                  @if (shows(row, 'purpose') && errors.purpose; as error) {
                    <span class="error">{{ error }}</span>
                  }
                </label>
                <label class="field share">
                  <span>Percent</span>
                  <input
                    class="input"
                    inputmode="decimal"
                    placeholder="20"
                    [class.invalid]="shows(row, 'share') && errors.share"
                    [value]="percentText(i)"
                    (input)="edit(i, { percent: text($event), source: 'percent' })"
                    (blur)="touch(row, 'share')"
                  />
                </label>
                <label class="field amount">
                  <span>Amount{{ symbol() ? ' (' + symbol() + ')' : '' }}</span>
                  <input
                    class="input"
                    inputmode="decimal"
                    placeholder="200000"
                    [class.invalid]="shows(row, 'share') && errors.share"
                    [value]="amountText(i)"
                    (input)="edit(i, { amount: text($event), source: 'amount' })"
                    (blur)="touch(row, 'share')"
                  />
                </label>
                @if (shows(row, 'share') && errors.share; as error) {
                  <span class="error share-error">{{ error }}</span>
                }
                <label class="field description">
                  <span>Description <span class="muted">(optional)</span></span>
                  <input
                    class="input"
                    [maxLength]="descriptionMax"
                    placeholder="12 months cliff, 24 months vesting"
                    [class.invalid]="shows(row, 'description') && errors.description"
                    [value]="row.description"
                    (input)="edit(i, { description: text($event) })"
                    (blur)="touch(row, 'description')"
                  />
                  @if (shows(row, 'description') && errors.description; as error) {
                    <span class="error">{{ error }}</span>
                  }
                </label>
                <label class="field holder">
                  <span>Held by <span class="muted">(optional address)</span></span>
                  <input
                    class="input mono"
                    placeholder="AU… or AS…"
                    spellcheck="false"
                    [class.invalid]="shows(row, 'holder') && errors.holder"
                    [value]="row.holder"
                    (input)="edit(i, { holder: text($event) })"
                    (blur)="touch(row, 'holder')"
                  />
                  @if (shows(row, 'holder') && errors.holder; as error) {
                    <span class="error">{{ error }}</span>
                  }
                </label>
              </div>
              <div class="row-actions">
                <button
                  class="icon-btn"
                  type="button"
                  [attr.aria-label]="'Remove ' + (row.purpose || 'part ' + (i + 1))"
                  (click)="remove(i)"
                >
                  ✕
                </button>
                <button
                  class="icon-btn touch-only"
                  type="button"
                  aria-label="Move up"
                  [disabled]="i === 0"
                  (click)="move(i, -1)"
                >
                  ↑
                </button>
                <button
                  class="icon-btn touch-only"
                  type="button"
                  aria-label="Move down"
                  [disabled]="i === rows().length - 1"
                  (click)="move(i, 1)"
                >
                  ↓
                </button>
              </div>
            </li>
          }
        </ol>

        <div class="add">
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            [disabled]="rows().length >= maxParts"
            (click)="add()"
          >
            + Add part
          </button>
          @if (rows().length >= maxParts) {
            <span class="hint">{{ maxParts }} parts at most.</span>
          }
        </div>

        @if (rows().length) {
          <div class="bar" [class.over]="over()" [class.full]="full()" aria-live="polite">
            <span class="tabular">
              Allocated {{ allocatedText() }}
              @if (over()) {
                · {{ restText() }} over
              } @else if (!full()) {
                · {{ restText() }} left
              } @else {
                ✓
              }
            </span>
            @if (hasRest()) {
              <button class="btn btn-ghost btn-sm" type="button" (click)="addRest()">
                Add the rest
              </button>
            }
          </div>
        }
      </div>

      @if (rows().length) {
        <app-tokenomics-chart
          class="preview"
          [slices]="slices()"
          [centerValue]="supplyText()"
          [decimals]="decimals()"
          [symbol]="symbol()"
          [summary]="summary()"
          [animate]="false"
          [(active)]="active"
        />
      }
    </div>
  `,
  styles: `
    /* Laid out by its own width: the wizard is narrow, the edit dialog wide. */
    :host {
      display: block;
      container-type: inline-size;
    }
    .editor {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 300px);
      gap: 20px;
      align-items: start;
    }
    .editor:not(:has(.preview)) {
      grid-template-columns: 1fr;
    }
    .rows-col {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .hint {
      margin: 0;
    }
    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .rows {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .rows:empty {
      display: none;
    }
    .row {
      position: relative;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 10px;
      padding: 12px 10px 12px 13px;
      border-radius: var(--radius-md);
      background: var(--bg-elevated);
      border: 1px solid var(--border);
    }
    .row::before {
      content: '';
      position: absolute;
      inset: 10px auto 10px 0;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: var(--part-color);
    }
    .row.dragging {
      opacity: 0.5;
    }
    .row.drop-target {
      border-color: var(--border-strong);
      box-shadow: 0 -2px 0 var(--blue) inset;
    }
    .handle {
      align-self: start;
      margin-top: 24px;
      padding: 6px 4px;
      border: 0;
      border-radius: 6px;
      background: none;
      color: var(--gray-500);
      font-size: 14px;
      letter-spacing: -2px;
      cursor: grab;
    }
    .handle:focus-visible {
      outline: none;
      box-shadow: var(--ring);
    }
    .fields {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.6fr) minmax(0, 1fr);
      gap: 8px 10px;
      min-width: 0;
    }
    .field {
      margin: 0;
    }
    .description {
      grid-column: 1 / 3;
    }
    .share-error {
      grid-column: 2 / -1;
      margin-top: -4px;
    }
    .row-actions {
      display: grid;
      align-content: start;
      gap: 4px;
      margin-top: 20px;
    }
    .touch-only {
      display: none;
    }
    .add {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .bar {
      position: sticky;
      bottom: 0;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 8px 12px;
      padding: 10px 14px;
      border-radius: var(--radius-md);
      background: var(--bg-elevated-2);
      border: 1px solid var(--border-strong);
      font-size: 14px;
    }
    .bar.full {
      color: var(--green);
    }
    .bar.over {
      color: var(--red);
    }
    @media (pointer: coarse) {
      .touch-only {
        display: inline-flex;
      }
    }
    @container (max-width: 819px) {
      .editor {
        grid-template-columns: 1fr;
      }
      .preview {
        max-width: 360px;
        width: 100%;
        margin: 0 auto;
      }
    }
    @container (max-width: 560px) {
      .fields {
        grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
      }
      .purpose,
      .description,
      .holder {
        grid-column: 1 / -1;
      }
      .share-error {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class TokenomicsEditor {
  /** What the parts must add up to, in token units; null while the supply isn't valid. */
  readonly supply = input.required<bigint | null>();
  readonly decimals = input.required<number>();
  readonly symbol = input('');
  /** Show every error now (the parent tried to continue or save). */
  readonly showErrors = input(false);
  readonly rows = model.required<AllocationRow[]>();

  protected readonly presets = PRESETS;
  protected readonly maxParts = MAX_ALLOCATIONS;
  protected readonly purposeMax = PURPOSE_MAX;
  protected readonly descriptionMax = ALLOCATION_DESCRIPTION_MAX;

  protected readonly active = signal<number | null>(null);
  protected readonly dragged = signal<number | null>(null);
  protected readonly dropTarget = signal<number | null>(null);
  private readonly touched = signal(new Set<string>());

  protected readonly amounts = computed(() =>
    rowAmounts(this.rows(), this.supply(), this.decimals()),
  );
  private readonly allocated = computed(() =>
    this.amounts().reduce<bigint>((sum, a) => sum + (a ?? 0n), 0n),
  );
  /** Token units still to allocate (negative when the parts exceed the supply). */
  protected readonly rest = computed(() => (this.supply() ?? 0n) - this.allocated());
  protected readonly over = computed(() => this.rest() < 0n);
  protected readonly hasRest = computed(() => this.rest() > 0n);
  protected readonly full = computed(() => this.supply() !== null && this.rest() === 0n);
  protected readonly allocatedText = computed(() => {
    const supply = this.supply();
    return supply ? formatBps(shareOf(this.allocated(), supply)) : '—';
  });
  protected readonly restText = computed(() => {
    const supply = this.supply();
    const rest = this.rest();
    return supply ? formatBps(shareOf(rest < 0n ? -rest : rest, supply)) : '—';
  });
  protected readonly supplyText = computed(() => {
    const supply = this.supply();
    return supply === null ? '—' : formatUnits(supply, this.decimals());
  });
  private readonly chartParts = computed(() =>
    this.rows().map((row, i) => ({ purpose: row.purpose, amount: this.amounts()[i] ?? 0n })),
  );
  protected readonly slices = computed(() =>
    chartSlices(this.chartParts(), this.supply() ?? undefined),
  );
  protected readonly summary = computed(() => chartSummary(this.chartParts()));

  protected errorsOf(index: number): RowErrors {
    return rowErrors(this.rows()[index], this.amounts()[index]);
  }

  protected color(index: number): string {
    return partColor(index, this.rows().length);
  }

  protected percentText(index: number): string {
    const row = this.rows()[index];
    if (row.source === 'percent') return row.percent;
    const amount = this.amounts()[index];
    const supply = this.supply();
    return amount === null || !supply ? '' : (shareOf(amount, supply) / 100).toFixed(2);
  }

  protected amountText(index: number): string {
    const row = this.rows()[index];
    if (row.source === 'amount') return row.amount;
    const amount = this.amounts()[index];
    return amount === null ? '' : formatUnits(amount, this.decimals());
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected shows(row: AllocationRow, field: string): boolean {
    return this.showErrors() || this.touched().has(`${row.key}:${field}`);
  }

  protected touch(row: AllocationRow, field: string): void {
    this.touched.update((set) => new Set(set).add(`${row.key}:${field}`));
  }

  protected edit(index: number, fields: Partial<AllocationRow>): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...fields } : row)));
  }

  protected add(): void {
    if (this.rows().length >= MAX_ALLOCATIONS) return;
    this.rows.update((rows) => [...rows, newRow()]);
  }

  /** A new part holding what's left, typed as an amount so it stays exact. */
  protected addRest(): void {
    const rest = this.rest();
    if (rest <= 0n || this.rows().length >= MAX_ALLOCATIONS) return;
    this.rows.update((rows) => [
      ...rows,
      newRow({ amount: formatUnits(rest, this.decimals()), source: 'amount' }),
    ]);
  }

  protected remove(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
    this.active.set(null);
  }

  protected usePreset(preset: TokenomicsPreset): void {
    this.rows.set(rowsFromPreset(preset));
  }

  protected move(index: number, by: number, event?: Event): void {
    event?.preventDefault();
    const to = index + by;
    if (to < 0 || to >= this.rows().length) return;
    this.reorder(index, to);
    if (event) {
      // Keep the keyboard on the moved row's handle.
      const handle = event.target as HTMLElement;
      const list = handle.closest('ol');
      queueMicrotask(() => (list?.querySelectorAll<HTMLElement>('.handle')[to] ?? handle).focus());
    }
  }

  protected dragStart(event: DragEvent, index: number): void {
    this.dragged.set(index);
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected dragOver(event: DragEvent, index: number): void {
    if (this.dragged() === null) return;
    event.preventDefault();
    this.dropTarget.set(index);
  }

  protected drop(event: DragEvent, index: number): void {
    event.preventDefault();
    const from = this.dragged();
    if (from !== null && from !== index) this.reorder(from, index);
    this.dragEnd();
  }

  protected dragEnd(): void {
    this.dragged.set(null);
    this.dropTarget.set(null);
  }

  private reorder(from: number, to: number): void {
    this.rows.update((rows) => {
      const next = [...rows];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
  }
}
