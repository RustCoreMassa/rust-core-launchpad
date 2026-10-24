import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CollectionReader, MintInfo } from '../../core/launchpad/collection-reader';
import { HolderDiscountStore } from '../../core/launchpad/holder-discount';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { feeSavings, mintProgress } from '../../core/launchpad/membership';
import { KIND_COLLECTION, LaunchpadConfig, Project } from '../../core/launchpad/records';
import { NetworkStore } from '../../core/network/network-store';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';

/** The mint count is re-read this often while the home page is open. */
const REFRESH_MS = 30_000;

/**
 * RustCore's membership collection on the home page: live mint progress, price and what holding
 * one gives. Hidden while the network has no such collection (see membershipCollection).
 */
@Component({
  selector: 'app-membership-section',
  imports: [RouterLink, MasPipe, ProjectLogo],
  templateUrl: './membership-section.html',
  styleUrl: './membership-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MembershipSection {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly collections = inject(CollectionReader);
  private readonly networks = inject(NetworkStore);
  protected readonly discount = inject(HolderDiscountStore);

  /** The collection the Launchpad discounts, else the one announced for this network. */
  protected readonly address = computed(
    () => this.discount.program()?.collection ?? this.networks.config().membershipCollection,
  );
  /** The discount is live on this Launchpad for this collection. */
  protected readonly active = computed(() => {
    const program = this.discount.program();
    return !!program && program.collection === this.address();
  });
  protected readonly project = signal<Project | null>(null);
  protected readonly mint = signal<MintInfo | null>(null);
  protected readonly config = signal<LaunchpadConfig | null>(null);

  protected readonly progress = computed(() => {
    const mint = this.mint();
    return mint ? mintProgress(mint) : null;
  });
  protected readonly savings = computed(() => {
    const program = this.discount.program();
    const config = this.config();
    return this.active() && program && config ? feeSavings(config, program.bps) : [];
  });

  private run = 0;

  constructor() {
    effect(() => {
      const address = this.address();
      this.networks.network();
      untracked(() => void this.load(address));
    });
    // Live progress: the mint count again every 30 s.
    effect((onCleanup) => {
      const address = this.address();
      if (!address) return;
      const timer = setInterval(() => void this.refreshMint(address), REFRESH_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  private async load(address: string | null): Promise<void> {
    const run = ++this.run;
    this.project.set(null);
    this.mint.set(null);
    if (!address || !this.launchpad.address()) return;
    try {
      const project = await this.launchpad.projectByAddress(address);
      if (run !== this.run || !project || project.kind !== KIND_COLLECTION || project.hidden)
        return;
      const state = await this.collections.state(address);
      const config = await this.launchpad.config().catch(() => null);
      if (run !== this.run) return;
      this.project.set(project);
      this.mint.set(state.mint);
      this.config.set(config);
    } catch {
      // Not shown when it can't be read: the home page stays usable.
    }
  }

  private async refreshMint(address: string): Promise<void> {
    const run = this.run;
    const state = await this.collections.state(address).catch(() => null);
    if (state?.mint && run === this.run && address === this.address()) this.mint.set(state.mint);
  }
}
