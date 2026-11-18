import { describe, expect, test } from 'vitest';
import {
  durableGrantStore,
  GrantVault,
  type VaultNamespace,
  type VaultStorage,
} from './grant-vault.ts';

class MemoryStorage implements VaultStorage {
  readonly data = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined;
  }
  async put(key: string, value: unknown) {
    this.data.set(key, value);
  }
  async deleteAll() {
    this.data.clear();
  }
  async setAlarm(time: number) {
    this.alarm = time;
  }
}

function namespace(now: () => number) {
  const vaults = new Map<string, { vault: GrantVault; storage: MemoryStorage }>();
  const ns: VaultNamespace = {
    idFromName: (name) => name,
    get: (id) => {
      const name = String(id);
      if (!vaults.has(name)) {
        const storage = new MemoryStorage();
        vaults.set(name, { vault: new GrantVault({ storage }, undefined, now), storage });
      }
      const { vault } = vaults.get(name) as { vault: GrantVault };
      return { fetch: (url, init) => vault.fetch(new Request(url, init)) };
    },
  };
  return { ns, vaults };
}

describe('durableGrantStore', () => {
  test('a value written under one key is readable immediately and only under that key', async () => {
    const { ns } = namespace(() => 1_000);
    const store = durableGrantStore(ns);
    expect(await store.get('grant:a')).toBeNull();
    await store.put('grant:a', 'value-a', { expirationTtl: 300 });
    expect(await store.get('grant:a')).toBe('value-a');
    expect(await store.get('grant:b')).toBeNull();
  });

  test('delete removes the value', async () => {
    const { ns } = namespace(() => 0);
    const store = durableGrantStore(ns);
    await store.put('k', 'v', { expirationTtl: 300 });
    await store.delete('k');
    expect(await store.get('k')).toBeNull();
  });

  test('a value past its TTL reads as missing even before the alarm fires', async () => {
    let now = 0;
    const { ns } = namespace(() => now);
    const store = durableGrantStore(ns);
    await store.put('k', 'v', { expirationTtl: 300 });
    now = 300_001;
    expect(await store.get('k')).toBeNull();
  });

  test('put schedules an alarm at expiry and the alarm clears the vault', async () => {
    const { ns, vaults } = namespace(() => 5_000);
    const store = durableGrantStore(ns);
    await store.put('k', 'v', { expirationTtl: 300 });
    const entry = vaults.get('k');
    expect(entry?.storage.alarm).toBe(305_000);
    await entry?.vault.alarm();
    expect(await store.get('k')).toBeNull();
  });

  test('the vault rejects an unknown operation', async () => {
    const vault = new GrantVault({ storage: new MemoryStorage() });
    const response = await vault.fetch(
      new Request('https://grant-vault/', { method: 'POST', body: '{"op":"nope"}' }),
    );
    expect(response.status).toBe(400);
  });
});
