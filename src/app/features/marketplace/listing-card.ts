import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NftMetadata, NftMetadataQueue } from '../../core/launchpad/nft-metadata';
import { Listing } from '../../core/launchpad/records';
import { MasPipe } from '../../shared/pipes/units-pipe';

/** One listing: the NFT's image and name (loaded through the shared queue) and its price. */
@Component({
  selector: 'app-listing-card',
  imports: [RouterLink, MasPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      class="card nft"
      [routerLink]="['/collections', listing().collection, listing().tokenId.toString()]"
    >
      <div class="image">
        @if (meta() === undefined) {
          <span class="skeleton fill"></span>
        } @else if (meta()?.image) {
          <img [src]="meta()!.image" alt="" loading="lazy" referrerpolicy="no-referrer" />
        } @else {
          <span class="no-image">#{{ listing().tokenId }}</span>
        }
      </div>
      <div class="caption">
        <span class="muted collection">{{ collectionName() }}</span>
        <strong>{{ meta()?.name || '#' + listing().tokenId }}</strong>
        <span class="price">{{ listing().price | mas }}</span>
      </div>
    </a>
  `,
  styles: `
    .nft {
      display: grid;
      gap: 10px;
      padding: 10px;
    }

    .image {
      display: grid;
      place-items: center;
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: var(--radius-md);
      background: var(--bg-elevated-2);
    }

    .image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .fill {
      width: 100%;
      height: 100%;
    }

    .no-image {
      color: var(--gray-500);
      font: 700 22px/1 var(--font-display);
    }

    .caption {
      display: grid;
      gap: 2px;
      min-width: 0;
      padding: 0 4px 4px;
    }

    .caption > * {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .collection {
      font-size: 12px;
    }

    .price {
      margin-top: 4px;
      font: 700 16px/1.2 var(--font-display);
    }
  `,
})
export class ListingCard {
  private readonly queue = inject(NftMetadataQueue);

  readonly listing = input.required<Listing>();
  readonly collectionName = input('');

  /** undefined = loading, null = unusable. */
  protected readonly meta = signal<NftMetadata | null | undefined>(undefined);

  constructor() {
    effect(() => {
      const { collection, tokenId } = this.listing();
      untracked(() => {
        this.meta.set(undefined);
        void this.queue.get(collection, tokenId).then((meta) => this.meta.set(meta));
      });
    });
  }
}
