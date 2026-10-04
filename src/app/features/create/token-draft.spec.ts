import { Args } from '@massalabs/massa-web3';
import { readInfo } from '../../core/launchpad/records';
import { EMPTY_DRAFT, TokenDraft, createTokenArgs, draftErrors, stepValid } from './token-draft';

const valid: TokenDraft = {
  ...EMPTY_DRAFT,
  name: 'RustCore Token',
  symbol: 'RCT',
  decimals: 6,
  supply: '1,000,000',
  category: 1,
};

describe('token draft', () => {
  it('validates step by step', () => {
    expect(stepValid(0, EMPTY_DRAFT)).toBe(false);
    expect(stepValid(0, valid)).toBe(true);
    expect(stepValid(1, valid)).toBe(true);
    expect(stepValid(2, valid)).toBe(true);
    expect(stepValid(3, valid)).toBe(true);
    expect(stepValid(1, { ...valid, supply: '0' })).toBe(false);
    expect(stepValid(2, { ...valid, info: { ...valid.info, website: 'http://x' } })).toBe(false);
    expect(stepValid(3, { ...valid, symbol: 'USDC' })).toBe(false);
  });

  it('checks the max supply only for mintable tokens', () => {
    expect(draftErrors({ ...valid, maxSupply: '1' }).maxSupply).toBeUndefined();
    expect(draftErrors({ ...valid, mintable: true, maxSupply: '999999' }).maxSupply).toBe(
      'Must be at least the initial supply.',
    );
    expect(
      draftErrors({ ...valid, mintable: true, maxSupply: '2000000' }).maxSupply,
    ).toBeUndefined();
  });

  it('builds createToken args in the contract’s order, amounts in smallest units', () => {
    const args = new Args(
      createTokenArgs({
        ...valid,
        mintable: true,
        maxSupply: '2000000',
        mutable: true,
      }).serialize(),
    );
    expect(args.nextString()).toBe('RustCore Token');
    expect(args.nextString()).toBe('RCT');
    expect(args.nextU8()).toBe(6n);
    expect(args.nextU256()).toBe(1_000_000_000_000n);
    expect(args.nextBool()).toBe(true);
    expect(args.nextU256()).toBe(2_000_000_000_000n);
    expect(args.nextBool()).toBe(false); // burnable
    expect(args.nextBool()).toBe(true); // mutable
    expect(args.nextU8()).toBe(1n);
    expect(readInfo(args)).toEqual(valid.info);
  });

  it('sends a zero max supply for fixed-supply tokens', () => {
    const args = new Args(createTokenArgs({ ...valid, maxSupply: '5' }).serialize());
    args.nextString();
    args.nextString();
    args.nextU8();
    args.nextU256();
    expect(args.nextBool()).toBe(false);
    expect(args.nextU256()).toBe(0n);
  });
});
