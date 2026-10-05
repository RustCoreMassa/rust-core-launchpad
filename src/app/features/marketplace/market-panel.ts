import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Args } from '@massalabs/massa-web3';
import { CollectionReader } from '../../core/launchpad/collection-reader';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { APPROVE_COINS, LIST_COINS, buyCoins, saleSplit } from '../../core/launchpad/market-cost';
import { Listing, Project, Sale } from '../../core/launchpad/records';
import { Transactions } from '../../core/launchpad/transactions';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ConnectWalletDialog } from '../../layout/connect-wallet-dialog/connect-wallet-dialog';
import { ShortAddressPipe } from '../../shared/pipes/short-address-pipe';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { priceNano } from '../create/collection-draft';

const DAY = 24 * 60 * 60 * 1000;
const EXPIRIES = [
  { label: 'Never', days: 0 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

type Busy = 'approve' | 'list' | 'price' | 'cancel' | 'buy' | null;

/** Buy, list, reprice or cancel one NFT. No custody. */
@Component({
  selector: 'app-market-panel',
  imports: [DatePipe, MasPipe, ShortAddressPipe, ConnectWalletDialog],
  templateUrl: './market-panel.html',
  styleUrl: './market-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketPanel {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly collections = inject(CollectionReader);
  private readonly transactions = inject(Transactions);
  protected readonly wallet = inject(WalletStore);

  readonly collection = input.required<Project>();
  readonly tokenId = input.required<bigint>();
  /** Current holder of the NFT. */
  readonly owner = input.required<string>();
  /** The NFT changed hands or its listing changed; the page re-reads. */
  readonly changed = output<void>();

  /** undefined = loading. */
  protected readonly listing = signal<Listing | null | undefined>(undefined);
  protected readonly problem = signal('');
  protected readonly sales = signal<Sale[]>([]);
  protected readonly priceText = signal('');
  protected readonly expiryDays = signal(0);
  protected readonly busy = signal<Busy>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly expiries = EXPIRIES;

  protected readonly me = computed(() => this.wallet.address());
  protected readonly isOwner = computed(() => !!this.me() && this.owner() === this.me());
  protected readonly isSeller = computed(() => {
    const listing = this.listing();
    return !!listing && listing.seller === this.me();
  });
  protected readonly price = computed(() => priceNano(this.priceText()));
  protected readonly priceValid = computed(() => {
    const price = this.price();
    return price !== null && price > 0n;
  });
  protected readonly royaltyPercent = computed(() => this.collection().royaltyBps / 100);
  /** The marketplace fee new listings get (from the Launchpad's config), bps; null while unknown. */
  protected readonly marketFeeBps = signal<number | null>(null);
  protected readonly breakdown = computed(() => {
    const listing = this.listing();
    if (!listing) return null;
    const split = saleSplit(listing.price, this.collection().royaltyBps, listing.feeBps);
    return { ...split, feePercent: listing.feeBps / 100, sent: buyCoins(listing.price) };
  });
  protected readonly preview = computed(() => {
    const price = this.price();
    const feeBps = this.marketFeeBps();
    if (price === null || price <= 0n || feeBps === null) return null;
    const split = saleSplit(price, this.collection().royaltyBps, feeBps);
    return { ...split, feePercent: feeBps / 100 };
  });

  private readonly connectDialog = viewChild.required(ConnectWalletDialog);
  private run = 0;

  constructor() {
    effect(() => {
      const project = this.collection();
      const tokenId = this.tokenId();
      this.owner();
      const me = this.me();
      untracked(() => void this.load(project, tokenId, me));
    });
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value.trim();
  }

  protected connect(): void {
    this.connectDialog().open();
  }

  /** Approves the Launchpad for this NFT when needed, then lists it. */
  protected async list(): Promise<void> {
    const launchpad = this.launchpad.address();
    const me = this.me();
    const price = this.price();
    if (!launchpad || !me || price === null || price <= 0n) return;
    this.error.set(null);
    try {
      const project = this.collection();
      const approved = await this.collections.isApproved(
        project.address,
        me,
        this.tokenId(),
        launchpad,
      );
      if (!approved) {
        this.busy.set('approve');
        await this.transactions.send({
          target: project.address,
          func: 'approve',
          args: new Args().addString(launchpad).addU256(this.tokenId()),
          coins: APPROVE_COINS,
        });
      }
      this.busy.set('list');
      const days = this.expiryDays();
      await this.transactions.send({
        target: launchpad,
        func: 'list',
        args: new Args()
          .addString(project.address)
          .addU256(this.tokenId())
          .addU64(price)
          .addU64(days ? BigInt(Date.now() + days * DAY) : 0n),
        coins: LIST_COINS,
      });
      this.priceText.set('');
      this.changed.emit();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected updatePrice(): Promise<void> {
    const listing = this.listing();
    const price = this.price();
    if (!listing || price === null || price <= 0n) return Promise.resolve();
    return this.launchpadCall(
      'price',
      'updatePrice',
      new Args().addU64(listing.id).addU64(price),
      0n,
    );
  }

  protected cancel(): Promise<void> {
    const listing = this.listing();
    if (!listing) return Promise.resolve();
    return this.launchpadCall('cancel', 'cancel', new Args().addU64(listing.id), 0n);
  }

  protected buy(): Promise<void> {
    const listing = this.listing();
    if (!listing) return Promise.resolve();
    return this.launchpadCall(
      'buy',
      'buy',
      new Args().addU64(listing.id).addU64(listing.price),
      buyCoins(listing.price),
    );
  }

  private async launchpadCall(busy: Busy, func: string, args: Args, coins: bigint): Promise<void> {
    const target = this.launchpad.address();
    if (!target) return;
    this.busy.set(busy);
    this.error.set(null);
    try {
      await this.transactions.send({ target, func, args, coins });
      this.priceText.set('');
      this.changed.emit();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  private async load(project: Project, tokenId: bigint, me: string | null): Promise<void> {
    const run = ++this.run;
    this.listing.set(undefined);
    this.problem.set('');
    try {
      const listing = await this.launchpad.listingOf(project.address, tokenId);
      if (run !== this.run) return;
      this.listing.set(listing);
      if (listing && me && listing.seller !== me) {
        const problem = await this.launchpad.buyProblem(listing.id, me);
        if (run === this.run) this.problem.set(problem);
      }
      const sales = await this.launchpad.sales(project.id);
      if (run === this.run) this.sales.set(sales.items.filter((s) => s.tokenId === tokenId));
      if (this.marketFeeBps() === null) {
        const config = await this.launchpad.config();
        if (run === this.run) this.marketFeeBps.set(config.marketFeeBps);
      }
    } catch (err) {
      if (run !== this.run) return;
      this.listing.set(null);
      this.error.set(toUserMessage(err));
    }
  }
}
