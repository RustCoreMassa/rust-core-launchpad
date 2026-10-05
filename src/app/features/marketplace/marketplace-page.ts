import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CollectionReader } from '../../core/launchpad/collection-reader';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { ProjectStore } from '../../core/launchpad/project-store';
import { KIND_COLLECTION, Listing } from '../../core/launchpad/records';
import { NetworkStore } from '../../core/network/network-store';
import { toUserMessage } from '../../core/utils/user-error';
import { priceNano } from '../create/collection-draft';
import { ListingCard } from './listing-card';

type Sort = 'low' | 'high' | 'newest';
const STEP = 24;

/**
 * Every NFT for sale in Launchpad collections (docs/ANALYSIS.md, "Marketplace NFT"). Stale
 * listings (NFT moved, approval withdrawn, expired) are hidden. Search, price range and sort run
 * in the browser.
 */
@Component({
  selector: 'app-marketplace-page',
  imports: [ListingCard],
  templateUrl: './marketplace-page.html',
  styleUrl: './marketplace-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketplacePage {
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly network = inject(NetworkStore);
  private readonly collections = inject(CollectionReader);
  private readonly store = inject(ProjectStore);

  /** null while loading. */
  protected readonly listings = signal<Listing[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly min = signal('');
  protected readonly max = signal('');
  protected readonly sort = signal<Sort>('low');
  protected readonly shown = signal(STEP);

  private readonly projects = this.store.list(KIND_COLLECTION);
  /** Collection address → name (hidden collections are left out). */
  private readonly names = computed(() => {
    const names = new Map<string, string>();
    for (const p of this.projects().projects) if (!p.hidden) names.set(p.address, p.name);
    return names;
  });
  protected readonly filtered = computed(() => {
    const listings = this.listings() ?? [];
    const names = this.names();
    const query = this.query().trim().toLowerCase();
    const min = priceNano(this.min());
    const max = priceNano(this.max());
    const result = listings.filter(
      (l) =>
        names.has(l.collection) &&
        (!query || names.get(l.collection)!.toLowerCase().includes(query)) &&
        (!this.min() || min === null || l.price >= min) &&
        (!this.max() || max === null || l.price <= max),
    );
    const sort = this.sort();
    return result.sort((a, b) =>
      sort === 'newest'
        ? b.createdAt - a.createdAt
        : sort === 'low'
          ? Number(a.price - b.price)
          : Number(b.price - a.price),
    );
  });
  protected readonly visible = computed(() => this.filtered().slice(0, this.shown()));

  private run = 0;

  constructor() {
    effect(() => {
      this.network.network();
      const address = this.launchpad.address();
      untracked(() => {
        if (address) void this.load(address);
        else this.listings.set([]);
      });
    });
    effect(() => {
      this.query();
      this.min();
      this.max();
      this.sort();
      this.shown.set(STEP);
    });
  }

  protected name(listing: Listing): string {
    return this.names().get(listing.collection) ?? '';
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value.trim();
  }

  protected reload(): void {
    const address = this.launchpad.address();
    if (address) void this.load(address);
  }

  private async load(launchpad: string): Promise<void> {
    const run = ++this.run;
    this.listings.set(null);
    this.error.set(null);
    try {
      await this.store.load(KIND_COLLECTION);
      const all = await this.launchpad.allListings(0n);
      const valid = await this.collections.validListings(all, launchpad);
      if (run === this.run) this.listings.set(all.filter((l) => valid.has(l.id)));
    } catch (err) {
      if (run !== this.run) return;
      this.error.set(toUserMessage(err));
      this.listings.set([]);
    }
  }
}
