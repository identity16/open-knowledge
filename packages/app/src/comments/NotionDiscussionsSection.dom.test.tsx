import type { NotionDiscussionsResponse } from '@inkeep/open-knowledge-core/schemas/api';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  NotionDiscussionsOutcome,
  NotionDiscussionsTransport,
  NotionReplyOutcome,
} from '@/lib/transports/notion-discussions-transport';

const toasts: Array<[string, string]> = [];

vi.doMock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: import('react').ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((out, part, i) => `${out}${part}${values[i] ?? ''}`, ''),
  }),
}));
vi.doMock('sonner', () => ({
  toast: { error: (m: string) => toasts.push(['error', m]) },
}));
vi.doMock('@/components/acp/AgentMarkdown', () => ({
  AgentMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}));

const { NotionDiscussionsSection, notionPageUrl } = await import('./NotionDiscussionsSection');
const { TooltipProvider } = await import('@/components/ui/tooltip');

function show(fake: NotionDiscussionsTransport) {
  return render(
    <TooltipProvider>
      <NotionDiscussionsSection docName="notes/plan" transport={fake} />
    </TooltipProvider>,
  );
}

const listing: NotionDiscussionsResponse = {
  page: '41ca0a3f-aba4-81d7-a057-f24604be8c4a',
  complete: true,
  discussions: [
    {
      id: 'dp',
      anchor: { kind: 'page' },
      comments: [
        { id: 'c1', author: 'Ann', createdAt: '2026-11-18T01:00:00.000Z', markdown: 'Page note' },
      ],
    },
    {
      id: 'd2',
      anchor: { kind: 'block', blockId: 'b2', text: 'Beta line.' },
      comments: [
        { id: 'c2', author: 'Ann', createdAt: '2026-11-18T02:00:00.000Z', markdown: 'Why beta?' },
      ],
    },
  ],
};

function transport(
  lists: NotionDiscussionsOutcome[] = [{ kind: 'listed', listing }],
  replies: NotionReplyOutcome[] = [],
) {
  return {
    list: vi.fn(async () => lists.shift() ?? { kind: 'listed' as const, listing }),
    reply: vi.fn(async () => replies.shift() ?? { kind: 'failed' as const, message: null }),
  } satisfies NotionDiscussionsTransport;
}

afterEach(() => {
  cleanup();
  toasts.length = 0;
});

describe('NotionDiscussionsSection', () => {
  test('lists page and block discussions with their comments', async () => {
    show(transport());

    await waitFor(() => expect(screen.getAllByTestId('notion-discussion')).toHaveLength(2));
    expect(screen.getByText('On the whole page')).toBeTruthy();
    expect(screen.getByText('“Beta line.”')).toBeTruthy();
    expect(screen.getByText('Why beta?')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Notion' }).getAttribute('href')).toBe(
      notionPageUrl(listing.page),
    );
  });

  test('renders nothing for a document that is not linked', async () => {
    const fake = transport([{ kind: 'not-linked' }]);
    const { container } = show(fake);

    await waitFor(() => expect(fake.list).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelector('[data-testid="notion-discussions"]')).toBeNull(),
    );
  });

  test('a reply is sent to its discussion and shown under it', async () => {
    const fake = transport(undefined, [
      {
        kind: 'replied',
        comment: {
          id: 'c3',
          author: 'Joon',
          createdAt: '2026-11-19T00:00:00.000Z',
          markdown: 'Fixed',
        },
      },
    ]);
    show(fake);
    await waitFor(() => expect(screen.getAllByTestId('notion-discussion')).toHaveLength(2));

    const box = screen.getAllByRole('textbox', { name: 'Reply in Notion' })[1];
    if (!box) throw new Error('reply box missing');
    fireEvent.change(box, { target: { value: '  Fixed  ' } });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(screen.getByText('Fixed')).toBeTruthy());
    expect(fake.reply).toHaveBeenCalledWith('notes/plan', 'd2', 'Fixed');
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  test('a failed reply keeps the draft and reports why', async () => {
    const fake = transport(undefined, [
      { kind: 'failed', message: 'Notion refused the request: gone' },
    ]);
    show(fake);
    await waitFor(() => expect(screen.getAllByTestId('notion-discussion')).toHaveLength(2));

    const box = screen.getAllByRole('textbox', { name: 'Reply in Notion' })[0];
    if (!box) throw new Error('reply box missing');
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));

    await waitFor(() => expect(toasts).toEqual([['error', 'Notion refused the request: gone']]));
    expect((box as HTMLTextAreaElement).value).toBe('Hello');
  });

  test('a read failure is shown and Refresh reads again', async () => {
    const fake = transport([{ kind: 'failed', message: 'Notion could not be reached.' }]);
    show(fake);

    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Notion comments' }));

    await waitFor(() => expect(screen.getAllByTestId('notion-discussion')).toHaveLength(2));
    expect(fake.list).toHaveBeenCalledTimes(2);
  });

  test('says when the page was too long to read whole', async () => {
    const fake = transport([{ kind: 'listed', listing: { ...listing, complete: false } }]);
    show(fake);

    expect(await screen.findByText(/only comments in its first 200 blocks/)).toBeTruthy();
  });
});
