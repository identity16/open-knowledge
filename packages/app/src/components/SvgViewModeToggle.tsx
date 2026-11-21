import { useLingui } from '@lingui/react/macro';
import { Code, Image } from 'lucide-react';
import { setSvgViewMode, useSvgViewMode } from '@/editor/svg-view-mode';
import { EditorModeToggle } from './EditorModeToggle';

export function SvgViewModeToggle({ docName }: { docName: string }) {
  const { t } = useLingui();
  const mode = useSvgViewMode(docName);
  return (
    <EditorModeToggle
      isSourceMode={mode === 'source'}
      onModeChange={(next) => setSvgViewMode(docName, next === 'source' ? 'source' : 'preview')}
      wysiwygLabel={t`Preview`}
      sourceLabel={t`Source`}
      wysiwygIcon={<Image className="size-4" />}
      sourceIcon={<Code className="size-4" />}
    />
  );
}
