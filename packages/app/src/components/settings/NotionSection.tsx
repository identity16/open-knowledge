import type { NotionWorkspaceConnection } from '@inkeep/open-knowledge-core/schemas/api';
import { Trans } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { openExternalUrl } from '@/lib/external-link';
import {
  httpNotionConnectionsTransport,
  type NotionConnectionsTransport,
} from '@/lib/transports/notion-connections-transport';
import { SettingsSectionHeader } from './SettingsSectionHeader';

export const NOTION_FLOW_POLL_MS = 2000;

type Notice = 'denied' | 'expired' | 'failed' | 'disconnect-failed' | 'load-failed' | null;

interface Connecting {
  readonly flowId: string;
  readonly authorizeUrl: string;
}

const defaultTransport = httpNotionConnectionsTransport();

export function NotionSection({
  transport = defaultTransport,
}: {
  transport?: NotionConnectionsTransport;
}) {
  const [connections, setConnections] = useState<NotionWorkspaceConnection[] | null>(null);
  const [connecting, setConnecting] = useState<Connecting | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const list = await transport.list();
    if (list === null) setNotice('load-failed');
    else setConnections(list);
  }

  useEffect(() => {
    let cancelled = false;
    void transport.list().then((list) => {
      if (cancelled) return;
      if (list === null) setNotice('load-failed');
      else setConnections(list);
    });
    return () => {
      cancelled = true;
    };
  }, [transport]);

  useEffect(() => {
    if (connecting === null) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void transport.flow(connecting.flowId).then((status) => {
        if (cancelled || status === null || status.status === 'pending') return;
        setConnecting(null);
        if (status.status === 'connected') {
          setNotice(null);
          void transport.list().then((list) => {
            if (list !== null) setConnections(list);
          });
        } else {
          setNotice(status.status);
        }
      });
    }, NOTION_FLOW_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connecting, transport]);

  async function connect() {
    setBusy(true);
    setNotice(null);
    const started = await transport.start();
    setBusy(false);
    if (started === null) {
      setNotice('failed');
      return;
    }
    setConnecting(started);
    openExternalUrl(started.authorizeUrl);
  }

  async function disconnect(workspaceId: string) {
    setBusy(true);
    const ok = await transport.disconnect(workspaceId);
    setBusy(false);
    setNotice(ok ? null : 'disconnect-failed');
    await reload();
  }

  return (
    <section aria-labelledby="settings-notion-title" className="space-y-3">
      <SettingsSectionHeader
        titleId="settings-notion-title"
        title={<Trans>Notion</Trans>}
        scope="user"
      >
        <Trans>Connect Notion workspaces so documents can sync with Notion pages.</Trans>
      </SettingsSectionHeader>

      <div className="rounded-md border divide-y" data-testid="notion-connections">
        {connections !== null && connections.length === 0 ? (
          <p className="p-3 text-1sm text-muted-foreground">
            <Trans>No Notion workspaces connected yet.</Trans>
          </p>
        ) : null}
        {connections?.map((connection) => (
          <div
            key={connection.workspaceId}
            className="flex items-center justify-between gap-3 p-3"
            data-testid="notion-connection"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {connection.workspaceName || connection.workspaceId}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void disconnect(connection.workspaceId)}
              data-testid="notion-disconnect"
            >
              <Trans>Disconnect</Trans>
            </Button>
          </div>
        ))}
      </div>

      {connecting === null ? (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void connect()}
          data-testid="notion-connect"
        >
          <Trans>Connect a workspace</Trans>
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border p-3" data-testid="notion-connecting">
          <p className="text-1sm">
            <Trans>Approve the connection in the Notion window that opened.</Trans>
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openExternalUrl(connecting.authorizeUrl)}
              data-testid="notion-reopen"
            >
              <Trans>Open Notion again</Trans>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConnecting(null)}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </div>
      )}

      {notice !== null ? (
        <p className="text-1sm text-destructive" role="status" data-testid="notion-notice">
          {notice === 'denied' ? <Trans>Notion was not connected.</Trans> : null}
          {notice === 'expired' ? <Trans>The Notion approval timed out. Try again.</Trans> : null}
          {notice === 'failed' ? <Trans>Could not connect to Notion. Try again.</Trans> : null}
          {notice === 'disconnect-failed' ? <Trans>Could not disconnect. Try again.</Trans> : null}
          {notice === 'load-failed' ? <Trans>Could not load Notion connections.</Trans> : null}
        </p>
      ) : null}
    </section>
  );
}
