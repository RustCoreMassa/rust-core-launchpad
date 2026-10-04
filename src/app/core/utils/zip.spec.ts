import { crc32, createZip } from './zip';

const text = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('createZip', () => {
  const zip = createZip(
    [
      { name: 'README.md', data: text('hello') },
      { name: 'build/contract.wasm', data: new Uint8Array([0, 97, 115, 109]) },
    ],
    new Date(2026, 9, 4, 12, 30, 10),
  );
  const view = new DataView(zip.buffer);

  it('writes local headers with stored data', () => {
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0); // stored
    expect(view.getUint32(14, true)).toBe(crc32(text('hello')));
    expect(new TextDecoder().decode(zip.slice(30, 39))).toBe('README.md');
    expect(new TextDecoder().decode(zip.slice(39, 44))).toBe('hello');
  });

  it('ends with a central directory that points at every entry', () => {
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralStart = view.getUint32(end + 16, true);
    expect(view.getUint32(centralStart, true)).toBe(0x02014b50);
    const secondLocal = 30 + 9 + 5;
    const secondCentral = centralStart + 46 + 9;
    expect(view.getUint32(secondCentral + 42, true)).toBe(secondLocal);
    expect(view.getUint32(secondLocal, true)).toBe(0x04034b50);
  });
});
