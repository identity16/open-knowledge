import type { HocuspocusProvider } from '@hocuspocus/provider';
import { bindFrontmatterDoc } from '@inkeep/open-knowledge-core/bridge';
import type { FrontmatterMap } from '@inkeep/open-knowledge-core/frontmatter/schema';
import type { NotionPageLink } from '@inkeep/open-knowledge-core/schemas/api';
import { useEffect, useState } from 'react';

function readLink(map: FrontmatterMap): NotionPageLink | null {
  const value = map.notion;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { page, workspace } = value as Record<string, unknown>;
  return typeof page === 'string' &&
    page !== '' &&
    typeof workspace === 'string' &&
    workspace !== ''
    ? { page, workspace }
    : null;
}

export function useNotionLink(provider: HocuspocusProvider): NotionPageLink | null {
  const [link, setLink] = useState<NotionPageLink | null>(() => {
    const binding = bindFrontmatterDoc(provider);
    const initial = readLink(binding.current().map);
    binding.dispose();
    return initial;
  });

  useEffect(() => {
    const binding = bindFrontmatterDoc(provider);
    setLink(readLink(binding.current().map));
    const unsub = binding.subscribe((snapshot) => setLink(readLink(snapshot.map)));
    return () => {
      unsub();
      binding.dispose();
    };
  }, [provider]);

  return link;
}

export function writeNotionLink(provider: HocuspocusProvider, link: NotionPageLink): boolean {
  const binding = bindFrontmatterDoc(provider);
  try {
    return binding.patch({ notion: { page: link.page, workspace: link.workspace } }).ok;
  } finally {
    binding.dispose();
  }
}
