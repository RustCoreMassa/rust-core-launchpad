import { InjectionToken } from '@angular/core';

/**
 * Key-value storage for small UI preferences (network, last wallet). Behind a token so tests
 * can give each case a fresh in-memory store. Never holds anything secret: the app has no keys.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LOCAL_STORE = new InjectionToken<KeyValueStore>('LOCAL_STORE', {
  providedIn: 'root',
  factory: () => safeLocalStorage(),
});

/** localStorage, or a memory map where the browser refuses it (private modes, sandboxes). */
function safeLocalStorage(): KeyValueStore {
  try {
    const probe = '__launchpad_probe__';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return memoryStore();
  }
}

export function memoryStore(): KeyValueStore {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}
