import { FORMAT_VERSION, type Board, type Item, type Rect, type Zone } from './types';

export function createBoard(): Board {
  return { format: FORMAT_VERSION, rev: 0, updatedAt: new Date().toISOString(), items: [], zones: [] };
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(prefix: 'img' | 'note' | 'zone'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (const b of bytes) s += ID_ALPHABET[b % ID_ALPHABET.length];
  return `${prefix}_${s}`;
}

export function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function containsPoint(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The innermost zone containing the item's center, if any. */
export function zoneOf(board: Board, item: Rect): Zone | undefined {
  const c = center(item);
  let best: Zone | undefined;
  for (const z of board.zones) {
    if (containsPoint(z, c) && (!best || z.w * z.h < best.w * best.h)) best = z;
  }
  return best;
}

export function itemsInZone(board: Board, zone: Zone): Item[] {
  return board.items.filter((it) => zoneOf(board, it)?.id === zone.id);
}

export function topZ(board: Board): number {
  return board.items.reduce((m, it) => Math.max(m, it.z), 0);
}

/** Reading order: top-to-bottom rows, then left-to-right. */
export function byReadingOrder(a: Rect, b: Rect): number {
  const rowA = Math.round(a.y / 120);
  const rowB = Math.round(b.y / 120);
  return rowA - rowB || a.x - b.x;
}
