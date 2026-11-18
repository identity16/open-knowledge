import type { NotionConnectFlowStatus } from '@inkeep/open-knowledge-core/schemas/api';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { NotionConnectionsTransport } from '@/lib/transports/notion-connections-transport';

const opened: string[] = [];

vi.doMock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: import('react').ReactNode }) => children,
}));
vi.doMock('@/lib/external-link', () => ({
  openExternalUrl: (url: string) => opened.push(url),
}));
vi.doMock('./SettingsSectionHeader', () => ({
  SettingsSectionHeader: ({ children }: { children: import('react').ReactNode }) => (
    <div>{children}</div>
  ),
}));

const { NotionSection, NOTION_FLOW_POLL_MS } = await import('./NotionSection');

const joon = {
  workspaceId: 'w1',
  workspaceName: 'Joon',
  workspaceIcon: null,
  connectedAt: '2026-11-18T00:00:00.000Z',
};

function fakeTransport(overrides: Partial<NotionConnectionsTransport> = {}) {
  return {
    list: vi.fn(async () => [joon]),
    start: vi.fn(async () => ({
      flowId: 'f1',
      authorizeUrl: 'https://api.notion.com/v1/oauth/authorize?s=1',
    })),
    flow: vi.fn(async (): Promise<NotionConnectFlowStatus | null> => ({ status: 'pending' })),
    disconnect: vi.fn(async () => true),
    ...overrides,
  } satisfies NotionConnectionsTransport;
}

beforeEach(() => {
  opened.length = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('NotionSection', () => {
  test('lists connected workspaces and says so when there are none', async () => {
    render(<NotionSection transport={fakeTransport()} />);
    expect(await screen.findByText('Joon')).not.toBeNull();
    cleanup();
    render(<NotionSection transport={fakeTransport({ list: async () => [] })} />);
    expect(await screen.findByText('No Notion workspaces connected yet.')).not.toBeNull();
  });

  test('connect opens Notion, polls the flow, and refreshes the list once connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const flow = vi
      .fn<NotionConnectionsTransport['flow']>()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'connected', workspace: joon });
    const list = vi
      .fn<NotionConnectionsTransport['list']>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([joon]);
    const transport = fakeTransport({ flow, list });
    render(<NotionSection transport={transport} />);

    fireEvent.click(await screen.findByTestId('notion-connect'));
    await screen.findByTestId('notion-connecting');
    expect(opened).toEqual(['https://api.notion.com/v1/oauth/authorize?s=1']);

    await act(() => vi.advanceTimersByTimeAsync(NOTION_FLOW_POLL_MS * 2));
    await waitFor(() => expect(screen.queryByTestId('notion-connecting')).toBeNull());
    expect(await screen.findByText('Joon')).not.toBeNull();
    expect(flow).toHaveBeenCalledWith('f1');
  });

  test('a declined approval ends the wait with a notice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <NotionSection transport={fakeTransport({ flow: async () => ({ status: 'denied' }) })} />,
    );
    fireEvent.click(await screen.findByTestId('notion-connect'));
    await screen.findByTestId('notion-connecting');
    await act(() => vi.advanceTimersByTimeAsync(NOTION_FLOW_POLL_MS));
    expect((await screen.findByTestId('notion-notice')).textContent).toBe(
      'Notion was not connected.',
    );
    expect(screen.queryByTestId('notion-connecting')).toBeNull();
  });

  test('reopen sends the user back to the same authorize URL', async () => {
    render(<NotionSection transport={fakeTransport()} />);
    fireEvent.click(await screen.findByTestId('notion-connect'));
    fireEvent.click(await screen.findByTestId('notion-reopen'));
    expect(opened).toEqual([
      'https://api.notion.com/v1/oauth/authorize?s=1',
      'https://api.notion.com/v1/oauth/authorize?s=1',
    ]);
  });

  test('disconnect calls the transport and reloads', async () => {
    const list = vi
      .fn<NotionConnectionsTransport['list']>()
      .mockResolvedValueOnce([joon])
      .mockResolvedValue([]);
    const transport = fakeTransport({ list });
    render(<NotionSection transport={transport} />);
    fireEvent.click(await screen.findByTestId('notion-disconnect'));
    expect(await screen.findByText('No Notion workspaces connected yet.')).not.toBeNull();
    expect(transport.disconnect).toHaveBeenCalledWith('w1');
  });

  test('a failed disconnect is reported', async () => {
    render(<NotionSection transport={fakeTransport({ disconnect: async () => false })} />);
    fireEvent.click(await screen.findByTestId('notion-disconnect'));
    expect((await screen.findByTestId('notion-notice')).textContent).toBe(
      'Could not disconnect. Try again.',
    );
  });
});
