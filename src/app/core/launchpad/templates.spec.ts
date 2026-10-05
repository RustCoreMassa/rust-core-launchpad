import { KIND_COLLECTION, KIND_TOKEN } from './records';
import { KNOWN_TEMPLATES, UnknownTemplateError, assertKnownTemplate } from './templates';
import { toUserMessage } from '../utils/user-error';

function bytes(hash: string): Uint8Array {
  return new Uint8Array(hash.match(/../g)!.map((h) => parseInt(h, 16)));
}

describe('known templates', () => {
  it('accepts the templates the app has the source of', () => {
    expect(() => assertKnownTemplate(KIND_TOKEN, 1, bytes(KNOWN_TEMPLATES[0][1]))).not.toThrow();
    expect(() =>
      assertKnownTemplate(KIND_COLLECTION, 1, bytes(KNOWN_TEMPLATES[1][1])),
    ).not.toThrow();
  });

  it('refuses another hash, another version or the other kind', () => {
    const token = bytes(KNOWN_TEMPLATES[0][1]);
    const changed = token.slice();
    changed[0] ^= 1;
    expect(() => assertKnownTemplate(KIND_TOKEN, 1, changed)).toThrow(UnknownTemplateError);
    expect(() => assertKnownTemplate(KIND_TOKEN, 2, token)).toThrow(UnknownTemplateError);
    expect(() => assertKnownTemplate(KIND_COLLECTION, 1, token)).toThrow(UnknownTemplateError);
  });

  it('explains itself to the user', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toUserMessage(new UnknownTemplateError())).toMatch(/template this app does not know/);
  });
});
