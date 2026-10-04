import { contractReason, eventFields } from './transactions';

describe('contractReason', () => {
  it('extracts the contract’s abort message from a VM error', () => {
    const raw =
      'VM Error in ReadOnlyExecutionTarget::FunctionCall context: Runtime error: ' +
      'runtime error when executing abi abort: abort with message: This symbol is already ' +
      'taken or reserved at assembly/contracts/launchpad.ts:141 col: 3';
    expect(contractReason(raw)).toBe('This symbol is already taken or reserved');
  });

  it('reads the error out of a massa_execution_error event', () => {
    const raw = JSON.stringify({
      massa_execution_error: 'abort with message: Not enough MAS for the fee and storage at x.ts:1',
    });
    expect(contractReason(raw)).toBe('Not enough MAS for the fee and storage');
  });

  it('keeps an unknown message, shortened', () => {
    expect(contractReason('timeout')).toBe('timeout');
    expect(contractReason('')).toBe('rejected by the network');
  });
});

describe('eventFields', () => {
  it('splits the first event of a kind into its fields', () => {
    const events = ['CHANGE_OWNER:AU1x', 'TOKEN_CREATED:3,AS1token,AU1alice'];
    expect(eventFields(events, 'TOKEN_CREATED')).toEqual(['3', 'AS1token', 'AU1alice']);
    expect(eventFields(events, 'COLLECTION_CREATED')).toBeNull();
  });
});
