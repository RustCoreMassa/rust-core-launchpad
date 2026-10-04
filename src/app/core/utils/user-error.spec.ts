import { toUserMessage } from './user-error';

describe('toUserMessage', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

  it('passes the app’s own messages through', () => {
    expect(toUserMessage(new Error('Bearby refused the connection.'))).toBe(
      'Bearby refused the connection.',
    );
  });

  it('maps known causes to a plain sentence', () => {
    expect(toUserMessage(new Error('User rejected the request'))).toBe(
      'The request was rejected in your wallet.',
    );
    expect(toUserMessage(new Error('TypeError: Failed to fetch'))).toBe(
      "Couldn't reach the Massa network. Check your connection and try again.",
    );
  });

  it('never shows raw VM errors', () => {
    const raw = 'readonly call failed: VM Error in ReadOnlyExecutionTarget at ~lib/x.ts:12';
    expect(toUserMessage(new Error(raw))).toBe('Something went wrong. Please try again.');
  });

  it('handles values that are not errors', () => {
    expect(toUserMessage(undefined)).toBe('Something went wrong. Please try again.');
    expect(toUserMessage('Plain text')).toBe('Plain text');
  });
});
