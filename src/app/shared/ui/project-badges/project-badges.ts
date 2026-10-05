import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Project, SOURCE_IMPORTED } from '../../../core/launchpad/records';

/**
 * Trust badges: verified, imported, mutable / immutable code and — once checked against the
 * chain — original or modified code.
 */
@Component({
  selector: 'app-project-badges',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (project().verified) {
      <span class="badge good" title="Checked by the RustCore team">Verified</span>
    }
    @if (project().source === imported) {
      <span class="badge" title="Existing contract imported by its owner">Imported</span>
    } @else if (project().mutable) {
      <span class="badge warn" title="The owner can replace this contract's code"
        >Mutable code</span
      >
    } @else {
      <span class="badge" title="This contract's code can never change">Immutable</span>
    }
    @if (codeModified() === true) {
      <span class="badge bad" title="The code differs from what was launched">Code modified</span>
    } @else if (codeModified() === false && showOriginal()) {
      <span class="badge good" title="The code is the one launched">Original code</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .badge {
      padding: 3px 9px;
      border-radius: 999px;
      border: 1px solid var(--border-strong);
      background: rgba(255, 255, 255, 0.04);
      color: var(--gray-300);
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .good {
      border-color: rgba(51, 209, 122, 0.35);
      background: rgba(51, 209, 122, 0.1);
      color: #7ee2a8;
    }

    .warn {
      border-color: rgba(255, 201, 77, 0.35);
      background: rgba(255, 201, 77, 0.08);
      color: #ffe1a0;
    }

    .bad {
      border-color: rgba(255, 45, 66, 0.4);
      background: rgba(255, 45, 66, 0.1);
      color: #ff9aa5;
    }
  `,
})
export class ProjectBadges {
  readonly project = input.required<Project>();
  /** null = not checked (lists); true/false once the current bytecode was compared. */
  readonly codeModified = input<boolean | null>(null);
  readonly showOriginal = input(false);
  protected readonly imported = SOURCE_IMPORTED;
}
