import type { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import { ImageViewer } from '@/components/ImageViewer';
import { useSvgViewMode } from '@/editor/svg-view-mode';
import { TextDocEditor } from './TextDocEditor';

export function SvgDocView({
  docName,
  provider,
}: {
  docName: string;
  provider: HocuspocusProvider;
}) {
  const mode = useSvgViewMode(docName);
  if (mode === 'source') return <TextDocEditor docName={docName} provider={provider} />;
  return <SvgDocPreview docName={docName} provider={provider} />;
}

function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function SvgDocPreview({ docName, provider }: { docName: string; provider: HocuspocusProvider }) {
  const ytext = provider.document.getText('source');
  const [markup, setMarkup] = useState(() => ytext.toString());
  useEffect(() => {
    const sync = () => setMarkup(ytext.toString());
    ytext.observe(sync);
    sync();
    return () => ytext.unobserve(sync);
  }, [ytext]);
  const fileName = docName.slice(docName.lastIndexOf('/') + 1);
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background pt-12"
      aria-label={fileName}
      data-svg-doc-preview=""
    >
      <ImageViewer src={svgDataUrl(markup)} fileName={fileName} />
    </section>
  );
}
