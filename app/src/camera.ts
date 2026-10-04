import type { Rect } from '@board/format';

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 16;

/** screen = world * zoom + (x, y) */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  toWorld(p: Point): Point {
    return { x: (p.x - this.x) / this.zoom, y: (p.y - this.y) / this.zoom };
  }

  toScreen(p: Point): Point {
    return { x: p.x * this.zoom + this.x, y: p.y * this.zoom + this.y };
  }

  rectToScreen(r: Rect): Rect {
    return { x: r.x * this.zoom + this.x, y: r.y * this.zoom + this.y, w: r.w * this.zoom, h: r.h * this.zoom };
  }

  /** Zooms by `factor`, keeping the world point under `anchor` (screen coords) fixed. */
  zoomAt(anchor: Point, factor: number) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const w = this.toWorld(anchor);
    this.zoom = next;
    this.x = anchor.x - w.x * next;
    this.y = anchor.y - w.y * next;
  }

  /** Frames `r` inside a viewport of `vw`×`vh`, leaving `pad` px around it. */
  fit(r: Rect, vw: number, vh: number, pad = 80, maxZoom = 1) {
    const zx = (vw - pad * 2) / Math.max(1, r.w);
    const zy = (vh - pad * 2) / Math.max(1, r.h);
    this.zoom = Math.min(maxZoom, Math.max(MIN_ZOOM, Math.min(zx, zy)));
    this.x = vw / 2 - (r.x + r.w / 2) * this.zoom;
    this.y = vh / 2 - (r.y + r.h / 2) * this.zoom;
  }
}
