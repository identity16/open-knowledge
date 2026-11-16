export interface ImageCopyTarget {
  isDestroyed(): boolean;
  getZoomFactor(): number;
  copyImageAt(x: number, y: number): void;
}

export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

export function copyImageAtClientPoint(target: ImageCopyTarget, point: ClientPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || target.isDestroyed()) return;
  const zoom = target.getZoomFactor();
  target.copyImageAt(Math.round(point.x * zoom), Math.round(point.y * zoom));
}
