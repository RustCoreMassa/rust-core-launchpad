import { Args } from '@massalabs/massa-web3';
import { TOKENOMICS_VERSION, atLeast } from './launchpad-reader';
import { EMPTY_INFO, KIND_TOKEN, Project, SOURCE_IMPORTED, SOURCE_LAUNCHED } from './records';
import { readTokenomics, writeAllocations, writeTokenomics } from './records';
import {
  OTHER_COLOR,
  PART_COLORS,
  PRESETS,
  allocationsError,
  baseSupply,
  formatBps,
  newRow,
  parsePercent,
  partColor,
  rowAmounts,
  rowsError,
  rowsFromPreset,
  rowsToAllocations,
  shareOf,
  shares,
  tokenomicsCost,
} from './tokenomics';

const ALICE = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';

function project(source: number): Project {
  return {
    kind: KIND_TOKEN,
    id: 1n,
    address: 'AS1token',
    source,
    creator: ALICE,
    createdAt: 0,
    templateVersion: 1,
    codeHash: new Uint8Array(),
    name: 'RustCore Token',
    symbol: 'RCT',
    decimals: 0,
    mutable: false,
    category: 0,
    verified: false,
    hidden: false,
    royaltyBps: 0,
    royaltyReceiver: '',
    info: EMPTY_INFO,
  };
}

const template = (mintable: boolean) => ({
  template: 'RC-Token',
  version: '1.0.0',
  mintable,
  maxSupply: 5_000n,
  burnable: false,
  mutable: false,
});

