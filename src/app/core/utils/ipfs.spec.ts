import { httpUrl } from './ipfs';

describe('httpUrl', () => {
  it('maps ipfs links to the gateway', () => {
    expect(httpUrl('ipfs://bafyLogo/logo.png')).toBe('https://ipfs.io/ipfs/bafyLogo/logo.png');
    expect(httpUrl('ipfs://ipfs/bafyLogo')).toBe('https://ipfs.io/ipfs/bafyLogo');
  });

  it('keeps https and drops anything else', () => {
    expect(httpUrl('https://rustcore.example/a.png')).toBe('https://rustcore.example/a.png');
    expect(httpUrl('http://insecure.example/a.png')).toBe('');
    expect(httpUrl('javascript:alert(1)')).toBe('');
    expect(httpUrl('')).toBe('');
  });
});
