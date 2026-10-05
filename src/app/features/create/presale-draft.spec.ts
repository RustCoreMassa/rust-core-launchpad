import { Args } from '@massalabs/massa-web3';
import {
  EMPTY_PRESALE_DRAFT,
  PresaleDraft,
  createPresaleArgs,
  presaleTerms,
} from './presale-draft';

const MAS = 1_000_000_000n;
const NOW = Date.UTC(2026, 9, 5, 12, 0);
const valid: PresaleDraft = {
  ...EMPTY_PRESALE_DRAFT,
  rate: '1000',
  softCap: '50',
  hardCap: '100',
  minBuy: '1',
  maxBuy: '40',
};

describe('presale draft', () => {
  it('turns the form into contract values; tokens for sale cover the hard cap exactly', () => {
    const { terms, errors } = presaleTerms(valid, 9, NOW);
    expect(errors).toEqual({});
    expect(terms!.rate).toBe(1_000n * 10n ** 9n);
    expect(terms!.hardCap).toBe(100n * MAS);
    expect(terms!.tokensForSale).toBe(100_000n * 10n ** 9n);
    expect(terms!.start).toBe(0); // now
    expect(terms!.end).toBe(NOW + 72 * 3_600_000 + 600_000);
  });

  it('reports each invalid field', () => {
    const { terms, errors } = presaleTerms(
      { ...valid, softCap: '101', minBuy: '50', maxBuy: '10', hours: 0, rate: '0' },
      9,
      NOW,
    );
    expect(terms).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['hours', 'maxBuy', 'rate', 'softCap']);
  });

  it('checks a scheduled start', () => {
    const past = presaleTerms({ ...valid, start: '2026-10-01T10:00' }, 9, NOW);
    expect(past.errors.start).toBe('Pick a moment in the future.');
    const later = presaleTerms({ ...valid, start: '2026-10-06T10:00' }, 9, NOW);
    expect(later.terms!.start).toBe(new Date('2026-10-06T10:00').getTime());
    expect(later.terms!.end).toBe(later.terms!.start + 72 * 3_600_000);
  });

  it('builds createPresale args in the contract’s order', () => {
    const { terms } = presaleTerms({ ...valid, maxBuy: '' }, 9, NOW);
    const args = new Args(createPresaleArgs('AS1token', terms!).serialize());
    expect(args.nextString()).toBe('AS1token');
    expect(args.nextU256()).toBe(100_000n * 10n ** 9n);
    expect(args.nextU256()).toBe(1_000n * 10n ** 9n);
    expect(args.nextU64()).toBe(50n * MAS);
    expect(args.nextU64()).toBe(100n * MAS);
    expect(args.nextU64()).toBe(MAS);
    expect(args.nextU64()).toBe(0n); // no maximum
    expect(args.nextU64()).toBe(0n); // start now
    expect(args.nextU64()).toBe(BigInt(terms!.end));
  });
});
