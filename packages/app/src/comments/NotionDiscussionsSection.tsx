import type {
  NotionComment,
  NotionDiscussion,
  NotionDiscussionsResponse,
} from '@inkeep/open-knowledge-core/schemas/api';
import { Trans, useLingui } from '@lingui/react/macro';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { type KeyboardEvent, type SubmitEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AgentMarkdown } from '@/components/acp/AgentMarkdown';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getVisibleEditorForDoc } from '@/editor/active-editor';
import {
  httpNotionDiscussionsTransport,
  type NotionDiscussionsTransport,
} from '@/lib/transports/notion-discussions-transport';
import { findQuoteRange } from './anchor-search';
import { scrollAnchorIntoView } from './scroll-to-anchor';
import { editedAt } from './ThreadCard';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'failed'; readonly message: string | null }
  | { readonly kind: 'listed'; readonly listing: NotionDiscussionsResponse };

const defaultTransport = httpNotionDiscussionsTransport();

export function notionPageUrl(page: string): string {
  return `https://www.notion.so/${page.replaceAll('-', '')}`;
}

function NotionCommentRow({ comment, now }: { comment: NotionComment; now: number }) {
  const at = Date.parse(comment.createdAt);
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
        <span className="truncate font-medium text-foreground/90">{comment.author}</span>
        {Number.isFinite(at) && (
          <span className="shrink-0" title={new Date(at).toLocaleString()}>
            {editedAt(at, now)}
          </span>
        )}
      </div>
      <AgentMarkdown text={comment.markdown} untrusted className="text-sm text-foreground/90" />
    </li>
  );
}

function DiscussionCard({
  docName,
  discussion,
  transport,
  now,
  onReplied,
}: {
  docName: string;
  discussion: NotionDiscussion;
  transport: NotionDiscussionsTransport;
  now: number;
  onReplied: (comment: NotionComment) => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const anchor = discussion.anchor;

  function jumpToBlock() {
    if (anchor.kind !== 'block' || anchor.text.trim() === '') return;
    const editor = getVisibleEditorForDoc(docName);
    const range = editor ? findQuoteRange(editor.state.doc, anchor.text.trim()) : null;
    if (!editor || !range || !scrollAnchorIntoView(editor, range, docName)) {
      toast.error(t`Couldn't find that passage — the text it was on may have changed.`);
    }
  }

  async function send(event?: SubmitEvent<HTMLFormElement>) {
    event?.preventDefault();
    const markdown = draft.trim();
    if (markdown === '' || sending) return;
    setSending(true);
    const outcome = await transport.reply(docName, discussion.id, markdown);
    setSending(false);
    if (outcome.kind === 'replied') {
      setDraft('');
      onReplied(outcome.comment);
      return;
    }
    toast.error(outcome.message ?? t`Couldn't send the reply to Notion.`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send();
  }

  return (
    <article
      aria-label={t`Notion discussion`}
      data-testid="notion-discussion"
      className="flex flex-col gap-2 border-b py-3 last:border-b-0"
    >
      {anchor.kind === 'block' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              onClick={jumpToBlock}
              disabled={anchor.text.trim() === ''}
              className="h-auto w-full justify-start truncate rounded-none border-l-2 border-l-muted-foreground/40 px-2 py-0.5 text-left text-sm font-normal text-muted-foreground hover:bg-muted/70 disabled:opacity-100"
            >
              <span className="truncate">“{anchor.text}”</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <Trans>Jump to the anchored text</Trans>
          </TooltipContent>
        </Tooltip>
      ) : (
        <p className="border-l-2 border-l-muted-foreground/40 px-2 py-0.5 text-sm text-muted-foreground">
          <Trans>On the whole page</Trans>
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {discussion.comments.map((comment) => (
          <NotionCommentRow key={comment.id} comment={comment} now={now} />
        ))}
      </ul>
      <form className="flex flex-col gap-1.5" onSubmit={(event) => void send(event)}>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
          aria-label={t`Reply in Notion`}
          placeholder={t`Reply in Notion`}
          className="min-h-9 text-sm"
        />
        {draft.trim() !== '' && (
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={sending}>
              {sending ? <Spinner className="size-3.5" /> : null}
              <Trans>Reply</Trans>
            </Button>
          </div>
        )}
      </form>
    </article>
  );
}

export function NotionDiscussionsSection({
  docName,
  transport = defaultTransport,
}: {
  docName: string;
  transport?: NotionDiscussionsTransport;
}) {
  const { t } = useLingui();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [generation, setGeneration] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation is the refresh button's request to read Notion again; the effect reads nothing from it
  useEffect(() => {
    let live = true;
    setLoad({ kind: 'loading' });
    void transport.list(docName).then((outcome) => {
      if (!live) return;
      setNow(Date.now());
      if (outcome.kind === 'listed') setLoad({ kind: 'listed', listing: outcome.listing });
      else if (outcome.kind === 'not-linked') setLoad({ kind: 'hidden' });
      else setLoad({ kind: 'failed', message: outcome.message });
    });
    return () => {
      live = false;
    };
  }, [docName, transport, generation]);

  if (load.kind === 'hidden') return null;

  function appendReply(discussionId: string, comment: NotionComment) {
    setLoad((current) =>
      current.kind !== 'listed'
        ? current
        : {
            kind: 'listed',
            listing: {
              ...current.listing,
              discussions: current.listing.discussions.map((d) =>
                d.id === discussionId ? { ...d, comments: [...d.comments, comment] } : d,
              ),
            },
          },
    );
  }

  const count = load.kind === 'listed' ? load.listing.discussions.length : null;

  return (
    <section aria-label={t`Notion comments`} data-testid="notion-discussions" className="mt-4">
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Trans>Notion</Trans>
          {count !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {load.kind === 'listed' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground"
                  asChild
                >
                  <a
                    href={notionPageUrl(load.listing.page)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t`Open in Notion`}
                  >
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <Trans>Open in Notion</Trans>
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 text-muted-foreground"
                aria-label={t`Refresh Notion comments`}
                disabled={load.kind === 'loading'}
                onClick={() => setGeneration((g) => g + 1)}
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <Trans>Refresh Notion comments</Trans>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {load.kind === 'loading' ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner className="size-3.5" />
          <Trans>Reading comments from Notion</Trans>
        </div>
      ) : load.kind === 'failed' ? (
        <p role="alert" className="py-3 text-sm text-muted-foreground">
          {load.message ?? t`Couldn't read comments from Notion.`}
        </p>
      ) : (
        <>
          {load.listing.discussions.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              <Trans>No open comments on the Notion page.</Trans>
            </p>
          ) : (
            load.listing.discussions.map((discussion) => (
              <DiscussionCard
                key={discussion.id}
                docName={docName}
                discussion={discussion}
                transport={transport}
                now={now}
                onReplied={(comment) => appendReply(discussion.id, comment)}
              />
            ))
          )}
          {!load.listing.complete && (
            <p className="pt-2 text-xs text-muted-foreground">
              <Trans>The page is long; only comments in its first 200 blocks are shown.</Trans>
            </p>
          )}
          <p className="pt-2 text-xs text-muted-foreground">
            <Trans>Resolve comments in Notion; resolved ones disappear here.</Trans>
          </p>
        </>
      )}
    </section>
  );
}