describe('tokenomics', () => {
  it('rounds shares by the largest remainders to exactly 100.00 %', () => {
    expect(shares([1n, 1n, 1n], 3n)).toEqual([3334, 3333, 3333]);
    expect(shares([2n, 1n], 3n)).toEqual([6667, 3333]);
    expect(shares([500n, 500n], 1_000n)).toEqual([5000, 5000]);
    const many = shares([1n, 1n, 1n, 1n, 1n, 1n, 1n], 7n);
    expect(many.reduce((s, x) => s + x, 0)).toBe(10_000);
    // Parts that don't add up to the total keep their own (rounded) share.
    expect(shares([250n], 1_000n)).toEqual([2500]);
    expect(shares([1n], 0n)).toEqual([0]);
  });

  it('formats and parses percentages', () => {
    expect(formatBps(1250)).toBe('12.50%');
    expect(shareOf(1n, 3n)).toBe(3333);
    expect(shareOf(2n, 3n)).toBe(6667);
    expect(parsePercent('12.5')).toBe(1250);
    expect(parsePercent('12,25 %')).toBe(1225);
    expect(parsePercent('100')).toBe(10_000);
    expect(parsePercent('100.01')).toBeNull();
    expect(parsePercent('0')).toBeNull();
    expect(parsePercent('1.234')).toBeNull();
    expect(parsePercent('abc')).toBeNull();
  });

  it('takes the max supply of a launched mintable token, else the total supply', () => {
    const state = (mintable: boolean | null) => ({
      totalSupply: 1_000n,
      owner: ALICE,
      template: mintable === null ? null : template(mintable),
    });
    expect(baseSupply(project(SOURCE_LAUNCHED), state(true))).toBe(5_000n);
    expect(baseSupply(project(SOURCE_LAUNCHED), state(false))).toBe(1_000n);
    expect(baseSupply(project(SOURCE_IMPORTED), state(true))).toBe(1_000n);
    expect(baseSupply(project(SOURCE_IMPORTED), state(null))).toBe(1_000n);
  });

  it('colours the parts in order, the 7th onwards grey past 7 parts', () => {
    expect(partColor(0, 3)).toBe(PART_COLORS[0]);
    expect(partColor(6, 7)).toBe(PART_COLORS[6]);
    expect(partColor(5, 9)).toBe(PART_COLORS[5]);
    expect(partColor(6, 9)).toBe(OTHER_COLOR);
    expect(partColor(8, 9)).toBe(OTHER_COLOR);
  });

  it('mirrors the contract rules', () => {
    const ok = [
      { purpose: 'Team', amount: 400n, description: '12 months cliff', holder: ALICE },
      { purpose: 'Liquidity', amount: 600n, description: '', holder: '' },
    ];
    expect(allocationsError(ok, 1_000n)).toBeNull();
    expect(allocationsError(ok, 1_001n)).toBe('The parts must add up to 100% of the supply.');
    expect(allocationsError([], 1_000n)).toBe('Use 1 to 30 parts.');
    const part = (fields: object) => [{ ...ok[0], amount: 1_000n, ...fields }];
    expect(allocationsError(part({ purpose: '' }), 1_000n)).toContain('Name this part.');
    expect(allocationsError(part({ purpose: 'P'.repeat(41) }), 1_000n)).toContain('40');
    expect(allocationsError(part({ purpose: 'Team ' }), 1_000n)).toContain('spaces');
    expect(allocationsError(part({ description: 'd'.repeat(141) }), 1_000n)).toContain('140');
    expect(allocationsError(part({ description: 'a\nb' }), 1_000n)).toContain('single line');
    expect(allocationsError(part({ holder: 'nope' }), 1_000n)).toContain('Massa address');
    expect(allocationsError(part({ amount: 0n }), 0n)).toContain('above zero');
    const many = Array.from({ length: 31 }, (_, i) => ({ ...ok[1], purpose: `P${i}`, amount: 1n }));
    expect(allocationsError(many, 31n)).toBe('Use 1 to 30 parts.');
  });

  it('turns typed percentages into amounts that add up to the supply', () => {
    const rows = [
      newRow({ purpose: 'A', percent: '33.33' }),
      newRow({ purpose: 'B', percent: '33.33' }),
      newRow({ purpose: 'C', percent: '33.34' }),
    ];
    // 1 001 units: each percentage rounds down, the rest goes to the last percentage row.
    expect(rowAmounts(rows, 1_001n, 0)).toEqual([333n, 333n, 335n]);
    expect(rowsError(rows, 1_001n, 0)).toBeNull();
    // Percentages short of 100 % keep their rounding: 1 % is still left.
    const short = rows.slice(0, 2).concat(newRow({ purpose: 'C', percent: '32.34' }));
    expect(rowsError(short, 1_000_000n, 0)).toBe('Allocate the whole supply: 1.00% left.');
  });

  it('mixes typed amounts and percentages', () => {
    const rows = [
      newRow({ purpose: 'Team', amount: '250', source: 'amount' }),
      newRow({ purpose: 'Rest', percent: '75' }),
    ];
    expect(rowAmounts(rows, 1_000n, 0)).toEqual([250n, 750n]);
    expect(rowsToAllocations(rows, 1_000n, 0)?.map((p) => p.amount)).toEqual([250n, 750n]);
    expect(rowAmounts(rows, 1_000n, 2)).toEqual([25_000n, 750n]);
    expect(rowsError(rows, 1_000n, 2)).toBe('The parts exceed the supply by 2475.00%.');
  });

  it('allows saving no parts at all, or a complete split only', () => {
    expect(rowsError([], null, 18)).toBeNull();
    expect(rowsError([newRow({ purpose: 'All', percent: '100' })], null, 18)).toBe(
      'Set the supply first.',
    );
    expect(rowsError([newRow({ percent: '100' })], 10n, 0)).toBe(
      'Complete the parts marked in red.',
    );
    expect(rowsToAllocations([newRow({ purpose: 'X', percent: 'x' })], 10n, 0)).toBeNull();
  });

  it('starts from presets that make exactly 100 %', () => {
    for (const preset of PRESETS) {
      expect(rowsError(rowsFromPreset(preset), 10n ** 24n, 18), preset.name).toBeNull();
    }
  });

  it('encodes allocations as the contract expects and reads its record back', () => {
    const allocations = [
      { purpose: 'Team', amount: 400n, description: 'Locked', holder: ALICE },
      { purpose: 'Liquidity', amount: 600n, description: '', holder: '' },
    ];
    const args = new Args(writeAllocations(new Args().addU64(7n), allocations).serialize());
    expect(args.nextU64()).toBe(7n);
    const bytes = writeTokenomics({ allocations, updatedAt: 1_790_000_000_000 });
    expect(readTokenomics(new Args(bytes))).toEqual({ allocations, updatedAt: 1_790_000_000_000 });
    expect(tokenomicsCost(allocations)).toBe(BigInt(bytes.length + 16) * 100_000n + 10_000_000n);
  });
});

describe('Launchpad version gate', () => {
  it('offers tokenomics from v1.1.0 on', () => {
    expect(atLeast('1.1.0', TOKENOMICS_VERSION)).toBe(true);
    expect(atLeast('1.10.0', TOKENOMICS_VERSION)).toBe(true);
    expect(atLeast('2.0.0', TOKENOMICS_VERSION)).toBe(true);
    expect(atLeast('1.0.0', TOKENOMICS_VERSION)).toBe(false);
    expect(atLeast('0.6.0', TOKENOMICS_VERSION)).toBe(false);
  });
});
