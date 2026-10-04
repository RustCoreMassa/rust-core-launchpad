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
import { parseSupply } from '../../core/launchpad/launch-rules';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { KEEP_ONLY_ORIGINAL } from '../../core/launchpad/original-code';
import { ProjectStore } from '../../core/launchpad/project-store';
import { KIND_TOKEN, ProjectInfo, TOKEN_CATEGORIES } from '../../core/launchpad/records';
import { Transactions, eventFields } from '../../core/launchpad/transactions';
import { NetworkStore } from '../../core/network/network-store';
import { formatUnits } from '../../core/utils/token-amount';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ConnectWalletDialog } from '../../layout/connect-wallet-dialog/connect-wallet-dialog';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { InfoForm } from '../../shared/ui/info-form/info-form';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';
import {
  EMPTY_DRAFT,
  STEPS,
  TokenDraft,
  createTokenArgs,
  draftErrors,
  stepValid,
} from './token-draft';

type SymbolCheck = 'idle' | 'checking' | 'free' | 'taken' | 'error';

/** The token launch wizard (docs/ANALYSIS.md, "Fluxul de lansare a unui token"). */
@Component({
  selector: 'app-create-token-page',
  imports: [RouterLink, InfoForm, ProjectLogo, MasPipe, ConnectWalletDialog],
  templateUrl: './create-token-page.html',
  styleUrl: './create-token-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateTokenPage {
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly wallet = inject(WalletStore);
  protected readonly network = inject(NetworkStore);
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

  protected readonly cost = signal<LaunchCost | null>(null);
  protected readonly paused = signal(false);
  protected readonly costError = signal<string | null>(null);
  protected readonly launching = signal(false);
  protected readonly launchError = signal<string | null>(null);

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
        this.cost.set(null);
        this.symbolCheck.set('idle');
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
      1: ['decimals', 'supply', 'maxSupply'],
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
    const cost = this.cost();
    if (!target || !cost || !this.canLaunch()) return;
    this.launching.set(true);
    this.launchError.set(null);
    try {
      const result = await this.transactions.send({
        target,
        func: 'createToken',
        args: createTokenArgs(this.draft()),
        coins: cost.total,
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

  private async loadCost(): Promise<void> {
    if (this.cost()) return;
    this.costError.set(null);
    try {
      const config = await this.launchpad.config();
      const template = await this.launchpad.template(KIND_TOKEN);
      if (template.version === 0) throw new Error('Token launches are not open yet.');
      const code = await this.launchpad.templateCode(KIND_TOKEN, template.version);
      this.paused.set(config.paused);
      this.cost.set(launchCost(config.tokenFee, config.deployDeposit, code.length));
    } catch (err) {
      this.costError.set(toUserMessage(err));
    }
  }

  private touch(field: string): void {
    this.touched.update((set) => new Set(set).add(field));
  }
}
