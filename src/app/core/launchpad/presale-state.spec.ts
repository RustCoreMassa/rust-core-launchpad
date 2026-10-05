import { PRESALE_CANCELLED, PRESALE_OPEN, PRESALE_SUCCESS, Presale } from './records';
import {
  contributionError,
  maxContribution,
  presalePhase,
  progressPercent,
  reachesSoftCap,
  timeLeft,
} from './presale-state';

const MAS = 1_000_000_000n;
const base: Presale = {
  id: 1n,
  tokenId: 1n,
  token: 'AS1token',
  creator: 'AU1alice',
  tokensForSale: 100_000n,
  rate: 1_000n,
  softCap: 50n * MAS,
  hardCap: 100n * MAS,
  minBuy: MAS,
  maxBuy: 40n * MAS,
  start: 1_000,
  end: 2_000,
  raised: 0n,
  contributors: 0,
  status: PRESALE_OPEN,
  withdrawn: false,
};

describe('presale state', () => {
  it('follows the clock while open', () => {
    expect(presalePhase(base, 999)).toBe('upcoming');
    expect(presalePhase(base, 1_000)).toBe('live');
    expect(presalePhase(base, 2_000)).toBe('ended');
    expect(presalePhase({ ...base, raised: 100n * MAS }, 1_500)).toBe('ended'); // hard cap
  });

  it('reports the stored outcome', () => {
    expect(presalePhase({ ...base, status: PRESALE_SUCCESS }, 1_500)).toBe('success');
    expect(presalePhase({ ...base, status: PRESALE_CANCELLED }, 500)).toBe('cancelled');
  });

  it('computes progress and the soft cap', () => {
    expect(progressPercent({ ...base, raised: 33n * MAS })).toBe(33);
    expect(progressPercent({ ...base, raised: (2n * MAS) / 3n })).toBe(0.6);
    expect(reachesSoftCap({ ...base, raised: 50n * MAS })).toBe(true);
    expect(reachesSoftCap({ ...base, raised: 49n * MAS })).toBe(false);
    expect(reachesSoftCap({ ...base, softCap: 0n })).toBe(false); // nothing raised
  });

  it('applies the contract’s contribution rules', () => {
    const live = { ...base, raised: 90n * MAS };
    expect(contributionError(live, 0n, 5n * MAS, 1_500)).toBeNull();
    expect(contributionError(live, 0n, 11n * MAS, 1_500)).toBe(
      'Above the amount left before the hard cap.',
    );
    expect(contributionError(base, 35n * MAS, 6n * MAS, 1_500)).toBe(
      'Above the maximum per wallet.',
    );
    expect(contributionError(base, 0n, MAS / 2n, 1_500)).toBe('Below the minimum contribution.');
    expect(
      contributionError({ ...base, raised: 99n * MAS + MAS / 2n }, 0n, MAS / 2n, 1_500),
    ).toBeNull(); // last buyer
    expect(contributionError(base, 0n, MAS, 500)).toBe('This presale is not live.');
  });

  it('tells the most a wallet may add', () => {
    expect(maxContribution(base, 0n)).toBe(40n * MAS);
    expect(maxContribution({ ...base, raised: 95n * MAS }, 0n)).toBe(5n * MAS);
    expect(maxContribution(base, 40n * MAS)).toBe(0n);
    expect(maxContribution({ ...base, maxBuy: 0n }, 0n)).toBe(100n * MAS);
  });

  it('formats the time left', () => {
    expect(timeLeft(0 + 2 * 86_400_000 + 4 * 3_600_000, 0)).toBe('2d 4h');
    expect(timeLeft(3 * 3_600_000 + 12 * 60_000, 0)).toBe('3h 12m');
    expect(timeLeft(45 * 60_000, 0)).toBe('45m');
    expect(timeLeft(0, 1_000)).toBe('0m');
  });
});
