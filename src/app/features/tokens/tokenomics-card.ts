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
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Project, Tokenomics } from '../../core/launchpad/records';
import { TokenReader, TokenState } from '../../core/launchpad/token-reader';
import {
  baseSupply,
  chartSlices,
  chartSummary,
  declaredSupply,
  formatBps,
  partColor,
  shareOf,
  shares,
} from '../../core/launchpad/tokenomics';
import { NetworkStore } from '../../core/network/network-store';
import { formatUnits } from '../../core/utils/token-amount';
import { ShortAddressPipe } from '../../shared/pipes/short-address-pipe';
import { UnitsPipe } from '../../shared/pipes/units-pipe';
import { TokenomicsChart } from '../../shared/ui/tokenomics-chart/tokenomics-chart';

/** What an address declared as holding parts holds now. */
interface Holding {
  /** Token units; undefined while loading, null when the read failed. */
  balance: bigint | null | undefined;
  /** Declared share of all the parts with this address, bps. */
  declaredBps: number;
}

/**
 * The token's declared tokenomics: donut + list of parts, with the live balance of each address
 * the owner named. Hidden for visitors when nothing is declared; the owner sees "Add tokenomics".
 */
@Component({
  selector: 'app-tokenomics-card',
  imports: [DatePipe, ShortAddressPipe, UnitsPipe, TokenomicsChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tokenomics(); as t) {
      <section class="card tokenomics" aria-labelledby="tokenomics-title">
        <div class="head">
          <div>
            <h2 id="tokenomics-title">Tokenomics</h2>
            <p class="muted small">
              Declared by the owner · updated {{ t.updatedAt | date: 'mediumDate' }}. The Launchpad
              checks that the parts add up to the supply; it doesn't enforce the locks or vesting
              they describe.
            </p>
          </div>
          @if (isOwner()) {
            <button class="btn btn-ghost btn-sm" type="button" (click)="edit.emit()">Edit</button>
          }
        </div>

        @if (supplyNote(); as note) {
          <p class="notice small-notice">{{ note }}</p>
        }

        <div class="layout">
          <app-tokenomics-chart
            class="donut"
            [slices]="slices()"
            [centerValue]="centerValue()"
            [decimals]="project().decimals"
            [symbol]="project().symbol"
            [summary]="summary()"
            [(active)]="active"
          />
          <ol class="parts">
            @for (part of t.allocations; track $index; let i = $index) {
              <li
                class="part"
                [class.active]="active() === i"
                [style.--part-color]="color(i)"
                (mouseenter)="active.set(i)"
                (mouseleave)="active.set(null)"
              >
                <div class="main">
                  <div class="what">
                    <span class="pct">{{ percent(i) }}</span>
                    <span class="purpose">{{ part.purpose }}</span>
                  </div>
                  @if (part.description) {
                    <p class="description">{{ part.description }}</p>
                  }
                </div>
                <div class="amount">
                  <span class="muted tiny">Amount</span>
                  <span class="value">{{ part.amount | units: project().decimals }}</span>
                </div>
                @if (part.holder) {
                  <div class="holder">
                    @if (explorerUrl(part.holder); as url) {
                      <a class="mono" [href]="url" target="_blank" rel="noopener noreferrer">{{
                        part.holder | shortAddress
                      }}</a>
                    } @else {
                      <span class="mono">{{ part.holder | shortAddress }}</span>
                    }
                    @if (holdings().get(part.holder); as h) {
                      @if (h.balance === undefined) {
                        <span class="skeleton" style="width: 90px"></span>
                      } @else if (h.balance === null) {
                        <span class="muted">balance unavailable</span>
                      } @else {
                        <span class="muted">holds now {{ heldPercent(h) }}</span>
                        @if (differs(h)) {
                          <span class="differs" [title]="differsTitle(h)">
                            <span aria-hidden="true">⚠</span> differs from declared
                          </span>
                        }
                      }
                    }
                  </div>
                }
              </li>
            }
          </ol>
        </div>
      </section>
    } @else if (tokenomics() === null && isOwner()) {
      <section class="card tokenomics empty-state">
        <div>
          <h2>Tokenomics</h2>
          <p class="muted small">
            Show holders how the supply is split: team, liquidity, community… as a chart on this
            page. You pay only the storage, no Launchpad fee.
          </p>
        </div>
        <button class="btn btn-red btn-sm" type="button" (click)="edit.emit()">
          Add tokenomics
        </button>
      </section>
    }
  `,
  styles: `
    .tokenomics {
      overflow: hidden;
      margin-bottom: 16px;
      background:
        radial-gradient(420px 220px at 0% 0%, var(--blue-glow), transparent 70%),
        radial-gradient(420px 220px at 100% 100%, rgba(255, 45, 66, 0.16), transparent 70%),
        var(--surface-glass);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl);
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    h2 {
      margin-bottom: 6px;
      font-size: 18px;
    }
    .small {
      margin: 0;
      font-size: 13px;
      max-width: 60ch;
    }
    .small-notice {
      margin: 16px 0 0;
      font-size: 14px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
      gap: 24px;
      align-items: center;
      margin-top: 16px;
    }
    .parts {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .part {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 4px 16px;
      padding: 12px 14px 12px 17px;
      border-radius: var(--radius-md);
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      transition:
        border-color 150ms ease,
        background 150ms ease;
    }
    .part::before {
      content: '';
      position: absolute;
      inset: 8px auto 8px 0;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: var(--part-color);
    }
    .part.active {
      border-color: var(--border-strong);
      background: var(--bg-elevated-2);
    }
    .main {
      min-width: 0;
    }
    .what {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 8px;
    }
    .pct {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .purpose {
      overflow-wrap: anywhere;
    }
    .description {
      margin: 2px 0 0;
      color: var(--gray-500);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .amount {
      display: grid;
      justify-items: end;
      align-content: start;
      text-align: right;
    }
    .tiny {
      font-size: 11px;
    }
    .value {
      font-family: var(--font-display);
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .holder {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 12px;
      font-size: 13px;
    }
    .holder a {
      color: var(--gray-300);
    }
    .differs {
      color: var(--yellow);
    }
    .empty-state {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    @media (max-width: 899px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .donut {
        max-width: 400px;
        width: 100%;
        margin: 0 auto;
      }
    }
  `,
})
export class TokenomicsCard {
  private readonly tokens = inject(TokenReader);
  private readonly networks = inject(NetworkStore);

  readonly project = input.required<Project>();
  readonly state = input.required<TokenState | null>();
  /** undefined while loading, null when none is declared. */
  readonly tokenomics = input.required<Tokenomics | null | undefined>();
  readonly isOwner = input(false);
  readonly edit = output<void>();

  protected readonly active = signal<number | null>(null);
  protected readonly holdings = signal(new Map<string, Holding>());

  private readonly bps = computed(() => {
    const t = this.tokenomics();
    return t
      ? shares(
          t.allocations.map((p) => p.amount),
          declaredSupply(t),
        )
      : [];
  });
  protected readonly slices = computed(() => chartSlices(this.tokenomics()?.allocations ?? []));
  protected readonly summary = computed(() => chartSummary(this.tokenomics()?.allocations ?? []));
  /** The supply the parts are measured against now (null until the token was read). */
  private readonly base = computed(() => {
    const state = this.state();
    return state ? baseSupply(this.project(), state) : null;
  });
  protected readonly centerValue = computed(() => {
    const t = this.tokenomics();
    return t ? formatUnits(declaredSupply(t), this.project().decimals) : '';
  });
  protected readonly supplyNote = computed(() => {
    const t = this.tokenomics();
    const base = this.base();
    if (!t || base === null) return null;
    const declared = declaredSupply(t);
    if (declared === base) return null;
    const decimals = this.project().decimals;
    return `Declared for a supply of ${formatUnits(declared, decimals)}; now it is ${formatUnits(base, decimals)}.`;
  });

  private loadRun = 0;

  constructor() {
    effect(() => {
      const t = this.tokenomics();
      const address = this.project().address;
      untracked(() => void this.loadHoldings(address, t ?? null));
    });
  }

  protected color(index: number): string {
    return partColor(index, this.tokenomics()?.allocations.length ?? 0);
  }

  protected percent(index: number): string {
    return formatBps(this.bps()[index] ?? 0);
  }

  protected heldPercent(h: Holding): string {
    const base = this.base();
    return base === null || h.balance == null ? '' : formatBps(shareOf(h.balance, base));
  }

  protected differs(h: Holding): boolean {
    const base = this.base();
    if (base === null || h.balance == null) return false;
    return shareOf(h.balance, base) !== h.declaredBps;
  }

  protected differsTitle(h: Holding): string {
    return `Declared: ${formatBps(h.declaredBps)}; holds now: ${this.heldPercent(h)}.`;
  }

  protected explorerUrl(address: string): string | null {
    return this.networks.network() === 'mainnet'
      ? `https://explorer.massa.net/mainnet/address/${address}`
      : null;
  }

  private async loadHoldings(token: string, t: Tokenomics | null): Promise<void> {
    const run = ++this.loadRun;
    const map = new Map<string, Holding>();
    const bps = this.bps();
    t?.allocations.forEach((part, i) => {
      if (!part.holder) return;
      const known = map.get(part.holder);
      map.set(part.holder, {
        balance: undefined,
        declaredBps: (known?.declaredBps ?? 0) + (bps[i] ?? 0),
      });
    });
    this.holdings.set(map);
    for (const holder of map.keys()) {
      const balance = await this.tokens.balanceOf(token, holder).catch(() => null);
      if (run !== this.loadRun) return;
      this.holdings.update((current) => {
        const next = new Map(current);
        next.set(holder, { ...next.get(holder)!, balance });
        return next;
      });
    }
  }
}
