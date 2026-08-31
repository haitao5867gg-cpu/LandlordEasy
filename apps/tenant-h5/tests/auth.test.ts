import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../src/stores/auth';

class LocalStorageMock {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

globalThis.localStorage = new LocalStorageMock() as Storage;

function createFreshAuthStore() {
  setActivePinia(createPinia());
  return useAuthStore();
}

describe('tenant auth store persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores bound=true in a fresh store after setBound(true)', () => {
    const firstStore = createFreshAuthStore();
    firstStore.setBound(true);

    expect(localStorage.getItem('tenant_bound')).toBe('1');

    const refreshedStore = createFreshAuthStore();
    expect(refreshedStore).not.toBe(firstStore);
    expect(refreshedStore.bound).toBe(true);
  });

  it('restores bound=false in a fresh store after logout', () => {
    const firstStore = createFreshAuthStore();
    firstStore.setToken('test-token');
    firstStore.setBound(true);
    firstStore.logout();

    expect(localStorage.getItem('tenant_token')).toBeNull();
    expect(localStorage.getItem('tenant_bound')).toBeNull();

    const refreshedStore = createFreshAuthStore();
    expect(refreshedStore).not.toBe(firstStore);
    expect(refreshedStore.bound).toBe(false);
  });
});
