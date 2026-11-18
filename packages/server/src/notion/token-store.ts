import { currentDesktopProduct } from '@inkeep/open-knowledge-core';

export const NOTION_TOKEN_STORE_TIMEOUT_MS = 2000;

export interface NotionTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
}

export interface NotionTokenStore {
  get(workspaceId: string): Promise<NotionTokens | null>;
  set(workspaceId: string, tokens: NotionTokens): Promise<void>;
  clear(workspaceId: string): Promise<void>;
}

export interface KeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

export type KeyringEntryFactory = (account: string) => Promise<KeyringEntry>;

export class NotionTokenStoreError extends Error {
  readonly operation: 'get' | 'set' | 'clear';
  readonly reason: 'timeout' | 'keyring' | 'corrupt';

  constructor(
    operation: NotionTokenStoreError['operation'],
    reason: NotionTokenStoreError['reason'],
    options?: { cause?: unknown },
  ) {
    super(`Notion token ${operation} failed: ${reason}`, options);
    this.name = 'NotionTokenStoreError';
    this.operation = operation;
    this.reason = reason;
  }
}

export function notionKeyringService(): string {
  return `${currentDesktopProduct().keyringService}-notion`;
}

const defaultEntryFactory: KeyringEntryFactory = async (account) => {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  return new AsyncEntry(notionKeyringService(), account);
};

export function createNotionTokenStore(
  entryFactory: KeyringEntryFactory = defaultEntryFactory,
  timeoutMs = NOTION_TOKEN_STORE_TIMEOUT_MS,
): NotionTokenStore {
  async function run<T>(
    operation: NotionTokenStoreError['operation'],
    fn: () => Promise<T>,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new NotionTokenStoreError(operation, 'timeout')), timeoutMs);
    });
    try {
      return await Promise.race([
        fn().catch((cause: unknown) => {
          if (cause instanceof NotionTokenStoreError) throw cause;
          throw new NotionTokenStoreError(operation, 'keyring', { cause });
        }),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    get: (workspaceId) =>
      run('get', async () => {
        const raw = await (await entryFactory(workspaceId)).getPassword();
        if (raw === null) return null;
        return parseTokens(raw);
      }),
    set: (workspaceId, tokens) =>
      run('set', async () => {
        await (await entryFactory(workspaceId)).setPassword(JSON.stringify(tokens));
      }),
    clear: (workspaceId) =>
      run('clear', async () => {
        await (await entryFactory(workspaceId)).deletePassword();
      }),
  };
}

function parseTokens(raw: string): NotionTokens {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new NotionTokenStoreError('get', 'corrupt', { cause });
  }
  if (typeof value !== 'object' || value === null)
    throw new NotionTokenStoreError('get', 'corrupt');
  const { accessToken, refreshToken } = value as Record<string, unknown>;
  if (typeof accessToken !== 'string' || accessToken === '')
    throw new NotionTokenStoreError('get', 'corrupt');
  return {
    accessToken,
    refreshToken: typeof refreshToken === 'string' && refreshToken !== '' ? refreshToken : null,
  };
}
