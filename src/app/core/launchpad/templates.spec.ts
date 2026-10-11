import { KIND_COLLECTION, KIND_TOKEN } from './records';
import {
  KNOWN_TEMPLATES,
  UnknownTemplateError,
  assertKnownTemplate,
  newestTemplate,
  templateSource,
} from './templates';
import { toUserMessage } from '../utils/user-error';

function bytes(hash: string): Uint8Array {
  return new Uint8Array(hash.match(/../g)!.map((h) => parseInt(h, 16)));
}

describe('known templates', () => {
  it('accepts launches only from the newest template of each kind', () => {
    expect(() => assertKnownTemplate(KIND_TOKEN, bytes(KNOWN_TEMPLATES[0][1]))).not.toThrow();
    expect(() => assertKnownTemplate(KIND_COLLECTION, bytes(KNOWN_TEMPLATES[1][2]))).not.toThrow();
  });

  it('refuses RC-Collection v1 (NFTs could be taken after their mint)', () => {
    expect(newestTemplate(KIND_COLLECTION).version).toBe(2);
    expect(() => assertKnownTemplate(KIND_COLLECTION, bytes(KNOWN_TEMPLATES[1][1]))).toThrow(
      UnknownTemplateError,
    );
  });

  it('refuses another hash or the other kind', () => {
    const token = bytes(KNOWN_TEMPLATES[0][1]);
    const changed = token.slice();
    changed[0] ^= 1;
    expect(() => assertKnownTemplate(KIND_TOKEN, changed)).toThrow(UnknownTemplateError);
    expect(() => assertKnownTemplate(KIND_COLLECTION, token)).toThrow(UnknownTemplateError);
  });

  it('finds the source version by hash, whatever number the Launchpad gave it', () => {
    expect(templateSource(KIND_COLLECTION, bytes(KNOWN_TEMPLATES[1][1]))).toBe(1);
    expect(templateSource(KIND_COLLECTION, KNOWN_TEMPLATES[1][2])).toBe(2);
    expect(templateSource(KIND_TOKEN, KNOWN_TEMPLATES[1][2])).toBeNull();
  });

  it('explains itself to the user', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toUserMessage(new UnknownTemplateError())).toMatch(/template this app does not know/);
  });
});
