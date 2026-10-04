import { mintWithUriCoins, nftStorage, publicMintCoins, settingCoins } from './mint-cost';

describe('mint cost', () => {
  it('covers the storage of each NFT plus the holder entries', () => {
    expect(nftStorage(1)).toBe(40_000_000n);
    expect(nftStorage(5)).toBe(120_000_000n);
  });

  it('adds the price for a public mint', () => {
    expect(publicMintCoins(2_000_000_000n, 3)).toBe(6_000_000_000n + 80_000_000n);
    expect(publicMintCoins(0n, 1)).toBe(40_000_000n);
  });

  it('adds the URI bytes for a mint with its own URI', () => {
    expect(mintWithUriCoins('ipfs://x')).toBe(40_000_000n + 53n * 100_000n);
    expect(settingCoins('ab')).toBe(10_200_000n);
  });
});
