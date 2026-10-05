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
import { Router, RouterLink } from '@angular/router';
import { LaunchCost, launchCost } from '../../core/launchpad/launch-cost';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { NftMetadata, NftMetadataLoader } from '../../core/launchpad/nft-metadata';
import { KEEP_ONLY_ORIGINAL } from '../../core/launchpad/original-code';
import { ProjectStore } from '../../core/launchpad/project-store';
import { COLLECTION_CATEGORIES, KIND_COLLECTION, ProjectInfo } from '../../core/launchpad/records';
import { MetadataGuide } from './metadata-guide';
import { assertKnownTemplate } from '../../core/launchpad/templates';
import { Transactions, eventFields } from '../../core/launchpad/transactions';
import { NetworkStore } from '../../core/network/network-store';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ConnectWalletDialog } from '../../layout/connect-wallet-dialog/connect-wallet-dialog';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { InfoForm } from '../../shared/ui/info-form/info-form';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';
import {
  COLLECTION_STEPS,
  CollectionDraft,
  EMPTY_COLLECTION_DRAFT,
  MetadataMode,
  canMintPublicly,
  collectionErrors,
  collectionStepValid,
  createCollectionArgs,
  maxSupplyValue,
  priceNano,
  royaltyBps,
} from './collection-draft';

type FolderCheck = 'idle' | 'checking' | 'ok' | 'failed';

