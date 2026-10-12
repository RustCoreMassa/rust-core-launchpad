import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { ChartSlice, formatBps } from '../../../core/launchpad/tokenomics';
import { formatUnits } from '../../../core/utils/token-amount';

const W = 480;
const H = 340;
const CX = W / 2;
const CY = H / 2;
const OUTER = 118;
const INNER = OUTER * 0.62;
const LABEL_RADIUS = OUTER + 18;
const LABEL_GAP = 34;
/** Segments below 3 % get no label on the chart (the list shows them). */
const LABEL_MIN_BPS = 300;
const LABEL_CHARS = 16;

interface Segment {
  slice: ChartSlice;
  index: number;
  path: string;
  /** Tooltip anchor, in % of the chart box. */
  tipX: number;
  tipY: number;
}

interface Label {
  index: number;
  x: number;
  y: number;
  anchor: 'start' | 'end' | 'middle';
  percent: string;
  purpose: string;
}

let nextId = 0;

/**
 * The tokenomics donut: SVG drawn here, no chart library. Hovering (or tapping) a segment sets
 * `active` to its first part, so the list next to it can highlight the same part, and back.
 * The list is the text version; the chart carries a summary for screen readers.
 */
@Component({
  selector: 'app-tokenomics-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart" [class.animate]="animate()">
      <svg
        [attr.viewBox]="viewBox"
        role="img"
        [attr.aria-label]="summary()"
        (mouseleave)="active.set(null)"
      >
        <defs>
          <mask [attr.id]="maskId">
            <circle
              class="reveal"
              [attr.cx]="cx"
              [attr.cy]="cy"
              [attr.r]="maskRadius"
              [attr.stroke-width]="maskWidth"
              [attr.stroke-dasharray]="maskLength"
              [attr.transform]="'rotate(-90 ' + cx + ' ' + cy + ')'"
            />
          </mask>
        </defs>
        <g [attr.mask]="'url(#' + maskId + ')'">
          @if (!segments().length) {
            <path class="empty" [attr.d]="emptyRing" />
          }
          @for (s of segments(); track s.index) {
            <path
              class="segment"
              [attr.d]="s.path"
              [attr.fill]="s.slice.color"
              [class.dim]="dimmed(s.slice)"
              (mouseenter)="active.set(s.slice.parts[0] ?? null)"
              (click)="toggle(s.slice)"
            />
          }
        </g>
        @for (l of labels(); track l.index) {
          <text
            class="label"
            [attr.x]="l.x"
            [attr.y]="l.y"
            [attr.text-anchor]="l.anchor"
            [class.dim]="dimmed(segments()[l.index].slice)"
          >
            <tspan class="pct" [attr.x]="l.x">{{ l.percent }}</tspan>
            <tspan class="purpose" [attr.x]="l.x" dy="15">{{ l.purpose }}</tspan>
          </text>
        }
        <text class="center-label" [attr.x]="cx" [attr.y]="cy - 14" text-anchor="middle">
          {{ centerLabel() }}
        </text>
        <text
          class="center-value"
          [attr.x]="cx"
          [attr.y]="cy + 14"
          text-anchor="middle"
          [style.font-size.px]="centerSize()"
        >
          {{ centerValue() }}
        </text>
      </svg>
      @if (tip(); as t) {
        <div class="tip" role="presentation" [style.left.%]="t.tipX" [style.top.%]="t.tipY">
          <strong>{{ t.slice.label }}</strong>
          <span>{{ percent(t.slice) }} · {{ amount(t.slice) }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .chart {
      position: relative;
      width: 100%;
      max-width: 480px;
      margin: 0 auto;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }
    .reveal {
      fill: none;
      stroke: #fff;
    }
    .animate .reveal {
      animation: reveal 600ms var(--ease-out) both;
    }
    @keyframes reveal {
      from {
        stroke-dashoffset: var(--reveal-length);
      }
      to {
        stroke-dashoffset: 0;
      }
    }
    .segment {
      stroke: var(--bg-elevated);
      stroke-width: 2px;
      cursor: pointer;
      transition: opacity 150ms ease;
    }
    .empty {
      fill: var(--bg-elevated-2);
    }
    .dim {
      opacity: 0.3;
    }
    .label {
      transition: opacity 150ms ease;
      pointer-events: none;
    }
    .pct {
      fill: var(--white);
      font: 700 15px var(--font-display);
    }
    .purpose {
      fill: var(--gray-500);
      font: 500 12px var(--font-body);
    }
    .center-label {
      fill: var(--gray-500);
      font: 500 12px var(--font-body);
    }
    .center-value {
      fill: var(--white);
      font-family: var(--font-display);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .tip {
      position: absolute;
      z-index: 2;
      display: grid;
      gap: 2px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      background: var(--bg-elevated-2);
      border: 1px solid var(--border-strong);
      box-shadow: var(--shadow-md);
      color: var(--white);
      font-size: 13px;
      white-space: nowrap;
      transform: translate(-50%, calc(-100% - 8px));
      pointer-events: none;
    }
    .tip span {
      color: var(--gray-300);
      font-variant-numeric: tabular-nums;
    }
    @media (prefers-reduced-motion: reduce) {
      .animate .reveal {
        animation: none;
      }
      .segment,
      .label {
        transition: none;
      }
    }
  `,
  host: { '[style.--reveal-length]': 'maskLength' },
})
export class TokenomicsChart {
  readonly slices = input.required<ChartSlice[]>();
  /** Shown under "Total supply" in the middle. */
  readonly centerValue = input('');
  readonly centerLabel = input('Total supply');
  readonly decimals = input(0);
  readonly symbol = input('');
  /** Screen-reader summary, e.g. "3 parts: Team 20.00%, …". */
  readonly summary = input('');
  /** Unfold the segments on first display (skipped with prefers-reduced-motion). */
  readonly animate = input(true);
  /** Index of the highlighted part, shared with the list. */
  readonly active = model<number | null>(null);

  protected readonly viewBox = `0 0 ${W} ${H}`;
  protected readonly cx = CX;
  protected readonly cy = CY;
  protected readonly maskId = `tokenomics-reveal-${nextId++}`;
  protected readonly maskRadius = (OUTER + INNER) / 2;
  protected readonly maskWidth = OUTER - INNER + 8;
  protected readonly maskLength = 2 * Math.PI * ((OUTER + INNER) / 2);
  protected readonly emptyRing = ring(0, 2 * Math.PI);

  protected readonly segments = computed<Segment[]>(() => {
    const slices = this.slices().filter((s) => s.bps > 0);
    const total = slices.reduce((sum, s) => sum + s.bps, 0);
    let start = 0;
    return slices.map((slice, index) => {
      const sweep = total ? (slice.bps / total) * 2 * Math.PI : 0;
      const middle = start + sweep / 2;
      const segment: Segment = {
        slice,
        index,
        path: ring(start, start + sweep),
        tipX: ((CX + Math.sin(middle) * OUTER) / W) * 100,
        tipY: ((CY - Math.cos(middle) * OUTER) / H) * 100,
      };
      start += sweep;
      return segment;
    });
  });

  protected readonly labels = computed<Label[]>(() => {
    const segments = this.segments();
    const total = segments.reduce((sum, s) => sum + s.slice.bps, 0);
    let start = 0;
    const labels: Label[] = [];
    for (const s of segments) {
      const sweep = total ? (s.slice.bps / total) * 2 * Math.PI : 0;
      const middle = start + sweep / 2;
      start += sweep;
      if (s.slice.bps < LABEL_MIN_BPS) continue;
      const x = CX + Math.sin(middle) * LABEL_RADIUS;
      const y = CY - Math.cos(middle) * LABEL_RADIUS;
      const side = Math.abs(x - CX) < 12 ? 'middle' : x > CX ? 'start' : 'end';
      labels.push({
        index: s.index,
        x,
        // The two lines sit around the anchor point; above the ring they grow upwards.
        y: y < CY ? y - 10 : y + 4,
        anchor: side,
        percent: formatBps(s.slice.bps),
        purpose: shorten(s.slice.label),
      });
    }
    spread(labels.filter((l) => l.anchor !== 'end'));
    spread(labels.filter((l) => l.anchor === 'end'));
    return labels;
  });

  protected readonly tip = computed(() => {
    const active = this.active();
    return active === null
      ? null
      : (this.segments().find((s) => s.slice.parts.includes(active)) ?? null);
  });

  protected readonly centerSize = computed(() => {
    const length = this.centerValue().length || 1;
    return Math.max(11, Math.min(28, Math.floor(200 / length)));
  });

  protected dimmed(slice: ChartSlice): boolean {
    const active = this.active();
    return active !== null && !slice.parts.includes(active);
  }

  protected toggle(slice: ChartSlice): void {
    const first = slice.parts[0] ?? null;
    this.active.set(this.active() === first ? null : first);
  }

  protected percent(slice: ChartSlice): string {
    return formatBps(slice.bps);
  }

  protected amount(slice: ChartSlice): string {
    const symbol = this.symbol();
    return `${formatUnits(slice.amount, this.decimals())}${symbol ? ` ${symbol}` : ''}`;
  }
}

/** A ring segment from angle a0 to a1 (radians, 0 = top, clockwise). */
function ring(a0: number, a1: number): string {
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {
    // A full ring: two half rings (an arc can't start and end at the same point).
    return ring(0, Math.PI) + ' ' + ring(Math.PI, 2 * Math.PI);
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) =>
    `${(CX + Math.sin(a) * r).toFixed(2)} ${(CY - Math.cos(a) * r).toFixed(2)}`;
  return [
    `M ${p(OUTER, a0)}`,
    `A ${OUTER} ${OUTER} 0 ${large} 1 ${p(OUTER, a1)}`,
    `L ${p(INNER, a1)}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${p(INNER, a0)}`,
    'Z',
  ].join(' ');
}

function shorten(text: string): string {
  return text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text;
}

/** Pushes the labels of one side apart vertically, so two lines never overlap. */
function spread(labels: Label[]): void {
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < LABEL_GAP) labels[i].y = labels[i - 1].y + LABEL_GAP;
  }
}
