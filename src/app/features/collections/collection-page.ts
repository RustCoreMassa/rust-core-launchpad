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
import { Args } from '@massalabs/massa-web3';
import { CollectionReader, CollectionState, NftItem } from '../../core/launchpad/collection-reader';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { publicMintCoins } from '../../core/launchpad/mint-cost';
import { KEEP_ONLY_ORIGINAL, OriginalCode } from '../../core/launchpad/original-code';
import { ProjectStore } from '../../core/launchpad/project-store';
import {
  KIND_COLLECTION,
  MarketStats,
  Project,
  SOURCE_LAUNCHED,
  categoryLabel,
  hex,
} from '../../core/launchpad/records';
import { TokenReader } from '../../core/launchpad/token-reader';
import { Transactions } from '../../core/launchpad/transactions';
import { NetworkStore } from '../../core/network/network-store';
import { httpUrl } from '../../core/utils/ipfs';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ConnectWalletDialog } from '../../layout/connect-wallet-dialog/connect-wallet-dialog';
import { ShortAddressPipe } from '../../shared/pipes/short-address-pipe';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { EditInfoDialog } from '../../shared/ui/edit-info-dialog/edit-info-dialog';
import { ProjectBadges } from '../../shared/ui/project-badges/project-badges';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';
import { CollectionSettingsDialog } from './collection-settings-dialog';
import { NftGrid } from './nft-grid';
import { OwnerMintDialog } from './owner-mint-dialog';

