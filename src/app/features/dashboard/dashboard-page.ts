import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { ProjectStore } from '../../core/launchpad/project-store';
import { KIND_TOKEN, Project, SOURCE_IMPORTED, categoryLabel } from '../../core/launchpad/records';
import { TokenReader } from '../../core/launchpad/token-reader';
import { NetworkStore } from '../../core/network/network-store';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ConnectWalletDialog } from '../../layout/connect-wallet-dialog/connect-wallet-dialog';
import { ProjectBadges } from '../../shared/ui/project-badges/project-badges';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';
import { ImportTokenDialog } from './import-token-dialog';

interface MyToken {
  project: Project;
  /** null while the owner is being read. */
  stillOwner: boolean | null;
}

/** The connected wallet's launches and imports (docs/ANALYSIS.md, "Dashboard /me"). */
@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, ProjectLogo, ProjectBadges, ImportTokenDialog, ConnectWalletDialog],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  protected readonly wallet = inject(WalletStore);
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly network = inject(NetworkStore);
  private readonly tokens = inject(TokenReader);
  private readonly store = inject(ProjectStore);

  protected readonly tab = signal<'tokens' | 'collections'>('tokens');
  /** null while loading. */
  protected readonly myTokens = signal<MyToken[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly imported = SOURCE_IMPORTED;

  private readonly importDialog = viewChild.required(ImportTokenDialog);
  private readonly connectDialog = viewChild.required(ConnectWalletDialog);
  private run = 0;

  constructor() {
    effect(() => {
      const address = this.wallet.address();
      this.network.network();
      const deployed = !!this.launchpad.address();
      untracked(() => {
        if (address && deployed) void this.load(address);
        else this.myTokens.set(null);
      });
    });
  }

  protected category(project: Project): string {
    return categoryLabel(KIND_TOKEN, project.category);
  }

  protected connect(): void {
    this.connectDialog().open();
  }

  protected openImport(): void {
    this.importDialog().open();
  }

  protected onImported(project: Project): void {
    this.store.upsert(project);
    this.myTokens.update((list) => [{ project, stillOwner: true }, ...(list ?? [])]);
  }

  private async load(address: string): Promise<void> {
    const run = ++this.run;
    this.myTokens.set(null);
    this.error.set(null);
    try {
      const ids = await this.launchpad.createdBy(address, KIND_TOKEN);
      const list: MyToken[] = [];
      for (const id of [...ids].reverse()) {
        list.push({ project: await this.launchpad.project(KIND_TOKEN, id), stillOwner: null });
      }
      if (run !== this.run) return;
      this.myTokens.set(list);
      // Who owns each contract now (ownership may have moved on since the launch).
      for (const [i, item] of list.entries()) {
        const owner = await this.tokens
          .state(item.project.address)
          .then((s) => s.owner)
          .catch(() => '');
        if (run !== this.run) return;
        this.myTokens.update((current) =>
          (current ?? []).map((t, j) => (j === i ? { ...t, stillOwner: owner === address } : t)),
        );
      }
    } catch (err) {
      if (run === this.run) this.error.set(toUserMessage(err));
    }
  }
}
