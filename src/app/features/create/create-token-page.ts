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
import { HolderDiscountStore } from '../../core/launchpad/holder-discount';
import { launchCost } from '../../core/launchpad/launch-cost';
import { parseSupply } from '../../core/launchpad/launch-rules';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { KEEP_ONLY_ORIGINAL } from '../../core/launchpad/original-code';
import { ProjectStore } from '../../core/launchpad/project-store';
import { KIND_TOKEN, ProjectInfo, TOKEN_CATEGORIES } from '../../core/launchpad/records';
import { assertKnownTemplate } from '../../core/launchpad/templates';
import {
  AllocationRow,
  chartSlices,
  chartSummary,
  rowsToAllocations,
  shares,
  formatBps,
  tokenomicsCost,
} from '../../core/launchpad/tokenomics';
import { Transactions, eventFields } from '../../core/launchpad/transactions';
import { NetworkStore } from '../../core/network/network-store';
import { formatUnits } from '../../core/utils/token-amount';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ConnectWalletDialog } from '../../layout/connect-wallet-dialog/connect-wallet-dialog';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { HolderDiscountNote } from '../../shared/ui/holder-discount-note/holder-discount-note';
import { InfoForm } from '../../shared/ui/info-form/info-form';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';
import { TokenomicsChart } from '../../shared/ui/tokenomics-chart/tokenomics-chart';
import { TokenomicsEditor } from '../../shared/ui/tokenomics-editor/tokenomics-editor';
import {
  EMPTY_DRAFT,
  STEPS,
  TokenDraft,
  createTokenArgs,
  draftErrors,
  stepValid,
  tokenomicsBase,
} from './token-draft';

type SymbolCheck = 'idle' | 'checking' | 'free' | 'taken' | 'error';

