import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HolderDiscountStore } from '../../../core/launchpad/holder-discount';

/**
 * Next to a Launchpad fee: the discount the connected wallet gets as a holder of the RustCore
 * collection, or how to get it. Nothing while there is no discount on this network.
 */
@Component({
  selector: 'app-holder-discount-note',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (discount.program(); as program) {
      @if (discount.bps(); as bps) {
        <p class="note held">
          You hold a
          <a [routerLink]="['/collections', program.collection]">RustCore NFT</a>: {{ bps / 100 }}%
          off the Launchpad fee.
        </p>
      } @else {
        <p class="note">
          Holders of a
          <a [routerLink]="['/collections', program.collection]">RustCore NFT</a> get
          {{ program.bps / 100 }}% off Launchpad fees.
        </p>
      }
    }
  `,
  styles: `
    .note {
      margin: 8px 0 0;
      color: var(--gray-300);
      font-size: 13px;
    }
    .held {
      color: var(--green);
    }
    a {
      color: inherit;
      text-decoration: underline;
    }
  `,
})
export class HolderDiscountNote {
  protected readonly discount = inject(HolderDiscountStore);
}
