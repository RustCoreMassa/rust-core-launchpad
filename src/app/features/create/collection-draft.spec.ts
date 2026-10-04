import { Args } from '@massalabs/massa-web3';
import { readInfo } from '../../core/launchpad/records';
import {
  CollectionDraft,
  EMPTY_COLLECTION_DRAFT,
  collectionErrors,
  collectionStepValid,
  createCollectionArgs,
  priceNano,
  royaltyBps,
} from './collection-draft';

const valid: CollectionDraft = {
  ...EMPTY_COLLECTION_DRAFT,
  name: 'RustCore Cats',
  symbol: 'RCAT',
  maxSupply: '1,000',
  baseURI: 'ipfs://bafyCats/',
  publicMint: true,
  mintPrice: '2.5',
  maxPerWallet: '3',
  royalty: '7.5',
};

describe('collection draft', () => {
  it('converts royalty percents and MAS prices exactly', () => {
    expect(royaltyBps('5')).toBe(500);
    expect(royaltyBps('2.55')).toBe(255);
    expect(royaltyBps('')).toBe(0);
    expect(royaltyBps('1.234')).toBeNull();
    expect(priceNano('0.1')).toBe(100_000_000n);
    expect(priceNano('2,5')).toBe(2_500_000_000n);
    expect(priceNano('-1')).toBeNull();
  });

  it('validates step by step', () => {
    expect(collectionStepValid(0, EMPTY_COLLECTION_DRAFT)).toBe(false);
    for (const step of [0, 1, 2, 3, 4]) expect(collectionStepValid(step, valid)).toBe(true);
    expect(collectionStepValid(1, { ...valid, maxSupply: '100001' })).toBe(false);
    expect(collectionStepValid(1, { ...valid, baseURI: '' })).toBe(false);
    expect(collectionStepValid(2, { ...valid, royalty: '10.01' })).toBe(false);
    expect(collectionStepValid(2, { ...valid, royaltyReceiver: 'nope' })).toBe(false);
  });

  it('allows a reserved token symbol for a collection', () => {
    expect(collectionErrors({ ...valid, symbol: 'USDC' }).symbol).toBeUndefined();
  });

  it('needs no base URI when each NFT gets its own', () => {
    expect(collectionStepValid(1, { ...valid, metadataMode: 'perToken', baseURI: '' })).toBe(true);
  });

  it('builds createCollection args in the contract’s order', () => {
    const args = new Args(createCollectionArgs(valid).serialize());
    expect(args.nextString()).toBe('RustCore Cats');
    expect(args.nextString()).toBe('RCAT');
    expect(args.nextU256()).toBe(1000n);
    expect(args.nextString()).toBe('ipfs://bafyCats/');
    expect(args.nextU64()).toBe(2_500_000_000n);
    expect(args.nextU32()).toBe(3n);
    expect(args.nextBool()).toBe(true); // public mint
    expect(args.nextBool()).toBe(false); // mutable
    expect(args.nextU16()).toBe(750n);
    expect(args.nextString()).toBe(''); // royalty receiver = the creator
    expect(args.nextU8()).toBe(0n);
    expect(readInfo(args)).toEqual(valid.info);
  });

  it('turns public mint off and drops the base URI for per-NFT metadata', () => {
    const args = new Args(createCollectionArgs({ ...valid, metadataMode: 'perToken' }).serialize());
    args.nextString();
    args.nextString();
    args.nextU256();
    expect(args.nextString()).toBe('');
    expect(args.nextU64()).toBe(0n);
    expect(args.nextU32()).toBe(0n);
    expect(args.nextBool()).toBe(false);
  });
});
