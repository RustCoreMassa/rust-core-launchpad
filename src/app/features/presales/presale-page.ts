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
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import {
  CANCEL_COINS,
  CLAIM_COINS,
  CONTRIBUTE_MARGIN,
  FINALIZE_COINS,
  WITHDRAW_COINS,
} from '../../core/launchpad/presale-cost';
import {
  PHASE_LABELS,
  contributionError,
  maxContribution,
  presalePhase,
  reachesSoftCap,
  timeLeft,
} from '../../core/launchpad/presale-state';
import { Presale, Project, tokensFor } from '../../core/launchpad/records';
import { Transactions } from '../../core/launchpad/transactions';
import { NetworkStore } from '../../core/network/network-store';
import { formatUnits } from '../../core/utils/token-amount';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ConnectWalletDialog } from '../../layout/connect-wallet-dialog/connect-wallet-dialog';
import { ShortAddressPipe } from '../../shared/pipes/short-address-pipe';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { PresaleProgress } from '../../shared/ui/presale-progress/presale-progress';
import { ProjectBadges } from '../../shared/ui/project-badges/project-badges';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';
import { priceNano } from '../create/collection-draft';

type Busy = 'contribute' | 'finalize' | 'claim' | 'refund' | 'withdraw' | 'cancel' | null;

/** One presale: terms, progress, and the action that fits its phase and the wallet. */
@Component({
  selector: 'app-presale-page',
  imports: [
    DatePipe,
    RouterLink,
    MasPipe,
    ShortAddressPipe,
    ProjectLogo,
    ProjectBadges,
    PresaleProgress,
    ConnectWalletDialog,
  ],
  templateUrl: './presale-page.html',
  styleUrl: './presale-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresalePage {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly transactions = inject(Transactions);
  protected readonly network = inject(NetworkStore);
  protected readonly wallet = inject(WalletStore);

  /** Route parameter. */
  readonly id = input.required<string>();

  /** undefined = loading, null = not found. */
  protected readonly presale = signal<Presale | null | undefined>(undefined);
  protected readonly token = signal<Project | null>(null);
  /** The wallet's pending contribution, nanoMAS. */
  protected readonly mine = signal(0n);
  protected readonly amount = signal('');
  protected readonly busy = signal<Busy>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly now = signal(Date.now());
  protected readonly labels = PHASE_LABELS;

  protected readonly phase = computed(() => {
    const p = this.presale();
    return p ? presalePhase(p, this.now()) : null;
  });
  protected readonly decimals = computed(() => this.token()?.decimals ?? 0);
  protected readonly symbol = computed(() => this.token()?.symbol ?? '');
  protected readonly isCreator = computed(
    () => !!this.presale() && this.presale()!.creator === this.wallet.address(),
  );
  protected readonly amountNano = computed(() => priceNano(this.amount()));
  protected readonly amountError = computed(() => {
    const p = this.presale();
    const amount = this.amountNano();
    if (!p || this.amount() === '') return null;
    if (amount === null) return 'Enter an amount in MAS.';
    return contributionError(p, this.mine(), amount, this.now());
  });
  protected readonly maxNow = computed(() => {
    const p = this.presale();
    return p ? maxContribution(p, this.mine()) : 0n;
  });
  /** Tokens the typed amount buys. */
  protected readonly preview = computed(() => {
    const p = this.presale();
    const amount = this.amountNano();
    return p && amount ? formatUnits(tokensFor(amount, p.rate), this.decimals()) : '';
  });
  protected readonly myTokens = computed(() => {
    const p = this.presale();
    return p ? formatUnits(tokensFor(this.mine(), p.rate), this.decimals()) : '';
  });
  protected readonly pricePerMas = computed(() => {
    const p = this.presale();
    return p ? formatUnits(p.rate, this.decimals()) : '';
  });
  protected readonly willSucceed = computed(() => {
    const p = this.presale();
    return !!p && reachesSoftCap(p);
  });

  private readonly connectDialog = viewChild.required(ConnectWalletDialog);
  private run = 0;

  constructor() {
    effect(() => {
      const id = this.id();
      this.network.network();
      const me = this.wallet.address();
      if (this.launchpad.address()) untracked(() => void this.load(id, me));
      else this.presale.set(null);
    });
    const timer = setInterval(() => this.now.set(Date.now()), 30_000);
    effect((onCleanup) => onCleanup(() => clearInterval(timer)));
  }

  protected countdown(): string {
    const p = this.presale();
    const phase = this.phase();
    if (!p || !phase) return '';
    if (phase === 'upcoming') return `Starts in ${timeLeft(p.start, this.now())}`;
    if (phase === 'live') return `Ends in ${timeLeft(p.end, this.now())}`;
    return this.labels[phase];
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value.trim();
  }

  protected useMax(): void {
    this.amount.set(formatUnits(this.maxNow(), 9).replace(/,/g, ''));
  }

  protected connect(): void {
    this.connectDialog().open();
  }

  protected contribute(): Promise<void> {
    const amount = this.amountNano();
    if (!amount || this.amountError()) return Promise.resolve();
    return this.call(
      'contribute',
      new Args().addU64(this.presaleId()).addU64(amount),
      amount + CONTRIBUTE_MARGIN,
    );
  }

  protected finalize(): Promise<void> {
    return this.call('finalize', new Args().addU64(this.presaleId()), FINALIZE_COINS);
  }

  protected claim(): Promise<void> {
    return this.call('claim', new Args().addU64(this.presaleId()), CLAIM_COINS);
  }

  protected refund(): Promise<void> {
    return this.call('refund', new Args().addU64(this.presaleId()), 0n);
  }

  protected withdraw(): Promise<void> {
    return this.call(
      'withdraw',
      new Args().addU64(this.presaleId()),
      WITHDRAW_COINS,
      'withdrawRaised',
    );
  }

  protected cancel(): Promise<void> {
    return this.call('cancel', new Args().addU64(this.presaleId()), CANCEL_COINS, 'cancelPresale');
  }

  private presaleId(): bigint {
    return this.presale()?.id ?? 0n;
  }

  private async call(busy: Busy, args: Args, coins: bigint, func: string = busy!): Promise<void> {
    const target = this.launchpad.address();
    if (!target) return;
    this.busy.set(busy);
    this.error.set(null);
    try {
      await this.transactions.send({ target, func, args, coins });
      this.amount.set('');
      await this.load(this.id(), this.wallet.address());
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  private async load(id: string, me: string | null): Promise<void> {
    const run = ++this.run;
    this.error.set(null);
    if (!/^\d{1,19}$/.test(id)) {
      this.presale.set(null);
      return;
    }
    try {
      const presale = await this.launchpad.presale(BigInt(id));
      const token = await this.launchpad.projectByAddress(presale.token);
      const mine = me ? await this.launchpad.contribution(presale.id, me) : 0n;
      if (run !== this.run) return;
      this.presale.set(presale);
      this.token.set(token);
      this.mine.set(mine);
      this.now.set(Date.now());
    } catch (err) {
      if (run !== this.run) return;
      const message = err instanceof Error ? err.message : '';
      if (/Unknown presale/.test(message)) this.presale.set(null);
      else this.error.set(toUserMessage(err));
    }
  }
}
