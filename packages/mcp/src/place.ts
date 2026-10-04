import { boundsOf, newId, overlaps, type Board, type Rect, type Zone } from '@board/format';

const GAP = 32;
export const AGENT_ZONE_NAME = 'From agents';

/** Scans right (up to `maxRight`) then down from `start` until the rect doesn't overlap any item. */
export function freeSpot(
  board: Board,
  size: { w: number; h: number },
  start: { x: number; y: number },
  maxRight = start.x + 12 * (size.w + GAP),
): Rect {
  const cols = Math.max(1, Math.floor((maxRight - start.x + GAP) / (size.w + GAP)));
  for (let row = 0; row < 200; row++) {
    for (let col = 0; col < cols; col++) {
      const r = { x: start.x + col * (size.w + GAP), y: start.y + row * (size.h + GAP), ...size };
      if (!board.items.some((o) => overlaps(o, r, GAP / 2))) return r;
    }
  }
  return { x: start.x, y: start.y, ...size };
}

/** Grows a zone so it fully contains `r`. */
export function growZone(zone: Zone, r: Rect, pad = GAP): void {
  const right = Math.max(zone.x + zone.w, r.x + r.w + pad);
  const bottom = Math.max(zone.y + zone.h, r.y + r.h + pad);
  zone.x = Math.min(zone.x, r.x - pad);
  zone.y = Math.min(zone.y, r.y - pad);
  zone.w = right - zone.x;
  zone.h = bottom - zone.y;
}

/** Finds the zone agents drop things into by default, creating it to the right of everything. */
export function agentZone(board: Board): Zone {
  const existing = board.zones.find((z) => z.name === AGENT_ZONE_NAME);
  if (existing) return existing;
  const b = boundsOf([...board.items, ...board.zones]) ?? { x: 0, y: 0, w: 0, h: 0 };
  const zone: Zone = {
    id: newId('zone'),
    name: AGENT_ZONE_NAME,
    x: b.w ? b.x + b.w + GAP * 3 : 0,
    y: b.y,
    w: 720,
    h: 480,
    color: 'mint',
    note: 'Things AI tools added: screenshots of their work, generated options.',
  };
  board.zones.push(zone);
  return zone;
}

/** Resolves a zone by id or (case-insensitive) name. */
export function findZone(board: Board, ref: string): Zone | undefined {
  const lower = ref.toLowerCase();
  return board.zones.find((z) => z.id === ref) ?? board.zones.find((z) => z.name.toLowerCase() === lower);
}

/**
 * Picks a rect for a new item. `near` puts it to the right of that item at the
 * same height (for side-by-side comparison); `zone` puts it inside that zone;
 * otherwise it goes into the "From agents" zone.
 */
export function placeNew(
  board: Board,
  natural: { w: number; h: number },
  opts: { near?: string; zone?: string },
): Rect {
  const nearItem = opts.near ? board.items.find((i) => i.id === opts.near) : undefined;
  if (opts.near && !nearItem) throw new Error(`No item with id ${opts.near}`);

  if (nearItem) {
    const h = nearItem.h;
    const w = Math.max(1, Math.round((natural.w / natural.h) * h));
    // Prefer touching the reference (right, below, left, above) so it reads as a side-by-side.
    const candidates: Rect[] = [
      { x: nearItem.x + nearItem.w + GAP, y: nearItem.y, w, h },
      { x: nearItem.x, y: nearItem.y + nearItem.h + GAP, w, h },
      { x: nearItem.x - w - GAP, y: nearItem.y, w, h },
      { x: nearItem.x, y: nearItem.y - h - GAP, w, h },
    ];
    const free = candidates.find((c) => !board.items.some((o) => overlaps(o, c, GAP / 2)));
    return free ?? freeSpot(board, { w, h }, { x: nearItem.x, y: nearItem.y + nearItem.h + GAP }, nearItem.x + nearItem.w);
  }

  const long = Math.max(natural.w, natural.h);
  const k = long > 640 ? 640 / long : 1;
  const size = { w: Math.round(natural.w * k), h: Math.round(natural.h * k) };

  let zone: Zone | undefined;
  if (opts.zone) {
    zone = findZone(board, opts.zone);
    if (!zone) throw new Error(`No zone named or with id "${opts.zone}"`);
  } else {
    zone = agentZone(board);
  }
  const r = freeSpot(board, size, { x: zone.x + GAP, y: zone.y + GAP }, zone.x + Math.max(zone.w, size.w + GAP * 2) - GAP);
  growZone(zone, r);
  return r;
}
