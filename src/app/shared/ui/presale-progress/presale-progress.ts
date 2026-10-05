import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { progressPercent } from '../../../core/launchpad/presale-state';
import { Presale } from '../../../core/launchpad/records';
import { MasPipe } from '../../pipes/units-pipe';

/** Raised vs hard cap, with the soft cap marked. */
@Component({
  selector: 'app-presale-progress',
  imports: [MasPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bar"
      role="progressbar"
      [attr.aria-valuenow]="percent()"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span class="fill" [style.width.%]="percent()"></span>
      @if (softAt() > 0 && softAt() < 100) {
        <span class="soft" [style.left.%]="softAt()" title="Soft cap"></span>
      }
    </div>
    <div class="legend">
      <span
        ><strong>{{ presale().raised | mas }}</strong> raised</span
      >
      <span class="muted">{{ percent() }}% of {{ presale().hardCap | mas }}</span>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 8px;
    }

    .bar {
      position: relative;
      height: 10px;
      overflow: visible;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
    }

    .fill {
      display: block;
      height: 100%;
      max-width: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--red), var(--orange));
    }

    .soft {
      position: absolute;
      top: -3px;
      width: 2px;
      height: 16px;
      background: var(--white);
      opacity: 0.7;
    }

    .legend {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 14px;
    }
  `,
})
export class PresaleProgress {
  readonly presale = input.required<Presale>();
  protected readonly percent = computed(() => Math.min(100, progressPercent(this.presale())));
  protected readonly softAt = computed(() => {
    const p = this.presale();
    return p.hardCap === 0n ? 0 : Number((p.softCap * 1_000n) / p.hardCap) / 10;
  });
}
