import { LaunchpadConfig } from '../../core/launchpad/records';
import { configFromForm, feeFormOf, isWasm, percentToBps, templateCoins } from './admin-forms';

const CONFIG: LaunchpadConfig = {
  tokenFee: 1_000_000_000n,
  collectionFee: 1_500_000_000n,
  importFee: 500_000_000n,
  presaleFeeBps: 250,
  deployDeposit: 100_000_000n,
  paused: true,
};

describe('admin forms', () => {
  it('turns percentages into basis points, up to the 10 % cap', () => {
    expect(percentToBps('2')).toBe(200);
    expect(percentToBps('2.5')).toBe(250);
    expect(percentToBps('0,25')).toBe(25);
    expect(percentToBps('10')).toBe(1_000);
    expect(percentToBps('10.01')).toBeNull();
    expect(percentToBps('1.234')).toBeNull();
    expect(percentToBps('-1')).toBeNull();
    expect(percentToBps('')).toBeNull();
  });

  it('round-trips a config through the form, keeping the pause flag', () => {
    const result = configFromForm(feeFormOf(CONFIG), true);
    expect(result).toEqual({ config: CONFIG });
  });

  it('reports every bad field', () => {
    const form = { ...feeFormOf(CONFIG), tokenFee: 'abc', importFee: '', presaleFee: '20' };
    const result = configFromForm(form, false);
    expect('errors' in result && Object.keys(result.errors).sort()).toEqual([
      'importFee',
      'presaleFee',
      'tokenFee',
    ]);
  });

  it('recognizes WebAssembly files and prices a template upload', () => {
    expect(isWasm(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 9]))).toBe(true);
    expect(isWasm(new TextEncoder().encode('{"not":"wasm"}'))).toBe(false);
    expect(templateCoins(38_523)).toBe(3_872_300_000n + 50_000_000n);
  });
});