/** The token launch wizard. */
@Component({
  selector: 'app-create-token-page',
  imports: [
    RouterLink,
    InfoForm,
    ProjectLogo,
    MasPipe,
    HolderDiscountNote,
    ConnectWalletDialog,
    TokenomicsChart,
    TokenomicsEditor,
  ],
  templateUrl: './create-token-page.html',
  styleUrl: './create-token-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateTokenPage {
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly wallet = inject(WalletStore);
  protected readonly network = inject(NetworkStore);
  private readonly discount = inject(HolderDiscountStore);
  private readonly transactions = inject(Transactions);
  private readonly store = inject(ProjectStore);
  private readonly router = inject(Router);

  protected readonly steps = STEPS;
  protected readonly categories = TOKEN_CATEGORIES;
  protected readonly keepOnlyOriginal = KEEP_ONLY_ORIGINAL;

  protected readonly step = signal(0);
  protected readonly draft = signal<TokenDraft>({ ...EMPTY_DRAFT, info: { ...EMPTY_DRAFT.info } });
  /** Errors appear once the user tried to leave the step (or typed in the field). */
  protected readonly touched = signal(new Set<string>());
  protected readonly symbolCheck = signal<SymbolCheck>('idle');
  protected readonly mutableAccepted = signal(false);

  /** The fee before any holder discount, the deposit and the template's size, once read. */
  private readonly costBase = signal<{ fee: bigint; deposit: bigint; bytes: number } | null>(null);
  protected readonly cost = computed(() => {
    const base = this.costBase();
    return base && launchCost(base.fee, base.deposit, base.bytes, this.discount.bps());
  });
  protected readonly paused = signal(false);
  protected readonly costError = signal<string | null>(null);
  protected readonly launching = signal(false);
  protected readonly launchError = signal<string | null>(null);
  /** Distribution is offered only on a Launchpad that stores it (v1.1.0+). */
  protected readonly tokenomicsSupported = signal(false);

  protected readonly errors = computed(() => draftErrors(this.draft()));
  protected readonly canContinue = computed(
    () =>
      stepValid(this.step(), this.draft()) &&
      (this.step() !== 0 || this.symbolCheck() !== 'taken') &&
      (this.step() !== 1 || !this.draft().mutable || this.mutableAccepted()),
  );
  protected readonly supplyPreview = computed(() => {
    const d = this.draft();
    const units = parseSupply(d.supply, d.decimals);
    return units === null ? '' : formatUnits(units, d.decimals);
  });
  /** What the declared parts must add up to (max supply if mintable). */
  protected readonly tokenomicsBase = computed(() => tokenomicsBase(this.draft()));
  /** The declared parts, valid or not yet ([] when none). */
  protected readonly allocations = computed(() => {
    const d = this.draft();
    return rowsToAllocations(d.allocations, this.tokenomicsBase(), d.decimals) ?? [];
  });
  protected readonly tokenomicsStorage = computed(() =>
    this.allocations().length ? tokenomicsCost(this.allocations()) : 0n,
  );
  protected readonly sendTotal = computed(() => {
    const cost = this.cost();
    return cost ? cost.total + this.tokenomicsStorage() : null;
  });
  protected readonly tokenomicsBaseText = computed(() => {
    const base = this.tokenomicsBase();
    return base === null ? '' : formatUnits(base, this.draft().decimals);
  });
  protected readonly reviewSlices = computed(() => chartSlices(this.allocations()));
  protected readonly reviewSummary = computed(() => chartSummary(this.allocations()));
  protected readonly reviewParts = computed(() => {
    const parts = this.allocations();
    const bps = shares(
      parts.map((p) => p.amount),
      this.tokenomicsBase() ?? 0n,
    );
    return parts.map((p, i) => ({ purpose: p.purpose, percent: formatBps(bps[i]) }));
  });

  protected readonly canLaunch = computed(
    () =>
      stepValid(3, this.draft()) &&
      this.symbolCheck() === 'free' &&
      this.cost() !== null &&
      !this.paused() &&
      this.wallet.connected() &&
      !this.wallet.networkMismatch() &&
      !this.launching(),
  );

  private readonly connectDialog = viewChild.required(ConnectWalletDialog);
  private symbolRun = 0;

  constructor() {
    // A new network means another Launchpad: forget the cost and the symbol check.
    effect(() => {
      this.network.network();
      untracked(() => {
        this.costBase.set(null);
        this.symbolCheck.set('idle');
        void this.checkTokenomics();
      });
    });
  }

  protected update<K extends keyof TokenDraft>(key: K, value: TokenDraft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
    this.touch(key);
    if (key === 'symbol') this.symbolCheck.set('idle');
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setSymbol(event: Event): void {
    this.update('symbol', this.text(event).toUpperCase().replace(/\s/g, ''));
  }

  protected setDecimals(event: Event): void {
    const value = Number(this.text(event));
    this.update('decimals', Number.isFinite(value) ? value : -1);
  }

  protected setInfo(info: ProjectInfo): void {
    this.update('info', info);
  }

  /** Not "touched" while typing: the editor shows each field's error on blur. */
  protected setAllocations(rows: AllocationRow[]): void {
    this.draft.update((d) => ({ ...d, allocations: rows }));
  }

  protected setCategory(category: number): void {
    this.update('category', category);
  }

  protected shows(field: string): boolean {
    return this.touched().has(field);
  }

  protected async checkSymbol(): Promise<void> {
    const symbol = this.draft().symbol;
    if (this.errors().symbol || !this.launchpad.address()) return;
    const run = ++this.symbolRun;
    this.symbolCheck.set('checking');
    try {
      const free = await this.launchpad.isSymbolAvailable(symbol);
      if (run === this.symbolRun) this.symbolCheck.set(free ? 'free' : 'taken');
    } catch {
      if (run === this.symbolRun) this.symbolCheck.set('error');
    }
  }

  protected async next(): Promise<void> {
    const fields: Record<number, string[]> = {
      0: ['name', 'symbol'],
      1: ['decimals', 'supply', 'maxSupply', 'allocations'],
      2: ['category'],
    };
    for (const field of fields[this.step()] ?? []) this.touch(field);
    if (this.step() === 0 && this.symbolCheck() !== 'free') await this.checkSymbol();
    if (!this.canContinue()) return;
    this.step.update((s) => Math.min(s + 1, STEPS.length - 1));
    if (this.step() === 3) void this.loadCost();
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
    const total = this.sendTotal();
    if (!target || total === null || !this.canLaunch()) return;
    this.launching.set(true);
    this.launchError.set(null);
    try {
      const template = await this.launchpad.template(KIND_TOKEN);
      assertKnownTemplate(KIND_TOKEN, template.hash);
      const result = await this.transactions.send({
        target,
        func: 'createToken',
        args: createTokenArgs(this.draft()),
        coins: total,
      });
      const [id, address] = eventFields(result.events, 'TOKEN_CREATED') ?? [];
      if (!id || !address)
        throw new Error('The token was created, but its address is unknown yet.');
      this.store.upsert(await this.launchpad.project(KIND_TOKEN, BigInt(id)));
      await this.router.navigate(['/tokens', address]);
    } catch (err) {
      this.launchError.set(toUserMessage(err));
    } finally {
      this.launching.set(false);
    }
  }

  private async checkTokenomics(): Promise<void> {
    const supported =
      !!this.launchpad.address() && (await this.launchpad.supportsTokenomics().catch(() => false));
    this.tokenomicsSupported.set(supported);
    if (!supported) this.draft.update((d) => ({ ...d, allocations: [] }));
  }

  private async loadCost(): Promise<void> {
    void this.discount.refresh();
    if (this.costBase()) return;
    this.costError.set(null);
    try {
      const config = await this.launchpad.config();
      const template = await this.launchpad.template(KIND_TOKEN);
      if (template.version === 0) throw new Error('Token launches are not open yet.');
      assertKnownTemplate(KIND_TOKEN, template.hash);
      const code = await this.launchpad.templateCode(KIND_TOKEN, template.version);
      this.paused.set(config.paused);
      this.costBase.set({
        fee: config.tokenFee,
        deposit: config.deployDeposit,
        bytes: code.length,
      });
    } catch (err) {
      this.costError.set(toUserMessage(err));
    }
  }

  private touch(field: string): void {
    this.touched.update((set) => new Set(set).add(field));
  }
}
