import { Args } from '@massalabs/massa-web3';
import {
  EMPTY_INFO,
  KIND_TOKEN,
  Project,
  SOURCE_LAUNCHED,
  categoryLabel,
  hex,
  readConfig,
  readProject,
  readProjectPage,
  writeProject,
} from './records';

function sampleProject(overrides: Partial<Project> = {}): Project {
  return {
    kind: KIND_TOKEN,
    id: 1n,
    address: 'AS1token',
    source: SOURCE_LAUNCHED,
    creator: 'AU1alice',
    createdAt: 1_759_000_000_000,
    templateVersion: 1,
    codeHash: new Uint8Array([0xab, 0xcd]),
    name: 'RustCore Token',
    symbol: 'RCT',
    decimals: 18,
    mutable: false,
    category: 1,
    verified: false,
    hidden: false,
    royaltyBps: 0,
    royaltyReceiver: '',
    info: { ...EMPTY_INFO, website: 'https://rustcore.example' },
    ...overrides,
  };
}

/**
 * A Project record serialized by the contract itself (smart-contract/assembly/__tests__/
 * cross-check.spec.ts logs it), so the app's decoder is checked against the real encoding.
 */
const CONTRACT_PROJECT_BYTES = new Uint8Array([
  0, 1, 0, 0, 0, 0, 0, 0, 0, 53, 0, 0, 0, 65, 83, 55, 120, 116, 120, 70, 100, 97, 99, 114, 69, 105,
  70, 70, 57, 54, 112, 76, 69, 82, 119, 114, 74, 85, 109, 106, 71, 50, 101, 104, 88, 57, 122, 109,
  121, 121, 105, 56, 103, 70, 81, 88, 122, 55, 81, 68, 71, 77, 113, 101, 98, 114, 0, 51, 0, 0, 0,
  65, 85, 49, 50, 66, 113, 90, 69, 81, 54, 115, 66, 121, 104, 82, 76, 121, 69, 117, 102, 48, 89, 98,
  81, 109, 99, 70, 50, 80, 115, 68, 100, 107, 78, 78, 71, 49, 97, 107, 66, 74, 117, 57, 88, 99, 106,
  90, 65, 49, 101, 56, 105, 185, 69, 8, 161, 1, 0, 0, 1, 0, 0, 0, 32, 0, 0, 0, 205, 93, 73, 53, 164,
  140, 6, 114, 203, 6, 64, 123, 180, 67, 188, 0, 135, 175, 249, 71, 198, 184, 100, 186, 200, 134,
  152, 44, 115, 179, 2, 127, 11, 0, 0, 0, 67, 114, 111, 115, 115, 32, 67, 104, 101, 99, 107, 4, 0,
  0, 0, 88, 67, 72, 75, 6, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 200, 154, 97, 114, 196, 131,
  10, 110, 111, 117, 196, 131, 0, 0, 0, 0, 0, 0, 0, 0, 17, 0, 0, 0, 104, 116, 116, 112, 115, 58, 47,
  47, 120, 46, 101, 120, 97, 109, 112, 108, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

describe('Launchpad records', () => {
  it('decodes a record serialized by the contract', () => {
    const p = readProject(new Args(CONTRACT_PROJECT_BYTES));
    expect(p.kind).toBe(KIND_TOKEN);
    expect(p.id).toBe(1n);
    expect(p.address.startsWith('AS')).toBe(true);
    expect(p.creator).toBe('AU12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1e8');
    expect(p.templateVersion).toBe(1);
    expect(p.codeHash.length).toBe(32);
    expect(p.name).toBe('Cross Check');
    expect(p.symbol).toBe('XCHK');
    expect(p.decimals).toBe(6);
    expect(p.category).toBe(2);
    expect(p.info.description).toBe('Țară\nnouă');
    expect(p.info.website).toBe('https://x.example');
  });

  it('reads back what it writes, field by field', () => {
    const project = sampleProject({ verified: true, royaltyBps: 500 });
    const bytes = writeProject(new Args(), project).serialize();
    expect(readProject(new Args(bytes))).toEqual(project);
  });

  it('starts with the fixed-size fields in the contract’s order', () => {
    const bytes = writeProject(new Args(), sampleProject({ id: 258n })).serialize();
    expect(bytes[0]).toBe(KIND_TOKEN); // kind: u8
    expect(Array.from(bytes.slice(1, 9))).toEqual([2, 1, 0, 0, 0, 0, 0, 0]); // id: u64 LE
    expect(Array.from(bytes.slice(9, 13))).toEqual([8, 0, 0, 0]); // address length: u32 LE
  });

  it('reads a page: total, then the length-prefixed records', () => {
    const records = writeProject(
      writeProject(new Args(), sampleProject({ id: 2n })),
      sampleProject(),
    );
    const page = new Args().addU64(7n).addUint8Array(records.serialize()).serialize();
    const result = readProjectPage(page);
    expect(result.total).toBe(7n);
    expect(result.projects.map((p) => p.id)).toEqual([2n, 1n]);
  });

  it('reads an empty page', () => {
    const page = new Args().addU64(0n).addUint8Array(new Uint8Array()).serialize();
    expect(readProjectPage(page).projects).toEqual([]);
  });

  it('reads the config', () => {
    const bytes = new Args()
      .addU64(5n)
      .addU64(7n)
      .addU64(3n)
      .addU16(200n)
      .addU64(100n)
      .addBool(true)
      .serialize();
    expect(readConfig(new Args(bytes))).toEqual({
      tokenFee: 5n,
      collectionFee: 7n,
      importFee: 3n,
      presaleFeeBps: 200,
      deployDeposit: 100n,
      paused: true,
    });
  });

  it('labels categories and formats hashes', () => {
    expect(categoryLabel(KIND_TOKEN, 3)).toBe('DeFi');
    expect(categoryLabel(KIND_TOKEN, 42)).toBe('Other');
    expect(hex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });
});
