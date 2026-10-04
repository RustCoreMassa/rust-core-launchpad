import { contractReason, eventFields } from './events';

describe('contractReason', () => {
  it('extracts the reason from the error a buildnet node returns', () => {
    const raw =
      'readonly call failed: VM Error in ReadOnlyExecutionTarget::FunctionCall context: Depth ' +
      'error: Runtime error: error: This symbol is already taken or reserved at ' +
      'assembly/contracts/launchpad.ts:140 col: 3';
    expect(contractReason(raw)).toBe('This symbol is already taken or reserved');
  });

  it('extracts the contract’s abort message from a VM error', () => {
    const raw =
      'VM Error in ReadOnlyExecutionTarget::FunctionCall context: Runtime error: ' +
      'runtime error when executing abi abort: abort with message: This symbol is already ' +
      'taken or reserved at assembly/contracts/launchpad.ts:141 col: 3';
    expect(contractReason(raw)).toBe('This symbol is already taken or reserved');
  });

  it('extracts the reason from a failed operation’s event on buildnet', () => {
    const raw = JSON.stringify({
      massa_execution_error:
        'Runtime error: runtime error when executing operation O11Q595CbUt7xUN8HngSFH9GFBnJcj: ' +
        'VM Error in CallSC context: Depth error: Runtime error: error: This symbol is already ' +
        'taken or reserved at assembly/contracts/launchpad.ts:140 col: 3',
    });
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
