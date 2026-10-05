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
import { Router, RouterLink } from '@angular/router';
import { Args } from '@massalabs/massa-web3';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { ALLOWANCE_COINS, CREATE_PRESALE_COINS } from '../../core/launchpad/presale-cost';
import { KIND_TOKEN, Presale, Project } from '../../core/launchpad/records';
import { TokenReader } from '../../core/launchpad/token-reader';
import { Transactions, eventFields } from '../../core/launchpad/transactions';
import { NetworkStore } from '../../core/network/network-store';
import { formatUnits } from '../../core/utils/token-amount';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ConnectWalletDialog } from '../../layout/connect-wallet-dialog/connect-wallet-dialog';
import { MasPipe, UnitsPipe } from '../../shared/pipes/units-pipe';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';
import {
  EMPTY_PRESALE_DRAFT,
  PresaleDraft,
  createPresaleArgs,
  presaleTerms,
} from './presale-draft';

type Busy = 'approve' | 'create' | null;

/** Starts a presale for a token the wallet owns (docs/ANALYSIS.md, "Presale token"). */
@Component({
  selector: 'app-create-presale-page',
  imports: [RouterLink, ProjectLogo, MasPipe, UnitsPipe, ConnectWalletDialog],
  templateUrl: './create-presale-page.html',
  styleUrl: './create-token-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreatePresalePage {
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly wallet = inject(WalletStore);
  protected readonly network = inject(NetworkStore);
  private readonly tokens = inject(TokenReader);
  private readonly transactions = inject(Transactions);
  private readonly router = inject(Router);

  /** Route parameter: the token's address. */
  readonly token = input.required<string>();

  /** undefined = loading, null = not a Launchpad token. */
  protected readonly project = signal<Project | null | undefined>(undefined);
  protected readonly owner = signal('');
  protected readonly balance = signal<bigint | null>(null);
  protected readonly open = signal<Presale | null>(null);
  protected readonly feeBps = signal(0);
  protected readonly draft = signal<PresaleDraft>({ ...EMPTY_PRESALE_DRAFT });
  protected readonly touched = signal(false);
  protected readonly busy = signal<Busy>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly decimals = computed(() => this.project()?.decimals ?? 0);
  protected readonly result = computed(() => presaleTerms(this.draft(), this.decimals()));
  protected readonly terms = computed(() => this.result().terms);
  protected readonly errors = computed(() => this.result().errors);
  protected readonly isOwner = computed(
    () => !!this.owner() && this.owner() === this.wallet.address(),
  );
  protected readonly enoughTokens = computed(() => {
    const terms = this.terms();
    const balance = this.balance();
    return !terms || balance === null || balance >= terms.tokensForSale;
  });
  protected readonly canCreate = computed(
    () =>
      !!this.terms() &&
      this.isOwner() &&
      this.enoughTokens() &&
      !this.open() &&
      !this.wallet.networkMismatch() &&
      !this.busy(),
  );
  protected readonly durations = [
    { label: '1 day', hours: 24 },
    { label: '3 days', hours: 72 },
    { label: '7 days', hours: 168 },
    { label: '14 days', hours: 336 },
    { label: '30 days', hours: 720 },
  ];

  private readonly connectDialog = viewChild.required(ConnectWalletDialog);
  private run = 0;

  constructor() {
    effect(() => {
      const token = this.token();
      this.network.network();
      const me = this.wallet.address();
      if (this.launchpad.address()) untracked(() => void this.load(token, me));
      else this.project.set(null);
    });
  }

  protected set<K extends keyof PresaleDraft>(key: K, value: PresaleDraft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value.trim();
  }

  protected units(value: bigint): string {
    return formatUnits(value, this.decimals());
  }

  protected connect(): void {
    this.connectDialog().open();
  }

  protected async create(): Promise<void> {
    this.touched.set(true);
    const terms = this.terms();
    const launchpad = this.launchpad.address();
    const me = this.wallet.address();
    if (!terms || !launchpad || !me || !this.canCreate()) return;
    this.error.set(null);
    try {
      const token = this.token();
      const allowance = await this.tokens.allowance(token, me, launchpad);
      if (allowance < terms.tokensForSale) {
        this.busy.set('approve');
        await this.transactions.send({
          target: token,
          func: 'increaseAllowance',
          args: new Args().addString(launchpad).addU256(terms.tokensForSale - allowance),
          coins: ALLOWANCE_COINS,
        });
      }
      this.busy.set('create');
      // Recomputed now: a "start now" presale must end long enough after this moment.
      const fresh = presaleTerms(this.draft(), this.decimals()).terms ?? terms;
      const result = await this.transactions.send({
        target: launchpad,
        func: 'createPresale',
        args: createPresaleArgs(token, fresh),
        coins: CREATE_PRESALE_COINS,
      });
      const [id] = eventFields(result.events, 'PRESALE_CREATED') ?? [];
      await this.router.navigate(id ? ['/presales', id] : ['/tokens', token]);
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  private async load(token: string, me: string | null): Promise<void> {
    const run = ++this.run;
    this.project.set(undefined);
    try {
      const project = await this.launchpad.projectByAddress(token);
      if (run !== this.run) return;
      if (!project || project.kind !== KIND_TOKEN) {
        this.project.set(null);
        return;
      }
      this.project.set(project);
      const state = await this.tokens.state(token);
      const open = await this.launchpad.presaleOf(token);
      const config = await this.launchpad.config();
      const balance = me ? await this.tokens.balanceOf(token, me) : null;
      if (run !== this.run) return;
      this.owner.set(state.owner);
      this.open.set(open);
      this.feeBps.set(config.presaleFeeBps);
      this.balance.set(balance);
    } catch (err) {
      if (run === this.run) this.error.set(toUserMessage(err));
    }
  }
}
