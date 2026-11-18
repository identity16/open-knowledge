import { describe, expect, test } from 'vitest';
import {
  createNotionTokenStore,
  type KeyringEntry,
  type KeyringEntryFactory,
  NotionTokenStoreError,
} from './token-store.ts';

function memoryKeyring() {
  const values = new Map<string, string>();
  const factory: KeyringEntryFactory = async (account) =>
    ({
      getPassword: async () => values.get(account) ?? null,
      setPassword: async (value) => {
        values.set(account, value);
      },
      deletePassword: async () => values.delete(account),
    }) satisfies KeyringEntry;
  return { values, factory };
}

describe('createNotionTokenStore', () => {
  test('stores tokens per workspace and reads them back', async () => {
    const { factory } = memoryKeyring();
    const store = createNotionTokenStore(factory);
    await store.set('w1', { accessToken: 'a1', refreshToken: 'r1' });
    await store.set('w2', { accessToken: 'a2', refreshToken: null });
    expect(await store.get('w1')).toEqual({ accessToken: 'a1', refreshToken: 'r1' });
    expect(await store.get('w2')).toEqual({ accessToken: 'a2', refreshToken: null });
    expect(await store.get('w3')).toBeNull();
  });

  test('clear removes only that workspace and tolerates a missing entry', async () => {
    const { factory, values } = memoryKeyring();
    const store = createNotionTokenStore(factory);
    await store.set('w1', { accessToken: 'a1', refreshToken: 'r1' });
    await store.set('w2', { accessToken: 'a2', refreshToken: 'r2' });
    await store.clear('w1');
    await store.clear('missing');
    expect([...values.keys()]).toEqual(['w2']);
  });

  test('a corrupt keyring value is reported, not returned', async () => {
    const { factory, values } = memoryKeyring();
    values.set('w1', 'not json');
    await expect(createNotionTokenStore(factory).get('w1')).rejects.toMatchObject({
      reason: 'corrupt',
    });
  });

  test('a keyring that never answers times out', async () => {
    const factory: KeyringEntryFactory = async () => ({
      getPassword: () => new Promise(() => {}),
      setPassword: () => new Promise(() => {}),
      deletePassword: () => new Promise(() => {}),
    });
    const error = await createNotionTokenStore(factory, 20)
      .get('w1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotionTokenStoreError);
    expect(error).toMatchObject({ operation: 'get', reason: 'timeout' });
  });

  test('a keyring failure is wrapped with the operation that failed', async () => {
    const factory: KeyringEntryFactory = async () => {
      throw new Error('locked');
    };
    await expect(
      createNotionTokenStore(factory).set('w1', { accessToken: 'a', refreshToken: null }),
    ).rejects.toMatchObject({ operation: 'set', reason: 'keyring' });
  });
});
