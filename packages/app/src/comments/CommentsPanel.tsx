import { Trans } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useConfigContextOptional } from '@/lib/config-context';
import { ProfilerBoundary } from '@/lib/perf';
import { CommentListPanel } from './CommentListPanel';
import { NotionDiscussionsSection } from './NotionDiscussionsSection';
import { refresh, useCommentThreads } from './store';

function CommentsPanelInner({
  docName,
  scopeSwitch,
  onDestinationComplete,
}: {
  docName: string;
  scopeSwitch?: ReactNode;
  onDestinationComplete?: (target: HTMLElement) => void;
}) {
  const threads = useCommentThreads(docName);
  const notionEnabled = useConfigContextOptional()?.projectConfig?.notion?.enabled === true;

  useEffect(() => {
    void refresh(docName).catch(() => undefined);
  }, [docName]);

  return (
    <CommentListPanel
      threads={threads}
      empty={<Trans>No comments yet. Select text in the document to add one.</Trans>}
      testIdPrefix="comment-doc"
      scopeSwitch={scopeSwitch}
      onDestinationComplete={onDestinationComplete}
      after={notionEnabled ? <NotionDiscussionsSection key={docName} docName={docName} /> : null}
    />
  );
}

export function CommentsPanel({
  docName,
  scopeSwitch,
  onDestinationComplete,
}: {
  docName: string;
  scopeSwitch?: ReactNode;
  onDestinationComplete?: (target: HTMLElement) => void;
}) {
  return (
    <ProfilerBoundary name="comments-panel">
      <CommentsPanelInner
        docName={docName}
        scopeSwitch={scopeSwitch}
        onDestinationComplete={onDestinationComplete}
      />
    </ProfilerBoundary>
  );
}
