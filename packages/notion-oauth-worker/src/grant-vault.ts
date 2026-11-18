import type { GrantStore } from './worker.ts';

interface StoredValue {
  readonly value: string;
  readonly expiresAt: number;
}

export interface VaultStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
}

export interface VaultState {
  readonly storage: VaultStorage;
}

type VaultRequest =
  | { readonly op: 'get' }
  | { readonly op: 'put'; readonly value: string; readonly ttlSeconds: number }
  | { readonly op: 'delete' };

export class GrantVault {
  readonly #storage: VaultStorage;
  readonly #now: () => number;

  constructor(state: VaultState, _env?: unknown, now: () => number = Date.now) {
    this.#storage = state.storage;
    this.#now = now;
  }

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as VaultRequest | null;
    if (body?.op === 'get') {
      const stored = await this.#storage.get<StoredValue>('grant');
      const live = stored !== undefined && stored.expiresAt > this.#now();
      return Response.json({ value: live ? stored.value : null });
    }
    if (body?.op === 'put' && typeof body.value === 'string') {
      const expiresAt = this.#now() + body.ttlSeconds * 1000;
      await this.#storage.put('grant', { value: body.value, expiresAt } satisfies StoredValue);
      await this.#storage.setAlarm(expiresAt);
      return Response.json({ ok: true });
    }
    if (body?.op === 'delete') {
      await this.#storage.deleteAll();
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }

  async alarm(): Promise<void> {
    await this.#storage.deleteAll();
  }
}

export interface VaultStub {
  fetch(url: string, init: RequestInit): Promise<Response>;
}

export interface VaultNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): VaultStub;
}

export function durableGrantStore(namespace: VaultNamespace): GrantStore {
  const call = async (key: string, request: VaultRequest): Promise<{ value?: string | null }> => {
    const stub = namespace.get(namespace.idFromName(key));
    const response = await stub.fetch('https://grant-vault/', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`grant vault answered ${response.status}`);
    return (await response.json()) as { value?: string | null };
  };
  return {
    async get(key) {
      return (await call(key, { op: 'get' })).value ?? null;
    },
    async put(key, value, options) {
      await call(key, { op: 'put', value, ttlSeconds: options.expirationTtl });
    },
    async delete(key) {
      await call(key, { op: 'delete' });
    },
  };
}
