import { MintInfo } from './collection-reader';
import { feeSavings, mintProgress } from './membership';
import { LaunchpadConfig } from './records';

const MAS = 1_000_000_000n;

function mint(minted: bigint, maxSupply: bigint): MintInfo {
  return {
    maxSupply,
    minted,
    totalSupply: minted,
    mintPrice: 500n * MAS,
    maxPerWallet: 5,
    publicMint: true,
    baseURI: 'ipfs://bafy/',
    frozen: false,
  };
}

describe('membership', () => {
  it('measures the mint progress', () => {
    expect(mintProgress(mint(0n, 1_000n))).toEqual({
      minted: 0n,
      maxSupply: 1_000n,
      percent: 0,
      left: 1_000n,
      soldOut: false,
    });
    expect(mintProgress(mint(237n, 1_000n)).percent).toBe(23.7);
    expect(mintProgress(mint(1n, 3n)).percent).toBe(33.33);
    expect(mintProgress(mint(999n, 1_000n)).soldOut).toBe(false);
    const done = mintProgress(mint(1_000n, 1_000n));
    expect(done.percent).toBe(100);
    expect(done.left).toBe(0n);
    expect(done.soldOut).toBe(true);
  });

  it('shows what a holder pays on the fixed fees', () => {
    const config: LaunchpadConfig = {
      tokenFee: 100n * MAS,
      collectionFee: 200n * MAS,
      importFee: 50n * MAS,
      presaleFeeBps: 200,
      deployDeposit: MAS / 10n,
      paused: false,
      marketFeeBps: 100,
    };
    expect(feeSavings(config, 1_000)).toEqual([
      { label: 'Token launch', full: 100n * MAS, held: 90n * MAS },
      { label: 'Collection launch', full: 200n * MAS, held: 180n * MAS },
      { label: 'Import', full: 50n * MAS, held: 45n * MAS },
    ]);
  });
});
