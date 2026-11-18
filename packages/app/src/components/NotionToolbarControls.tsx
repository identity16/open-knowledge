import type { HocuspocusProvider } from '@hocuspocus/provider';
import { Trans, useLingui } from '@lingui/react/macro';
import { Link2, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  httpNotionPublishTransport,
  type NotionPublishTransport,
} from '@/lib/transports/notion-publish-transport';
import { useNotionLink, writeNotionLink } from '@/lib/use-notion-link';

const defaultTransport = httpNotionPublishTransport();

type OverwriteReason = 'page-not-empty' | 'changed-in-notion' | null;

export function NotionToolbarControls({
  provider,
  docName,
  transport = defaultTransport,
}: {
  provider: HocuspocusProvider;
  docName: string;
  transport?: NotionPublishTransport;
}) {
  const { t } = useLingui();
  const link = useNotionLink(provider);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [overwrite, setOverwrite] = useState<OverwriteReason>(null);

  async function linkPage() {
    setBusy(true);
    const resolved = await transport.resolvePage(url);
    setBusy(false);
    if (resolved === null) {
      toast.error(t`No connected Notion workspace can open that page.`);
      return;
    }
    if (!writeNotionLink(provider, { page: resolved.page, workspace: resolved.workspace })) {
      toast.error(t`Could not save the Notion link in this document.`);
      return;
    }
    setLinkOpen(false);
    setUrl('');
    toast.success(resolved.title ? t`Linked to ${resolved.title}` : t`Linked to the Notion page`);
  }

  async function publish(force: boolean) {
    setBusy(true);
    const toastId = toast.loading(t`Publishing to Notion…`);
    const outcome = await transport.publish(docName, force);
    setBusy(false);
    switch (outcome.kind) {
      case 'published':
        toast.success(t`Published to Notion`, { id: toastId });
        return;
      case 'page-not-empty':
      case 'changed-in-notion':
        toast.dismiss(toastId);
        setOverwrite(outcome.kind);
        return;
      case 'failed':
        toast.error(outcome.message ?? t`Could not publish to Notion.`, { id: toastId });
    }
  }

  return (
    <>
      {link === null ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLinkOpen(true)}
          data-testid="notion-link-open"
        >
          <Link2 aria-hidden className="size-4" />
          <Trans>Link Notion page</Trans>
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void publish(false)}
          data-testid="notion-publish"
        >
          <Send aria-hidden className="size-4" />
          <Trans>Publish to Notion</Trans>
        </Button>
      )}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>Link a Notion page</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>Paste the link of a page in a connected Notion workspace.</Trans>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.notion.so/"
            aria-label={t`Notion page link`}
            data-testid="notion-link-url"
          />
          <DialogFooter>
            <Button
              disabled={busy || url.trim() === ''}
              onClick={() => void linkPage()}
              data-testid="notion-link-submit"
            >
              <Trans>Link</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={overwrite !== null} onOpenChange={(open) => !open && setOverwrite(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {overwrite === 'changed-in-notion' ? (
                <Trans>The Notion page changed</Trans>
              ) : (
                <Trans>The Notion page already has content</Trans>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {overwrite === 'changed-in-notion' ? (
                <Trans>
                  Someone edited the page in Notion since you last published. Publishing now
                  replaces their changes with this document.
                </Trans>
              ) : (
                <Trans>Publishing replaces the page's current content with this document.</Trans>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="notion-overwrite-cancel">
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOverwrite(null);
                void publish(true);
              }}
              data-testid="notion-overwrite-confirm"
            >
              <Trans>Replace Notion content</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
