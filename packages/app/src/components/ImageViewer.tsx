import { useLingui } from '@lingui/react/macro';
import type { PanzoomObject } from '@panzoom/panzoom';
import { useRef, useState } from 'react';
import { LoadingImage } from '@/components/ui/loading-image';
import { loadPanzoom, PanzoomControls } from '@/editor/components/Mermaid';

const IMAGE_ZOOM_MIN = 0.5;
const IMAGE_ZOOM_MAX = 8;
const IMAGE_ZOOM_STEP = 0.25;

interface ImageViewerProps {
  src: string;
  fileName: string;
}

export function ImageViewer({ src, fileName }: ImageViewerProps) {
  const { t } = useLingui();
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const [panzoomFailed, setPanzoomFailed] = useState(false);

  const attachStage = (stage: HTMLDivElement | null) => {
    if (!stage) return undefined;
    let disposed = false;
    loadPanzoom()
      .then((Panzoom) => {
        if (disposed) return;
        panzoomRef.current = Panzoom(stage, {
          canvas: true,
          cursor: 'grab',
          maxScale: IMAGE_ZOOM_MAX,
          minScale: IMAGE_ZOOM_MIN,
          step: IMAGE_ZOOM_STEP,
          touchAction: 'none',
        });
        setPanzoomFailed(false);
      })
      .catch((err) => {
        console.warn('[ImageViewer] panzoom setup failed:', err);
        if (!disposed) setPanzoomFailed(true);
      });
    const onWheel = (e: WheelEvent) => {
      const pz = panzoomRef.current;
      if (!pz) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        pz.zoomWithWheel(e);
        return;
      }
      const scale = pz.getScale();
      const denom = scale > 0 ? scale : 1;
      pz.pan(-e.deltaX / denom, -e.deltaY / denom, { relative: true });
    };
    const viewport = stage.parentElement;
    viewport?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      disposed = true;
      viewport?.removeEventListener('wheel', onWheel);
      panzoomRef.current?.destroy();
      panzoomRef.current = null;
    };
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="image-viewer">
      <div ref={attachStage} className="flex h-full w-full items-center justify-center p-4">
        <LoadingImage
          src={src}
          alt={fileName}
          draggable={false}
          targetExistence="exists"
          slotClassName="flex h-full w-full items-center justify-center"
          className="max-h-full max-w-full"
        />
      </div>
      <PanzoomControls
        panzoomRef={panzoomRef}
        label={t`Image controls`}
        testId="image-viewer-actions"
        unavailable={panzoomFailed}
      />
    </div>
  );
}
