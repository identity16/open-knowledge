import type { FileTreeSortOrder } from '@inkeep/open-knowledge-core/config/schema';
import { useLingui } from '@lingui/react/macro';

export function useSortOrderLabels(): Record<FileTreeSortOrder, string> {
  const { t } = useLingui();
  return {
    name: t`Name (A to Z)`,
    'name-desc': t`Name (Z to A)`,
    modified: t`Date modified (newest first)`,
    'modified-asc': t`Date modified (oldest first)`,
    manual: t`Manual`,
  };
}