/** One collection: the registry record, live mint state, its NFTs, and the owner's tools. */
@Component({
  selector: 'app-collection-page',
  imports: [
    DatePipe,
    RouterLink,
    ShortAddressPipe,
    MasPipe,
    ProjectBadges,
    ProjectLogo,
    NftGrid,
    EditInfoDialog,
    OwnerMintDialog,
    CollectionSettingsDialog,
    ConnectWalletDialog,
  ],
  templateUrl: './collection-page.html',
  styleUrl: './collection-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionPage {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly collections = inject(CollectionReader);
  private readonly tokens = inject(TokenReader);
  private readonly store = inject(ProjectStore);
  private readonly originalCode = inject(OriginalCode);
  private readonly transactions = inject(Transactions);
  protected readonly networks = inject(NetworkStore);
  protected readonly wallet = inject(WalletStore);

  /** Route parameter. */
  readonly address = input.required<string>();

  /** undefined = loading, null = not in the Launchpad. */
  protected readonly project = signal<Project | null | undefined>(undefined);
  protected readonly state = signal<CollectionState | null>(null);
  protected readonly items = signal<NftItem[] | null>(null);
  /** Valid marketplace prices by token id; empty until loaded. */
  protected readonly prices = signal<ReadonlyMap<bigint, bigint>>(new Map());
  protected readonly market = signal<MarketStats | null>(null);
  /** Lowest valid listing price, nanoMAS; null when nothing is for sale. */
  protected readonly floor = computed(() => {
    let floor: bigint | null = null;
    for (const price of this.prices().values()) if (floor === null || price < floor) floor = price;
    return floor;
  });
  protected readonly codeModified = signal<boolean | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly mintCount = signal(1);
  protected readonly mintedByMe = signal(0);
  protected readonly minting = signal(false);
  protected readonly mintError = signal<string | null>(null);
  protected readonly downloading = signal(false);
  protected readonly downloadError = signal<string | null>(null);

  protected readonly keepOnlyOriginal = KEEP_ONLY_ORIGINAL;
  protected readonly launched = SOURCE_LAUNCHED;

  protected readonly mint = computed(() => this.state()?.mint ?? null);
  protected readonly isOwner = computed(() => {
    const owner = this.state()?.owner;
    return !!owner && owner === this.wallet.address();
  });
  protected readonly remaining = computed(() => {
    const mint = this.mint();
    return mint ? Number(mint.maxSupply - mint.minted) : 0;
  });
  protected readonly holders = computed(
    () => new Set((this.items() ?? []).map((i) => i.owner)).size,
  );
  /** How many the connected wallet may still mint publicly (null = no limit). */
  protected readonly myAllowance = computed(() => {
    const mint = this.mint();
    if (!mint?.maxPerWallet) return null;
    return Math.max(0, mint.maxPerWallet - this.mintedByMe());
  });
  protected readonly maxMint = computed(() =>
    Math.min(50, this.remaining(), this.myAllowance() ?? Number.MAX_SAFE_INTEGER),
  );
  protected readonly mintCost = computed(() => {
    const mint = this.mint();
    return mint ? publicMintCoins(mint.mintPrice, this.mintCount()) : 0n;
  });
  protected readonly banner = computed(() => httpUrl(this.project()?.info.bannerUrl ?? ''));
  protected readonly links = computed(() => {
    const info = this.project()?.info;
    if (!info) return [];
    return [
      { label: 'Website', url: info.website },
      { label: 'X / Twitter', url: info.twitter },
      { label: 'Telegram', url: info.telegram },
      { label: 'Discord', url: info.discord },
    ].filter((link) => link.url.startsWith('https://'));
  });

  private readonly editDialog = viewChild.required(EditInfoDialog);
  private readonly ownerMintDialog = viewChild.required(OwnerMintDialog);
  private readonly settingsDialog = viewChild.required(CollectionSettingsDialog);
  private readonly connectDialog = viewChild.required(ConnectWalletDialog);
  private run = 0;

  constructor() {
    effect(() => {
      const address = this.address();
      this.networks.network();
      if (this.launchpad.address()) untracked(() => void this.load(address));
      else this.project.set(null);
    });
    effect(() => {
      const me = this.wallet.address();
      const mint = this.mint();
      untracked(() => void this.loadMintedByMe(me, mint !== null));
    });
  }

  protected category(project: Project): string {
    return categoryLabel(KIND_COLLECTION, project.category);
  }

  protected setMintCount(event: Event): void {
    const n = Number((event.target as HTMLInputElement).value);
    this.mintCount.set(Number.isInteger(n) ? n : 0);
  }

  protected connect(): void {
    this.connectDialog().open();
  }

  protected async publicMint(): Promise<void> {
    const count = this.mintCount();
    if (count < 1 || count > this.maxMint()) return;
    this.minting.set(true);
    this.mintError.set(null);
    try {
      await this.transactions.send({
        target: this.address(),
        func: 'publicMint',
        args: new Args().addU32(BigInt(count)),
        coins: this.mintCost(),
      });
      await this.refresh();
    } catch (err) {
      this.mintError.set(toUserMessage(err));
    } finally {
      this.minting.set(false);
    }
  }

  protected edit(): void {
    const project = this.project();
    if (project) this.editDialog().open(project);
  }

  protected ownerMint(): void {
    const mint = this.mint();
    if (mint) this.ownerMintDialog().open(this.address(), this.remaining(), mint.baseURI === '');
  }

  protected settings(): void {
    const project = this.project();
    const mint = this.mint();
    if (project && mint) this.settingsDialog().openFor(project, mint);
  }

  protected onSaved(project: Project): void {
    this.project.set(project);
    this.store.upsert(project);
  }

  protected async refresh(): Promise<void> {
    const address = this.address();
    const [project, state, items] = [
      await this.launchpad.projectByAddress(address),
      await this.collections.state(address),
      await this.collections.items(address),
    ];
    if (project) this.onSaved(project);
    this.state.set(state);
    this.items.set(items);
    if (project) await this.loadMarket(project);
    await this.loadMintedByMe(this.wallet.address(), state.mint !== null);
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
    const run = ++this.run;
    this.project.set(undefined);
    this.state.set(null);
    this.items.set(null);
    this.prices.set(new Map());
    this.market.set(null);
    this.codeModified.set(null);
    this.error.set(null);
    try {
      const project = await this.launchpad.projectByAddress(address);
      if (run !== this.run) return;
      const isCollection = project?.kind === KIND_COLLECTION;
      this.project.set(isCollection ? project : null);
      if (!project || !isCollection) return;
      const state = await this.collections.state(address);
      if (run !== this.run) return;
      this.state.set(state);
      const items = await this.collections.items(address);
      if (run !== this.run) return;
      this.items.set(items);
      await this.loadMarket(project);
      if (run !== this.run) return;
      const current = await this.tokens.codeHash(address);
      if (run === this.run) this.codeModified.set(current !== hex(project.codeHash));
    } catch (err) {
      if (run === this.run) this.error.set(toUserMessage(err));
    }
  }

  /** Marketplace totals and the listings that can really be bought. */
  private async loadMarket(project: Project): Promise<void> {
    const launchpad = this.launchpad.address();
    if (!launchpad) return;
    try {
      this.market.set(await this.launchpad.stats(project.id));
      const listings = await this.launchpad.allListings(project.id);
      const valid = await this.collections.validListings(listings, launchpad);
      this.prices.set(
        new Map(listings.filter((l) => valid.has(l.id)).map((l) => [l.tokenId, l.price])),
      );
    } catch (err) {
      console.error('[market]', err);
    }
  }

  private async loadMintedByMe(me: string | null, rcCollection: boolean): Promise<void> {
    if (!me || !rcCollection) {
      this.mintedByMe.set(0);
      return;
    }
    this.mintedByMe.set(await this.collections.mintedBy(this.address(), me).catch(() => 0));
  }
}
