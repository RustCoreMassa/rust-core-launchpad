import { bytesToString } from '@massalabs/as-types';
import { Context, resetStorage, setDeployContext } from '@massalabs/massa-as-sdk';
import { admin, constructor, version, VERSION } from '../contracts/launchpad';

describe('launchpad skeleton', () => {
  beforeEach(() => {
    resetStorage();
    setDeployContext();
    constructor([]);
  });

  test('the deployer becomes the admin', () => {
    expect(bytesToString(admin([]))).toBe(Context.caller().toString());
  });

  test('reports its version', () => {
    expect(bytesToString(version([]))).toBe(VERSION);
  });
});
