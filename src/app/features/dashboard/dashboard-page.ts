import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CollectionReader } from '../../core/launchpad/collection-reader';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { ProjectStore } from '../../core/launchpad/project-store';
import {
  KIND_COLLECTION,
  KIND_TOKEN,
  Project,
  ProjectKind,
  SOURCE_IMPORTED,
  categoryLabel,
} from '../../core/launchpad/records';
import { TokenReader } from '../../core/launchpad/token-reader';
import { NetworkStore } from '../../core/network/network-store';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ConnectWalletDialog } from '../../layout/connect-wallet-dialog/connect-wallet-dialog';
import { ProjectBadges } from '../../shared/ui/project-badges/project-badges';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';
import { ImportDialog } from './import-dialog';

type Tab = 'tokens' | 'collections' | 'nfts';

interface MyProject {
  project: Project;
  /** null while the current owner is being read. */
  stillOwner: boolean | null;
}

interface MyNfts {
  project: Project;
  ids: bigint[];
}

/** The connected wallet's launches, imports and NFTs (docs/ANALYSIS.md, "Dashboard /me"). */
@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, ProjectLogo, ProjectBadges, ImportDialog, ConnectWalletDialog],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  protected readonly wallet = inject(WalletStore);
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly network = inject(NetworkStore);
  private readonly tokens = inject(TokenReader);
  private readonly collections = inject(CollectionReader);
  private readonly store = inject(ProjectStore);

  protected readonly tab = signal<Tab>('tokens');
  /** Per kind; null while loading. */
  protected readonly mine = signal<[MyProject[] | null, MyProject[] | null]>([null, null]);
  /** null while loading. */
  protected readonly nfts = signal<MyNfts[] | null>(null);
  protected readonly nftsScanned = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly imported = SOURCE_IMPORTED;

  protected readonly kind = computed<ProjectKind>(() =>
    this.tab() === 'collections' ? KIND_COLLECTION : KIND_TOKEN,
  );
  protected readonly list = computed(() => this.mine()[this.kind()]);
  protected readonly base = computed(() =>
    this.kind() === KIND_TOKEN ? '/tokens' : '/collections',
  );
  protected readonly noun = computed(() => (this.kind() === KIND_TOKEN ? 'token' : 'collection'));
  protected readonly nftCount = computed(() =>
    (this.nfts() ?? []).reduce((sum, entry) => sum + entry.ids.length, 0),
  );

  private readonly importDialog = viewChild.required(ImportDialog);
  private readonly connectDialog = viewChild.required(ConnectWalletDialog);
  private run = 0;

  constructor() {
    effect(() => {
      const address = this.wallet.address();
      this.network.network();
      const deployed = !!this.launchpad.address();
      untracked(() => {
        this.run++;
        this.mine.set([null, null]);
        this.nfts.set(null);
        if (address && deployed) {
          void this.loadMine(address, KIND_TOKEN, this.run);
          void this.loadMine(address, KIND_COLLECTION, this.run);
        }
      });
    });
    effect(() => {
      const tab = this.tab();
      const address = this.wallet.address();
      if (tab === 'nfts' && address && this.launchpad.address())
        untracked(() => this.nfts() === null && void this.loadNfts(address, this.run));
    });
  }

  protected category(project: Project): string {
    return categoryLabel(project.kind, project.category);
  }

  protected connect(): void {
    this.connectDialog().open();
  }

  protected openImport(): void {
    this.importDialog().open(this.kind());
  }

  protected onImported(project: Project): void {
    this.store.upsert(project);
    this.mine.update((lists) => {
      const next: [MyProject[] | null, MyProject[] | null] = [...lists];
      next[project.kind] = [{ project, stillOwner: true }, ...(lists[project.kind] ?? [])];
      return next;
    });
  }

  private async loadMine(address: string, kind: ProjectKind, run: number): Promise<void> {
    try {
      const ids = await this.launchpad.createdBy(address, kind);
      const list: MyProject[] = [];
      for (const id of [...ids].reverse()) {
        list.push({ project: await this.launchpad.project(kind, id), stillOwner: null });
      }
      if (run !== this.run) return;
      this.setList(kind, list);
      // Who owns each contract now (ownership may have moved on since the launch).
      for (const [i, item] of list.entries()) {
        const owner = await this.ownerOf(item.project).catch(() => '');
        if (run !== this.run) return;
        this.setList(
          kind,
          (this.mine()[kind] ?? []).map((t, j) =>
            j === i ? { ...t, stillOwner: owner === address } : t,
          ),
        );
      }
    } catch (err) {
      if (run === this.run) this.error.set(toUserMessage(err));
    }
  }

  /** NFTs held in each Launchpad collection that keeps the Enumerable owner index. */
  private async loadNfts(address: string, run: number): Promise<void> {
    try {
      await this.store.load(KIND_COLLECTION);
      const collections = this.store.list(KIND_COLLECTION)().projects;
      const found: MyNfts[] = [];
      this.nftsScanned.set(0);
      for (const project of collections) {
        const ids = await this.collections.ownedBy(project.address, address).catch(() => []);
        if (run !== this.run) return;
        if (ids.length) found.push({ project, ids });
        this.nftsScanned.update((n) => n + 1);
      }
      this.nfts.set(found);
    } catch (err) {
      if (run === this.run) this.error.set(toUserMessage(err));
    }
  }

  private async ownerOf(project: Project): Promise<string> {
    return project.kind === KIND_TOKEN
      ? (await this.tokens.state(project.address)).owner
      : (await this.collections.state(project.address)).owner;
  }

  private setList(kind: ProjectKind, list: MyProject[]): void {
    this.mine.update((lists) => {
      const next: [MyProject[] | null, MyProject[] | null] = [...lists];
      next[kind] = list;
      return next;
    });
  }
}