/** The NFT collection launch wizard. */
@Component({
  selector: 'app-create-collection-page',
  imports: [RouterLink, InfoForm, ProjectLogo, MasPipe, ConnectWalletDialog, MetadataGuide],
  templateUrl: './create-collection-page.html',
  styleUrl: './create-token-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateCollectionPage {
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly wallet = inject(WalletStore);
  protected readonly network = inject(NetworkStore);
  private readonly transactions = inject(Transactions);
  private readonly store = inject(ProjectStore);
  private readonly metadata = inject(NftMetadataLoader);
  private readonly router = inject(Router);

  protected readonly steps = COLLECTION_STEPS;
  protected readonly categories = COLLECTION_CATEGORIES;
  protected readonly keepOnlyOriginal = KEEP_ONLY_ORIGINAL;

  protected readonly step = signal(0);
  protected readonly draft = signal<CollectionDraft>({
    ...EMPTY_COLLECTION_DRAFT,
    info: { ...EMPTY_COLLECTION_DRAFT.info },
  });
  protected readonly touched = signal(new Set<string>());
  protected readonly mutableAccepted = signal(false);
  protected readonly folderCheck = signal<FolderCheck>('idle');
  protected readonly firstNft = signal<NftMetadata | null>(null);

  protected readonly cost = signal<LaunchCost | null>(null);
  protected readonly paused = signal(false);
  protected readonly costError = signal<string | null>(null);
  protected readonly launching = signal(false);
  protected readonly launchError = signal<string | null>(null);

  protected readonly errors = computed(() => collectionErrors(this.draft()));
  protected readonly publicAllowed = computed(() => canMintPublicly(this.draft()));
  protected readonly canContinue = computed(
    () =>
      collectionStepValid(this.step(), this.draft()) &&
      (this.step() !== 2 || !this.draft().mutable || this.mutableAccepted()),
  );
  protected readonly canLaunch = computed(
    () =>
      collectionStepValid(4, this.draft()) &&
      this.cost() !== null &&
      !this.paused() &&
      this.wallet.connected() &&
      !this.wallet.networkMismatch() &&
      !this.launching(),
  );
  protected readonly summary = computed(() => {
    const d = this.draft();
    const publicMint = d.publicMint && canMintPublicly(d);
    return {
      maxSupply: maxSupplyValue(d.maxSupply) ?? 0,
      royalty: (royaltyBps(d.royalty) ?? 0) / 100,
      price: publicMint ? (priceNano(d.mintPrice) ?? 0n) : null,
      perWallet:
        d.maxPerWallet.trim() === '' || d.maxPerWallet === '0' ? 'no limit' : d.maxPerWallet,
    };
  });

  private readonly connectDialog = viewChild.required(ConnectWalletDialog);

  constructor() {
    effect(() => {
      this.network.network();
      untracked(() => this.cost.set(null));
    });
  }

  protected update<K extends keyof CollectionDraft>(key: K, value: CollectionDraft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
    this.touched.update((set) => new Set(set).add(key));
    if (key === 'baseURI' || key === 'metadataMode') {
      this.folderCheck.set('idle');
      this.firstNft.set(null);
    }
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setSymbol(event: Event): void {
    this.update('symbol', this.text(event).toUpperCase().replace(/\s/g, ''));
  }

  protected setMode(mode: MetadataMode): void {
    this.update('metadataMode', mode);
    if (mode === 'perToken') this.update('publicMint', false);
  }

  protected setInfo(info: ProjectInfo): void {
    this.update('info', info);
  }

  protected setCategory(category: number): void {
    this.update('category', category);
  }

  protected shows(field: string): boolean {
    return this.touched().has(field);
  }

  /** Loads <base URI>1.json, the first NFT's metadata, to catch a wrong folder before launch. */
  protected async checkFolder(): Promise<void> {
    const base = this.draft().baseURI;
    if (this.errors().baseURI) return;
    this.folderCheck.set('checking');
    const first = await this.metadata.load(base + '1.json');
    if (base !== this.draft().baseURI) return;
    this.firstNft.set(first);
    this.folderCheck.set(first ? 'ok' : 'failed');
  }

  protected next(): void {
    const fields: Record<number, string[]> = {
      0: ['name', 'symbol'],
      1: ['maxSupply', 'baseURI'],
      2: ['mintPrice', 'maxPerWallet', 'royalty', 'royaltyReceiver'],
      3: ['category'],
    };
    this.touched.update((set) => new Set([...set, ...(fields[this.step()] ?? [])]));
    if (!this.canContinue()) return;
    if (
      this.step() === 1 &&
      this.draft().metadataMode === 'folder' &&
      this.folderCheck() === 'idle'
    )
      void this.checkFolder();
    this.step.update((s) => Math.min(s + 1, COLLECTION_STEPS.length - 1));
    if (this.step() === 4) void this.loadCost();
  }

  protected back(): void {
    this.step.update((s) => Math.max(s - 1, 0));
  }

  protected goTo(step: number): void {
    if (step < this.step()) this.step.set(step);
  }

  protected connect(): void {
    this.connectDialog().open();
  }

  protected async launch(): Promise<void> {
    const target = this.launchpad.address();
    const cost = this.cost();
    if (!target || !cost || !this.canLaunch()) return;
    this.launching.set(true);
    this.launchError.set(null);
    try {
      const template = await this.launchpad.template(KIND_COLLECTION);
      assertKnownTemplate(KIND_COLLECTION, template.version, template.hash);
      const result = await this.transactions.send({
        target,
        func: 'createCollection',
        args: createCollectionArgs(this.draft()),
        coins: cost.total,
      });
      const [id, address] = eventFields(result.events, 'COLLECTION_CREATED') ?? [];
      if (!id || !address)
        throw new Error('The collection was created, but its address is unknown yet.');
      this.store.upsert(await this.launchpad.project(KIND_COLLECTION, BigInt(id)));
      await this.router.navigate(['/collections', address]);
    } catch (err) {
      this.launchError.set(toUserMessage(err));
    } finally {
      this.launching.set(false);
    }
  }

  private async loadCost(): Promise<void> {
    if (this.cost()) return;
    this.costError.set(null);
    try {
      const config = await this.launchpad.config();
      const template = await this.launchpad.template(KIND_COLLECTION);
      if (template.version === 0) throw new Error('Collection launches are not open yet.');
      assertKnownTemplate(KIND_COLLECTION, template.version, template.hash);
      const code = await this.launchpad.templateCode(KIND_COLLECTION, template.version);
      this.paused.set(config.paused);
      this.cost.set(launchCost(config.collectionFee, config.deployDeposit, code.length));
    } catch (err) {
      this.costError.set(toUserMessage(err));
    }
  }
}
