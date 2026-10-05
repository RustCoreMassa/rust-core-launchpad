import { IPFS_GATEWAY, configureUrls, httpUrl, isLocalUrl, localGatewayOf } from './ipfs';

describe('httpUrl', () => {
  afterEach(() => configureUrls({ gateway: IPFS_GATEWAY, allowLocal: false }));

  it('maps ipfs links to the gateway', () => {
    expect(httpUrl('ipfs://bafyLogo/logo.png')).toBe('https://ipfs.io/ipfs/bafyLogo/logo.png');
    expect(httpUrl('ipfs://ipfs/bafyLogo')).toBe('https://ipfs.io/ipfs/bafyLogo');
  });

  it('keeps https and drops anything else', () => {
    expect(httpUrl('https://rustcore.example/a.png')).toBe('https://rustcore.example/a.png');
    expect(httpUrl('http://insecure.example/a.png')).toBe('');
    expect(httpUrl('http://localhost:8081/1.json')).toBe(''); // production default
    expect(httpUrl('javascript:alert(1)')).toBe('');
    expect(httpUrl('')).toBe('');
  });

  it('in development, loads local links and uses the configured gateway', () => {
    configureUrls({ gateway: 'http://127.0.0.1:8080/ipfs/', allowLocal: true });
    expect(httpUrl('ipfs://bafyMeta/1.json')).toBe('http://127.0.0.1:8080/ipfs/bafyMeta/1.json');
    expect(httpUrl('http://localhost:8081/1.json')).toBe('http://localhost:8081/1.json');
    expect(httpUrl('http://127.0.0.1/a.png')).toBe('http://127.0.0.1/a.png');
    expect(httpUrl('http://insecure.example/a.png')).toBe(''); // still only this machine
    expect(httpUrl('http://localhost.evil.example/a.png')).toBe('');
  });

  it('refuses a gateway without the final slash', () => {
    expect(() => configureUrls({ gateway: 'http://127.0.0.1:8080/ipfs' })).toThrow();
  });
});

describe('isLocalUrl', () => {
  it('knows this machine', () => {
    for (const url of [
      'http://localhost',
      'http://localhost:4200/x',
      'http://127.0.0.1:8080/ipfs/',
      'http://[::1]:3000/',
    ])
      expect(isLocalUrl(url)).toBe(true);
    for (const url of [
      'http://localhost.example.com/',
      'http://127.0.0.1.example.com/',
      'http://10.0.0.2/',
      'ftp://localhost/',
    ])
      expect(isLocalUrl(url)).toBe(false);
  });
});

describe('localGatewayOf', () => {
  afterEach(() => configureUrls({ gateway: IPFS_GATEWAY, allowLocal: false }));

  it('finds the local node a link came from, only while developing', () => {
    const url = 'http://127.0.0.1:8090/ipfs/bafyMeta/1.json';
    expect(localGatewayOf(url)).toBeNull();
    configureUrls({ allowLocal: true });
    expect(localGatewayOf(url)).toBe('http://127.0.0.1:8090/ipfs/');
    expect(localGatewayOf('http://localhost:8081/meta/1.json')).toBeNull(); // not a gateway
    expect(localGatewayOf('https://ipfs.io/ipfs/bafyMeta/1.json')).toBeNull(); // not local
    expect(httpUrl('ipfs://bafyImg/1.png', 'http://127.0.0.1:8090/ipfs/')).toBe(
      'http://127.0.0.1:8090/ipfs/bafyImg/1.png',
    );
  });
});
