import { EMPTY_INFO, KIND_COLLECTION, KIND_TOKEN } from './records';
import {
  categoryError,
  decimalsError,
  descriptionError,
  infoErrors,
  nameError,
  parseSupply,
  supplyError,
  symbolError,
  urlError,
} from './launch-rules';
import { IPFS_GATEWAY, configureUrls } from '../utils/ipfs';

describe('launch rules (mirror of the Launchpad SC)', () => {
  it('checks names', () => {
    expect(nameError('RustCore')).toBeNull();
    expect(nameError('RC')).not.toBeNull();
    expect(nameError('x'.repeat(33))).not.toBeNull();
    expect(nameError(' Spaced')).not.toBeNull();
    expect(nameError('Tab\there')).not.toBeNull();
  });

  it('checks symbols, including the reserved ones', () => {
    expect(symbolError('RCT')).toBeNull();
    expect(symbolError('RC2026')).toBeNull();
    expect(symbolError('R')).not.toBeNull();
    expect(symbolError('ABCDEFGHIJK')).not.toBeNull();
    expect(symbolError('rct')).not.toBeNull();
    expect(symbolError('R-T')).not.toBeNull();
    expect(symbolError('USDC')).toBe('This symbol is reserved.');
  });

  it('checks decimals', () => {
    expect(decimalsError(0)).toBeNull();
    expect(decimalsError(18)).toBeNull();
    expect(decimalsError(19)).not.toBeNull();
    expect(decimalsError(1.5)).not.toBeNull();
  });

  it('parses supplies in whole tokens, exactly', () => {
    expect(parseSupply('1000000', 18)).toBe(1_000_000n * 10n ** 18n);
    expect(parseSupply('1,000,000', 6)).toBe(1_000_000_000_000n);
    expect(parseSupply('2.5', 1)).toBe(25n);
    expect(parseSupply('2.55', 1)).toBeNull(); // more decimals than the token has
    expect(parseSupply('-3', 18)).toBeNull();
    expect(parseSupply('abc', 18)).toBeNull();
  });

  it('refuses a zero or impossible supply', () => {
    expect(supplyError('0', 18)).toBe('Must be greater than zero.');
    expect(supplyError('1' + '0'.repeat(80), 0)).toBe('This number is too large.');
    expect(supplyError('21000000', 8)).toBeNull();
  });

  it('checks categories per kind', () => {
    expect(categoryError(KIND_TOKEN, 5)).toBeNull();
    expect(categoryError(KIND_TOKEN, 6)).not.toBeNull();
    expect(categoryError(KIND_COLLECTION, 6)).toBeNull();
  });

  it('accepts only https and ipfs links without spaces', () => {
    expect(urlError('')).toBeNull();
    expect(urlError('https://rustcore.example')).toBeNull();
    expect(urlError('ipfs://bafy123')).toBeNull();
    expect(urlError('http://insecure.example')).not.toBeNull();
    expect(urlError('https://bad link.example')).not.toBeNull();
    expect(urlError('https://' + 'a'.repeat(250))).not.toBeNull();
  });

  it('allows new lines in descriptions, not other control characters', () => {
    expect(descriptionError('Line one\nLine two')).toBeNull();
    expect(descriptionError('Bell\u0007')).not.toBeNull();
    expect(descriptionError('d'.repeat(501))).not.toBeNull();
  });

  it('reports every invalid info field', () => {
    const errors = infoErrors({
      ...EMPTY_INFO,
      website: 'http://x',
      discord: 'https://ok.example',
    });
    expect(Object.keys(errors)).toEqual(['website']);
  });
});

describe('links while developing', () => {
  afterEach(() => configureUrls({ gateway: IPFS_GATEWAY, allowLocal: false }));

  it('refuse http in the published app', () => {
    expect(urlError('ipfs://bafyMeta/')).toBeNull();
    expect(urlError('https://nft.example/meta/')).toBeNull();
    expect(urlError('http://localhost:8081/')).toBe('Start with https:// or ipfs://');
  });

  it('accept http on this machine with ng serve, never other http hosts', () => {
    configureUrls({ allowLocal: true });
    expect(urlError('http://localhost:8081/logo.png')).toBeNull();
    expect(urlError('http://127.0.0.1:8081/meta/')).toBeNull();
    expect(urlError('http://[::1]/')).toBeNull();
    expect(urlError('http://nft.example/meta/')).toBe('Start with https:// or ipfs://');
    expect(urlError('http://localhost.evil.example/')).toBe('Start with https:// or ipfs://');
  });
});
