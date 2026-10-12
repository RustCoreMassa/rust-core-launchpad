import { formatUnits } from '../utils/token-amount';
import { parseSupply } from './launch-rules';
import { Allocation, Project, SOURCE_LAUNCHED, Tokenomics, writeTokenomics } from './records';
import { TokenState } from './token-reader';

/**
 * Declared tokenomics (phase 8): the rules of the Launchpad SC (smart-contract/assembly/lib/
 * launchpad/rules.ts, assertAllocations) checked in the editor, the percentages the pages show
 * and the editor's rows. Percentages are kept in basis points (1 bps = 0.01 %).
 */

export const MAX_ALLOCATIONS = 30;
export const PURPOSE_MAX = 40;
export const ALLOCATION_DESCRIPTION_MAX = 140;
export const FULL_BPS = 10_000;

const ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Chart colours, in the order of the parts (checked for colour blindness on #111116). */
export const PART_COLORS = [
  '#496cef',
  '#ea3b48',
  '#18a7a1',
  '#e16c10',
  '#2aa654',
  '#d44996',
  '#b5900a',
];
export const OTHER_COLOR = '#6b6b75';

/** A part's colour: past 7 parts, the 7th and later share the grey "Other". */
export function partColor(index: number, count: number): string {
  if (count > PART_COLORS.length && index >= PART_COLORS.length - 1) return OTHER_COLOR;
  return PART_COLORS[index] ?? OTHER_COLOR;
}

/**
 * What the parts must add up to (the contract reads the same): the max supply of an RC-Token
 * launched as mintable, else the current total supply.
 */
export function baseSupply(project: Project, state: TokenState): bigint {
  return project.source === SOURCE_LAUNCHED && state.template?.mintable
    ? state.template.maxSupply
    : state.totalSupply;
}

export function declaredSupply(tokenomics: Tokenomics): bigint {
  return tokenomics.allocations.reduce((sum, part) => sum + part.amount, 0n);
}

/**
 * Each amount's share of `total` in basis points, rounded by the largest remainders so that
 * parts adding up to the total show exactly 100.00 %.
 */
export function shares(amounts: bigint[], total: bigint): number[] {
  if (total <= 0n) return amounts.map(() => 0);
  const full = BigInt(FULL_BPS);
  const floors = amounts.map((a) => (a * full) / total);
  const remainders = amounts.map((a) => (a * full) % total);
  const sum = amounts.reduce((s, a) => s + a, 0n);
  const target = sum === total ? full : (sum * full + total / 2n) / total;
  let missing = Number(target - floors.reduce((s, f) => s + f, 0n));
  const order = amounts
    .map((_, i) => i)
    .sort((a, b) =>
      remainders[b] > remainders[a] ? 1 : remainders[b] < remainders[a] ? -1 : a - b,
    );
  const result = floors.map(Number);
  for (const i of order) {
    if (missing <= 0) break;
    if (remainders[i] === 0n) continue;
    result[i]++;
    missing--;
  }
  return result;
}

/** One share, rounded half up: for a single value shown on its own. */
export function shareOf(amount: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((amount * BigInt(FULL_BPS) * 2n + total) / (total * 2n));
}

/** 1250 → "12.50%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** "12.5" or "12.50 %" → 1250; null unless 0 < value ≤ 100 with at most 2 decimals. */
export function parsePercent(text: string): number | null {
  const clean = text.trim().replace(/\s*%$/, '').replace(',', '.');
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps > 0 && bps <= FULL_BPS ? bps : null;
}

export function amountForBps(bps: number, supply: bigint): bigint {
  return (supply * BigInt(bps)) / BigInt(FULL_BPS);
}

export function purposeError(purpose: string): string | null {
  if (purpose.length === 0) return 'Name this part.';
  if (purpose.length > PURPOSE_MAX) return `Use at most ${PURPOSE_MAX} characters.`;
  if (purpose.trim() !== purpose) return 'Remove the spaces at the start or end.';
  if (CONTROL.test(purpose)) return 'Remove the special characters.';
  return null;
}

export function partDescriptionError(text: string): string | null {
  if (text.length > ALLOCATION_DESCRIPTION_MAX)
    return `Use at most ${ALLOCATION_DESCRIPTION_MAX} characters.`;
  if (CONTROL.test(text)) return 'Use a single line without special characters.';
  return null;
}

export function holderError(holder: string): string | null {
  return holder === '' || ADDRESS.test(holder) ? null : 'Enter a Massa address (AU… or AS…).';
}

/** The contract's rule for a whole declaration, as one message; null when it would pass. */
export function allocationsError(allocations: Allocation[], supply: bigint): string | null {
  if (allocations.length === 0 || allocations.length > MAX_ALLOCATIONS)
    return `Use 1 to ${MAX_ALLOCATIONS} parts.`;
  for (const part of allocations) {
    const error =
      purposeError(part.purpose) ??
      partDescriptionError(part.description) ??
      holderError(part.holder) ??
      (part.amount > 0n ? null : 'Each part needs an amount above zero.');
    if (error) return `${part.purpose || 'A part'}: ${error}`;
  }
  const sum = allocations.reduce((s, part) => s + part.amount, 0n);
  if (sum !== supply) return 'The parts must add up to 100% of the supply.';
  return null;
}

/**
 * Storage the declaration takes, upper bound: the record, its key (`tkm:` + 8 bytes) and the
 * entry, at 0.0001 MAS a byte, plus a small margin. The contract refunds what isn't used (and
 * frees storage when a list gets shorter).
 */
export function tokenomicsCost(allocations: Allocation[]): bigint {
  if (allocations.length === 0) return TOKENOMICS_MARGIN;
  const record = writeTokenomics({ allocations, updatedAt: 0 }).length;
  return BigInt(record + 12 + 4) * 100_000n + TOKENOMICS_MARGIN;
}

export const TOKENOMICS_MARGIN = 10_000_000n; // 0.01 MAS

// ---- editor rows ------------------------------------------------------------------------------

/** A part as edited: the percentage or the amount is typed, the other one follows. */
export interface AllocationRow {
  /** Stable key for the list (rows move). */
  key: number;
  purpose: string;
  /** As typed, when `source` is 'percent'. */
  percent: string;
  /** Whole tokens as typed, when `source` is 'amount'. */
  amount: string;
  description: string;
  holder: string;
  source: 'percent' | 'amount';
}

let nextKey = 1;

export function newRow(fields: Partial<AllocationRow> = {}): AllocationRow {
  return {
    key: nextKey++,
    purpose: '',
    percent: '',
    amount: '',
    description: '',
    holder: '',
    source: 'percent',
    ...fields,
  };
}

export function rowsFromAllocations(allocations: Allocation[], decimals: number): AllocationRow[] {
  return allocations.map((part) =>
    newRow({
      purpose: part.purpose,
      amount: formatUnits(part.amount, decimals),
      description: part.description,
      holder: part.holder,
      source: 'amount',
    }),
  );
}

/**
 * Each row's amount in token units (null when what's typed isn't valid). Percentages round
 * down; when the typed percentages and amounts make exactly 100 %, the units lost to rounding
 * go to the last row typed as a percentage, so the parts add up to the supply.
 */
export function rowAmounts(
  rows: AllocationRow[],
  supply: bigint | null,
  decimals: number,
): (bigint | null)[] {
  const amounts = rows.map((row) => {
    if (row.source === 'amount') return parseSupply(row.amount, decimals);
    const bps = parsePercent(row.percent);
    return bps === null || supply === null ? null : amountForBps(bps, supply);
  });
  if (supply === null || amounts.some((a) => a === null)) return amounts;
  const full = BigInt(FULL_BPS);
  let typed = 0n; // Σ percent × supply + Σ amount × 10 000, compared with supply × 10 000
  rows.forEach((row, i) => {
    typed +=
      row.source === 'percent'
        ? BigInt(parsePercent(row.percent)!) * supply
        : (amounts[i] as bigint) * full;
  });
  const last = rows.map((row) => row.source).lastIndexOf('percent');
  const sum = amounts.reduce<bigint>((s, a) => s + (a as bigint), 0n);
  if (last >= 0 && typed === supply * full && sum < supply)
    amounts[last] = (amounts[last] as bigint) + (supply - sum);
  return amounts;
}

export type RowErrors = Partial<Record<'purpose' | 'share' | 'description' | 'holder', string>>;

export function rowErrors(row: AllocationRow, amount: bigint | null): RowErrors {
  const errors: RowErrors = {};
  const purpose = purposeError(row.purpose);
  if (purpose) errors.purpose = purpose;
  if (amount === null)
    errors.share = row.source === 'percent' ? 'Enter a percentage up to 100.' : 'Enter an amount.';
  else if (amount <= 0n) errors.share = 'Must be greater than zero.';
  const description = partDescriptionError(row.description);
  if (description) errors.description = description;
  const holder = holderError(row.holder.trim());
  if (holder) errors.holder = holder;
  return errors;
}

/** The rows as the contract takes them; null while a row isn't valid. */
export function rowsToAllocations(
  rows: AllocationRow[],
  supply: bigint | null,
  decimals: number,
): Allocation[] | null {
  const amounts = rowAmounts(rows, supply, decimals);
  if (rows.some((row, i) => Object.keys(rowErrors(row, amounts[i])).length > 0)) return null;
  return rows.map((row, i) => ({
    purpose: row.purpose,
    amount: amounts[i] as bigint,
    description: row.description,
    holder: row.holder.trim(),
  }));
}

/** Null when the rows can be saved: none at all, or valid parts making exactly 100 %. */
export function rowsError(
  rows: AllocationRow[],
  supply: bigint | null,
  decimals: number,
): string | null {
  if (rows.length === 0) return null;
  if (supply === null || supply <= 0n) return 'Set the supply first.';
  if (rows.length > MAX_ALLOCATIONS) return `Use at most ${MAX_ALLOCATIONS} parts.`;
  const allocations = rowsToAllocations(rows, supply, decimals);
  if (!allocations) return 'Complete the parts marked in red.';
  const sum = allocations.reduce((s, part) => s + part.amount, 0n);
  if (sum < supply)
    return `Allocate the whole supply: ${formatBps(shareOf(supply - sum, supply))} left.`;
  if (sum > supply)
    return `The parts exceed the supply by ${formatBps(shareOf(sum - supply, supply))}.`;
  return null;
}

// ---- quick starts -----------------------------------------------------------------------------

export interface TokenomicsPreset {
  name: string;
  parts: { purpose: string; percent: string; description?: string }[];
}

export const PRESETS: TokenomicsPreset[] = [
  {
    name: 'Community',
    parts: [
      { purpose: 'Community rewards', percent: '40' },
      { purpose: 'Liquidity', percent: '25' },
      { purpose: 'Treasury', percent: '20' },
      { purpose: 'Team', percent: '15', description: '12 months cliff, 24 months vesting' },
    ],
  },
  {
    name: 'Team + investors',
    parts: [
      { purpose: 'Public sale', percent: '30' },
      { purpose: 'Investors', percent: '20', description: '6 months cliff, 18 months vesting' },
      { purpose: 'Team', percent: '20', description: '12 months cliff, 24 months vesting' },
      { purpose: 'Liquidity', percent: '15' },
      { purpose: 'Treasury', percent: '15' },
    ],
  },
  {
    name: 'Fair launch',
    parts: [
      { purpose: 'Public sale', percent: '80' },
      { purpose: 'Liquidity', percent: '20' },
    ],
  },
];

export function rowsFromPreset(preset: TokenomicsPreset): AllocationRow[] {
  return preset.parts.map((part) => newRow({ ...part, source: 'percent' }));
}

// ---- chart --------------------------------------------------------------------------------------

/** One segment of the donut: a part, or past 7 parts the 7th onwards together as "Other". */
export interface ChartSlice {
  label: string;
  bps: number;
  /** Token units. */
  amount: bigint;
  color: string;
  /** Indexes of the parts it stands for, in the list. */
  parts: number[];
}

/** Grey of the "Not allocated" segment the editor shows while parts are missing. */
export const FREE_COLOR = '#26262e';

/**
 * The donut's segments. With `supply` (the editor), shares are of the supply and what's left
 * shows as a "Not allocated" segment; without, of the parts' own sum (a declaration).
 */
export function chartSlices(
  parts: { purpose: string; amount: bigint }[],
  supply?: bigint,
): ChartSlice[] {
  const sum = parts.reduce((s, p) => s + p.amount, 0n);
  const total = supply !== undefined && supply > sum ? supply : sum;
  const bps = shares(
    parts.map((p) => p.amount),
    total,
  );
  const slices: ChartSlice[] = [];
  parts.forEach((part, i) => {
    const color = partColor(i, parts.length);
    const other = slices.at(-1);
    if (color === OTHER_COLOR && other?.color === OTHER_COLOR) {
      other.bps += bps[i];
      other.amount += part.amount;
      other.parts.push(i);
    } else {
      slices.push({
        label: color === OTHER_COLOR ? 'Other' : part.purpose || 'Unnamed',
        bps: bps[i],
        amount: part.amount,
        color,
        parts: [i],
      });
    }
  });
  if (total > sum) {
    const free = total - sum;
    slices.push({
      label: 'Not allocated',
      bps: shareOf(free, total),
      amount: free,
      color: FREE_COLOR,
      parts: [],
    });
  }
  return slices;
}

/** The donut's text version: "3 parts: Team 20.00%, Liquidity 30.00%, Community 50.00%". */
export function chartSummary(parts: { purpose: string; amount: bigint }[]): string {
  const total = parts.reduce((s, p) => s + p.amount, 0n);
  const bps = shares(
    parts.map((p) => p.amount),
    total,
  );
  const list = parts.map((p, i) => `${p.purpose || 'Unnamed'} ${formatBps(bps[i])}`).join(', ');
  return `${parts.length} ${parts.length === 1 ? 'part' : 'parts'}: ${list}`;
}
