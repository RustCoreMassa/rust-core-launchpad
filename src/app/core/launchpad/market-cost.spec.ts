import { Args } from '@massalabs/massa-web3';
import { BUY_MARGIN, buyCoins, royaltyOf } from './market-cost';
import { readListing, readPage, readSale, readStats } from './records';

describe('marketplace cost', () => {
  it('sends the price plus a margin the contract refunds', () => {
    expect(buyCoins(5_000_000_000n)).toBe(5_000_000_000n + BUY_MARGIN);
  });

  it('computes the royalty like the contract (rounded down)', () => {
    expect(royaltyOf(5_000_000_000n, 500)).toBe(250_000_000n);
    expect(royaltyOf(9_999n, 250)).toBe(249n);
    expect(royaltyOf(1_000n, 0)).toBe(0n);
  });
});

describe('marketplace records', () => {
  function listingBytes(id: bigint, price: bigint): Args {
    return new Args()
      .addU64(id)
      .addU64(1n)
      .addString('AS1cats')
      .addU256(7n)
      .addString('AU1alice')
      .addU64(price)
      .addU64(1_000n)
      .addU64(0n);
  }

  it('reads a listing in the contract’s order', () => {
    expect(readListing(new Args(listingBytes(3n, 10n).serialize()))).toEqual({
      id: 3n,
      collectionId: 1n,
      collection: 'AS1cats',
      tokenId: 7n,
      seller: 'AU1alice',
      price: 10n,
      createdAt: 1_000,
      expiresAt: 0,
    });
  });

  it('reads a page of listings', () => {
    const records = new Uint8Array([
      ...listingBytes(2n, 20n).serialize(),
      ...listingBytes(1n, 10n).serialize(),
    ]);
    const bytes = new Args().addU64(2n).addUint8Array(records).serialize();
    const page = readPage(bytes, readListing);
    expect(page.total).toBe(2);
    expect(page.items.map((l) => l.price)).toEqual([20n, 10n]);
  });

  it('reads a sale and the stats', () => {
    const sale = new Args()
      .addU64(1n)
      .addU64(4n)
      .addU64(1n)
      .addU256(7n)
      .addString('AU1alice')
      .addString('AU1bob')
      .addU64(5_000n)
      .addU64(250n)
      .addU64(2_000n)
      .serialize();
    expect(readSale(new Args(sale))).toMatchObject({
      listingId: 4n,
      buyer: 'AU1bob',
      royalty: 250n,
    });
    const stats = new Args().addU64(5_000n).addU64(1n).addU64(5_000n).serialize();
    expect(readStats(new Args(stats))).toEqual({ volume: 5_000n, sales: 1n, lastPrice: 5_000n });
  });
});
