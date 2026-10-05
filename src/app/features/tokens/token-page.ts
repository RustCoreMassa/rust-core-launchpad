import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { KEEP_ONLY_ORIGINAL, OriginalCode } from '../../core/launchpad/original-code';
import { ProjectStore } from '../../core/launchpad/project-store';
import {
  KIND_TOKEN,
  Presale,
  Project,
  SOURCE_LAUNCHED,
  categoryLabel,
  hex,
} from '../../core/launchpad/records';
import { TokenReader, TokenState } from '../../core/launchpad/token-reader';
import { NetworkStore } from '../../core/network/network-store';
import { httpUrl } from '../../core/utils/ipfs';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ShortAddressPipe } from '../../shared/pipes/short-address-pipe';
import { UnitsPipe } from '../../shared/pipes/units-pipe';
import { ProjectBadges } from '../../shared/ui/project-badges/project-badges';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';
import { EditInfoDialog } from '../../shared/ui/edit-info-dialog/edit-info-dialog';
import { MintDialog } from './mint-dialog';

/** One token: the registry record plus live reads from its contract. */
@Component({
  selector: 'app-token-page',
  imports: [
    DatePipe,
    RouterLink,
    ShortAddressPipe,
    UnitsPipe,
    ProjectBadges,
    ProjectLogo,
    EditInfoDialog,
    MintDialog,
  ],
  templateUrl: './token-page.html',
  styleUrl: './token-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenPage {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly tokens = inject(TokenReader);
  private readonly store = inject(ProjectStore);
  private readonly originalCode = inject(OriginalCode);
  protected readonly networks = inject(NetworkStore);
  protected readonly wallet = inject(WalletStore);

  /** Route parameter. */
  readonly address = input.required<string>();

  /** undefined = loading, null = not in the Launchpad. */
  protected readonly project = signal<Project | null | undefined>(undefined);
  protected readonly state = signal<TokenState | null>(null);
  /** The token's open presale; undefined while loading. */
  protected readonly presale = signal<Presale | null | undefined>(undefined);
  protected readonly codeModified = signal<boolean | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly downloading = signal(false);
  protected readonly downloadError = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly keepOnlyOriginal = KEEP_ONLY_ORIGINAL;
  protected readonly launched = SOURCE_LAUNCHED;
  protected readonly isOwner = computed(() => {
    const owner = this.state()?.owner;
    return !!owner && owner === this.wallet.address();
  });
  /** Tokens that can still be minted, in smallest units; null when not mintable. */
  protected readonly mintRoom = computed(() => {
    const state = this.state();
    if (!state?.template?.mintable) return null;
    return state.template.maxSupply - state.totalSupply;
  });
  protected readonly banner = computed(() => httpUrl(this.project()?.info.bannerUrl ?? ''));
  protected readonly links = computed(() => {
    const info = this.project()?.info;
    if (!info) return [];
    return [
      { label: 'Website', url: httpUrl(info.website) },
      { label: 'X / Twitter', url: httpUrl(info.twitter) },
      { label: 'Telegram', url: httpUrl(info.telegram) },
      { label: 'Discord', url: httpUrl(info.discord) },
    ].filter((link) => link.url !== '');
  });

  private readonly editDialog = viewChild.required(EditInfoDialog);
  private readonly mintDialog = viewChild.required(MintDialog);
  private loadRun = 0;

  constructor() {
    effect(() => {
      const address = this.address();
      this.networks.network();
      if (this.launchpad.address()) untracked(() => void this.load(address));
      else this.project.set(null);
    });
  }

  protected category(project: Project): string {
    return categoryLabel(KIND_TOKEN, project.category);
  }

  protected explorerUrl(address: string): string | null {
    return this.networks.network() === 'mainnet'
      ? `https://explorer.massa.net/mainnet/address/${address}`
      : null;
  }

  protected edit(): void {
    const project = this.project();
    if (project) this.editDialog().open(project);
  }

  protected mint(): void {
    const project = this.project();
    const room = this.mintRoom();
    if (project && room !== null) this.mintDialog().open(project, room);
  }

  protected onSaved(project: Project): void {
    this.project.set(project);
    this.store.upsert(project);
  }

  protected async onMinted(): Promise<void> {
    this.state.set(await this.tokens.state(this.address()));
  }

  protected async copyAddress(): Promise<void> {
    await navigator.clipboard?.writeText(this.address()).catch(() => undefined);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }

  protected async download(): Promise<void> {
    const project = this.project();
    if (!project) return;
    this.downloading.set(true);
    this.downloadError.set(null);
    try {
      const blob = await this.originalCode.zip(project);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.symbol.toLowerCase()}-original-code.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      this.downloadError.set(toUserMessage(err));
    } finally {
      this.downloading.set(false);
    }
  }

  private async load(address: string): Promise<void> {
    const run = ++this.loadRun;
    this.project.set(undefined);
    this.state.set(null);
    this.presale.set(undefined);
    this.codeModified.set(null);
    this.error.set(null);
    try {
      const project = await this.launchpad.projectByAddress(address);
      if (run !== this.loadRun) return;
      this.project.set(project && project.kind === KIND_TOKEN ? project : null);
      if (!project || project.kind !== KIND_TOKEN) return;
      const state = await this.tokens.state(address);
      if (run !== this.loadRun) return;
      this.state.set(state);
      const presale = await this.launchpad.presaleOf(address).catch(() => null);
      if (run !== this.loadRun) return;
      this.presale.set(presale);
      const current = await this.tokens.codeHash(address);
      if (run === this.loadRun) this.codeModified.set(current !== hex(project.codeHash));
    } catch (err) {
      if (run === this.loadRun) this.error.set(toUserMessage(err));
    }
  }
}
