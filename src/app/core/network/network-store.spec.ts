import { TestBed } from '@angular/core/testing';
import { LOCAL_STORE, memoryStore } from '../platform/storage';
import { NetworkStore } from './network-store';
import { DEFAULT_NETWORK, NETWORKS } from './networks';

describe('NetworkStore', () => {
  function setup(saved?: string) {
    const store = memoryStore();
    if (saved !== undefined) store.setItem('launchpad.network', saved);
    TestBed.configureTestingModule({ providers: [{ provide: LOCAL_STORE, useValue: store }] });
    return { networks: TestBed.inject(NetworkStore), store };
  }

  it('starts on the default network', () => {
    const { networks } = setup();
    expect(networks.network()).toBe(DEFAULT_NETWORK);
  });

  it('restores a saved network and ignores unknown values', () => {
    expect(setup('buildnet').networks.network()).toBe('buildnet');
    TestBed.resetTestingModule();
    expect(setup('testnet').networks.network()).toBe(DEFAULT_NETWORK);
  });

  it('saves the selection and exposes its config', () => {
    const { networks, store } = setup();
    networks.select('buildnet');
    expect(store.getItem('launchpad.network')).toBe('buildnet');
    expect(networks.config()).toBe(NETWORKS.buildnet);
  });
});
