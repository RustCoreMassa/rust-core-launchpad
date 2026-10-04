import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CollectionReader, NftItem } from '../../core/launchpad/collection-reader';
import { NftMetadata, NftMetadataLoader } from '../../core/launchpad/nft-metadata';

const STEP = 24;
/** Metadata loaded for the trait filter at most (the rest stays unfiltered). */
const MAX_FOR_TRAITS = 1_000;
/** Parallel metadata reads — the public RPC rejects bursts. */
const CONCURRENCY = 4;

/** undefined = not loaded yet, null = no usable metadata. */
type MetaState = NftMetadata | null | undefined;

/**
 * The NFTs of a collection with their metadata, loaded as they come into view. Filters: only
 * mine, and traits (once a trait filter is on, metadata of the whole collection is loaded).
 */
@Component({
  selector: 'app-nft-grid',
  imports: [RouterLink],
  templateUrl: './nft-grid.html',
  styleUrl: './nft-grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NftGrid {
  private readonly collections = inject(CollectionReader);
  private readonly loader = inject(NftMetadataLoader);

  readonly collection = input.required<string>();
  readonly items = input.required<readonly NftItem[]>();
  /** The connected wallet, for "Only mine". */
  readonly me = input<string | null>(null);

  protected readonly metas = signal(new Map<bigint, MetaState>());
  protected readonly mineOnly = signal(false);
  /** Selected value per trait. */
  protected readonly selected = signal(new Map<string, string>());
  protected readonly shown = signal(STEP);

  /** trait → values seen so far, with counts. */
  protected readonly traits = computed(() => {
    const traits = new Map<string, Map<string, number>>();
    for (const meta of this.metas().values()) {
      for (const a of meta?.attributes ?? []) {
        const values = traits.get(a.trait) ?? new Map<string, number>();
        values.set(a.value, (values.get(a.value) ?? 0) + 1);
        traits.set(a.trait, values);
      }
    }
    return [...traits.entries()]
      .map(([trait, values]) => ({
        trait,
        values: [...values.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      }))
      .sort((a, b) => a.trait.localeCompare(b.trait));
  });
  protected readonly filtered = computed(() => {
    const me = this.me();
    const selected = this.selected();
    const metas = this.metas();
    return this.items().filter((item) => {
      if (this.mineOnly() && item.owner !== me) return false;
      if (!selected.size) return true;
      const meta = metas.get(item.id);
      return [...selected].every(([trait, value]) =>
        meta?.attributes.some((a) => a.trait === trait && a.value === value),
      );
    });
  });
  protected readonly visible = computed(() => this.filtered().slice(0, this.shown()));

  private queue: bigint[] = [];
  private running = 0;
  private generation = 0;

  constructor() {
    effect(() => {
      this.collection();
      this.items();
      untracked(() => {
        this.generation++;
        this.queue = [];
        this.metas.set(new Map());
        this.selected.set(new Map());
        this.shown.set(STEP);
      });
    });
    effect(() => {
      const ids = this.visible().map((item) => item.id);
      untracked(() => this.request(ids));
    });
  }

  protected meta(id: bigint): MetaState {
    return this.metas().get(id);
  }

  protected pick(trait: string, value: string): void {
    this.selected.update((current) => {
      const next = new Map(current);
      if (next.get(trait) === value) next.delete(trait);
      else next.set(trait, value);
      return next;
    });
    this.shown.set(STEP);
    // Filtering by trait needs every NFT's metadata.
    this.request(
      this.items()
        .slice(0, MAX_FOR_TRAITS)
        .map((item) => item.id),
    );
  }

  protected toggleMine(): void {
    this.mineOnly.update((v) => !v);
    this.shown.set(STEP);
  }

  protected more(): void {
    this.shown.update((n) => n + STEP);
  }

  private request(ids: bigint[]): void {
    const metas = this.metas();
    for (const id of ids) {
      if (!metas.has(id) && !this.queue.includes(id)) this.queue.push(id);
    }
    while (this.running < CONCURRENCY && this.queue.length) void this.work(this.generation);
  }

  private async work(generation: number): Promise<void> {
    this.running++;
    try {
      while (this.queue.length && generation === this.generation) {
        const id = this.queue.shift()!;
        let meta: NftMetadata | null = null;
        try {
          meta = await this.loader.load(await this.collections.uri(this.collection(), id));
        } catch {
          meta = null;
        }
        if (generation !== this.generation) return;
        this.metas.update((current) => new Map(current).set(id, meta));
      }
    } finally {
      this.running--;
    }
  }
}
