import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { NotionPageLink } from '@inkeep/open-knowledge-core/schemas/api';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  NotionPublishOutcome,
  NotionPublishTransport,
  NotionPullOutcome,
} from '@/lib/transports/notion-publish-transport';

let currentLink: NotionPageLink | null = null;
const written: NotionPageLink[] = [];
const toasts: Array<[string, string]> = [];

vi.doMock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: import('react').ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((out, part, i) => `${out}${part}${values[i] ?? ''}`, ''),
  }),
}));
vi.doMock('sonner', () => ({
  toast: {
    loading: (m: string) => {
      toasts.push(['loading', m]);
      return 'id';
    },
    success: (m: string) => toasts.push(['success', m]),
    warning: (m: string) => toasts.push(['warning', m]),
    error: (m: string) => toasts.push(['error', m]),
    dismiss: () => toasts.push(['dismiss', '']),
  },
}));
vi.doMock('@/lib/use-notion-link', () => ({
  useNotionLink: () => currentLink,
  writeNotionLink: (_provider: unknown, link: NotionPageLink) => {
    written.push(link);
    return true;
  },
}));

const { NotionToolbarControls } = await import('./NotionToolbarControls');
const provider = {} as HocuspocusProvider;

function transport(
  outcomes: NotionPublishOutcome[] = [{ kind: 'published', publishedAt: 't', merged: false }],
  pulls: NotionPullOutcome[] = [{ kind: 'merged' }],
) {
  return {
    resolvePage: vi.fn(async (url: string) =>
      url.includes('notion.so') ? { page: 'p1', workspace: 'w1', title: 'Plan' } : null,
    ),
    publish: vi.fn(async () => outcomes.shift() ?? { kind: 'failed' as const, message: null }),
    pull: vi.fn(async () => pulls.shift() ?? { kind: 'failed' as const, message: null }),
  } satisfies NotionPublishTransport;
}

beforeEach(() => {
  currentLink = null;
  written.length = 0;
  toasts.length = 0;
});
afterEach(() => cleanup());

describe('NotionToolbarControls', () => {
  test('an unlinked document links through a pasted page URL', async () => {
    const t = transport();
    render(<NotionToolbarControls provider={provider} docName="notes/plan" transport={t} />);
    fireEvent.click(screen.getByTestId('notion-link-open'));
    fireEvent.change(await screen.findByTestId('notion-link-url'), {
      target: { value: 'https://www.notion.so/Plan-abc' },
    });
    fireEvent.click(screen.getByTestId('notion-link-submit'));
    await waitFor(() => expect(written).toEqual([{ page: 'p1', workspace: 'w1' }]));
    expect(toasts).toContainEqual(['success', 'Linked to Plan']);
  });

  test('a URL no connection can open is reported and nothing is written', async () => {
    render(
      <NotionToolbarControls provider={provider} docName="notes/plan" transport={transport()} />,
    );
    fireEvent.click(screen.getByTestId('notion-link-open'));
    fireEvent.change(await screen.findByTestId('notion-link-url'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByTestId('notion-link-submit'));
    await waitFor(() =>
      expect(toasts).toContainEqual(['error', 'No connected Notion workspace can open that page.']),
    );
    expect(written).toEqual([]);
  });

  test('a linked document publishes and reports success', async () => {
    currentLink = { page: 'p1', workspace: 'w1' };
    const t = transport();
    render(<NotionToolbarControls provider={provider} docName="notes/plan" transport={t} />);
    fireEvent.click(screen.getByTestId('notion-publish'));
    await waitFor(() => expect(toasts).toContainEqual(['success', 'Published to Notion']));
    expect(t.publish).toHaveBeenCalledWith('notes/plan', false);
  });

  test('a non-empty page asks before replacing, then publishes with overwrite', async () => {
    currentLink = { page: 'p1', workspace: 'w1' };
    const t = transport([
      { kind: 'page-not-empty' },
      { kind: 'published', publishedAt: 't', merged: false },
    ]);
    render(<NotionToolbarControls provider={provider} docName="notes/plan" transport={t} />);
    fireEvent.click(screen.getByTestId('notion-publish'));
    expect(await screen.findByText('The Notion page already has content')).not.toBeNull();
    fireEvent.click(screen.getByTestId('notion-overwrite-confirm'));
    await waitFor(() => expect(t.publish).toHaveBeenLastCalledWith('notes/plan', true));
  });

  test('a publish that merged Notion edits says so', async () => {
    currentLink = { page: 'p1', workspace: 'w1' };
    const t = transport([{ kind: 'published', publishedAt: 't', merged: true }]);
    render(<NotionToolbarControls provider={provider} docName="notes/plan" transport={t} />);
    fireEvent.click(screen.getByTestId('notion-publish'));
    await waitFor(() =>
      expect(toasts).toContainEqual(['success', 'Merged the Notion edits and published']),
    );
  });

  test('a conflicting publish points to the conflict instead of offering to overwrite', async () => {
    currentLink = { page: 'p1', workspace: 'w1' };
    const t = transport([{ kind: 'changed-in-notion' }]);
    render(<NotionToolbarControls provider={provider} docName="notes/plan" transport={t} />);
    fireEvent.click(screen.getByTestId('notion-publish'));
    await waitFor(() =>
      expect(toasts).toContainEqual([
        'warning',
        'This document and Notion changed the same part. Choose what to keep.',
      ]),
    );
    expect(screen.queryByTestId('notion-overwrite-confirm')).toBeNull();
  });

  test('cancelling the overwrite does not publish again', async () => {
    currentLink = { page: 'p1', workspace: 'w1' };
    const t = transport([{ kind: 'page-not-empty' }]);
    render(<NotionToolbarControls provider={provider} docName="notes/plan" transport={t} />);
    fireEvent.click(screen.getByTestId('notion-publish'));
    fireEvent.click(await screen.findByTestId('notion-overwrite-cancel'));
    await waitFor(() => expect(screen.queryByTestId('notion-overwrite-confirm')).toBeNull());
    expect(t.publish).toHaveBeenCalledTimes(1);
  });

  test('a failed publish shows the server message', async () => {
    currentLink = { page: 'p1', workspace: 'w1' };
    const t = transport([{ kind: 'failed', message: 'Notion refused the request: x' }]);
    render(<NotionToolbarControls provider={provider} docName="notes/plan" transport={t} />);
    fireEvent.click(screen.getByTestId('notion-publish'));
    await waitFor(() => expect(toasts).toContainEqual(['error', 'Notion refused the request: x']));
  });
});
