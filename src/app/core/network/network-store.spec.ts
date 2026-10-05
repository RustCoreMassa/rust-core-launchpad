import { TestBed } from '@angular/core/testing';
import { LOCAL_STORE, memoryStore } from '../platform/storage';
import { ENABLED_NETWORKS, NetworkStore } from './network-store';
import { DEFAULT_NETWORK, NETWORKS } from './networks';

describe('NetworkStore', () => {
  /** Development build by default: both networks offered. */
  function setup(saved?: string, enabled: string[] = ['mainnet', 'buildnet']) {
    const store = memoryStore();
    if (saved !== undefined) store.setItem('launchpad.network', saved);
    TestBed.configureTestingModule({
      providers: [
        { provide: LOCAL_STORE, useValue: store },
        { provide: ENABLED_NETWORKS, useValue: enabled },
      ],
    });
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

  it('offers mainnet only in the published build, whatever was saved', () => {
    const { networks, store } = setup('buildnet', ['mainnet']);
    expect(networks.network()).toBe('mainnet');
    expect(networks.available.map((n) => n.id)).toEqual(['mainnet']);
    networks.select('buildnet');
    expect(networks.network()).toBe('mainnet');
    expect(store.getItem('launchpad.network')).toBe('buildnet'); // untouched, just ignored
  });

  it('saves the selection and exposes its config', () => {
    const { networks, store } = setup();
    networks.select('buildnet');
    expect(store.getItem('launchpad.network')).toBe('buildnet');
    expect(networks.config()).toBe(NETWORKS.buildnet);
  });
});
