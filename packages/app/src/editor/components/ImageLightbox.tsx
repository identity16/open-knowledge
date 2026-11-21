import { toDesktopAssetHref } from '@inkeep/open-knowledge-core/utils/asset-href';
import { useLingui } from '@lingui/react/macro';
import { type ReactNode, useState } from 'react';
import { ImageViewer } from '@/components/ImageViewer';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface ZoomableImageProps {
  src: string | undefined;
  alt: string;
  children: ReactNode;
}

export function ZoomableImage({ src, alt, children }: ZoomableImageProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  if (src === undefined) return children;

  return (
    <>
      <button
        type="button"
        aria-label={t`Expand image`}
        data-zoomable-image=""
        className="contents cursor-zoom-in"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? <ImageLightbox src={src} alt={alt} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

function ImageLightbox({
  src,
  alt,
  open,
  onOpenChange,
}: {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const fileName = alt || src.slice(src.lastIndexOf('/') + 1);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="image-lightbox"
        className="z-[60] flex h-[calc(100dvh-5rem)] w-[calc(100dvw-5rem)] max-w-none flex-col gap-0 p-2 pt-10 duration-200 sm:max-w-none"
        style={{ '--tw-enter-scale': '0.92', '--tw-exit-scale': '0.92' } as React.CSSProperties}
      >
        <DialogTitle className="sr-only">{alt || t`Image`}</DialogTitle>
        <ImageViewer src={toDesktopAssetHref(src)} fileName={fileName} />
      </DialogContent>
    </Dialog>
  );
}
