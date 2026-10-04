import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import { boundsOf, itemsInZone, type Board, type ImageItem, type Item, type Zone, type ZoneColor } from '@board/format';
import type { BoardStore } from './store';

export interface RenderedImage {
  data: string;
  mimeType: string;
  width: number;
  height: number;
}

const ZONE_HEX: Record<ZoneColor, string> = {
  amber: '#F5A524',
  mint: '#5EE6B0',
  sky: '#6CB6FF',
  rose: '#FF6B7A',
  stone: '#A8A29A',
};
const AGENT_HEX = '#5EE6B0';
const FOCUS_HEX = '#F5A524';

async function encode(img: Sharp, hasAlpha: boolean): Promise<RenderedImage> {
  const out = hasAlpha ? img.png() : img.jpeg({ quality: 85, mozjpeg: true });
  const { data, info } = await out.toBuffer({ resolveWithObject: true });
  return { data: data.toString('base64'), mimeType: hasAlpha ? 'image/png' : 'image/jpeg', width: info.width, height: info.height };
}

/** One reference, downscaled so it costs a predictable number of tokens. */
/** Applies the item's crop (fractions of the source) before anything else, as the app does. */
async function cropped(base: Sharp, item: ImageItem): Promise<Sharp> {
  if (!item.crop) return base;
  const { width = item.srcW, height = item.srcH } = await base.metadata();
  const c = item.crop;
  const left = Math.min(width - 1, Math.round(c.x * width));
  const top = Math.min(height - 1, Math.round(c.y * height));
  return base.extract({
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(c.w * width))),
    height: Math.max(1, Math.min(height - top, Math.round(c.h * height))),
  });
}

export async function renderItem(store: BoardStore, item: ImageItem, maxEdge: number): Promise<RenderedImage> {
  const base = await store.openAsset(item.asset);
  const meta = await base.metadata();
  let img = (await cropped(base, item)).resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
  if (item.flipX) img = img.flop();
  if (item.flipY) img = img.flip();
  return encode(img, !!meta.hasAlpha);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1]!.replace(/.{0,1}$/, '…');
  }
  return lines;
}

const TILE_CACHE_MAX = 600;
/** Resized tiles by (board, asset, size). Assets are content-addressed, so entries never go stale. */
const tileCache = new Map<string, Buffer | null>();

async function tile(store: BoardStore, it: ImageItem, w: number, h: number): Promise<Buffer | null> {
  const key = `${store.root}|${it.asset}|${w}x${h}|${it.flipX ? 1 : 0}${it.flipY ? 1 : 0}|${it.crop ? JSON.stringify(it.crop) : ''}`;
  if (tileCache.has(key)) {
    const hit = tileCache.get(key)!;
    tileCache.delete(key); // refresh recency
    tileCache.set(key, hit);
    return hit;
  }
  const base = await store.openAsset(it.asset).catch(() => null);
  let buf: Buffer | null = null;
  if (base) {
    let img = (await cropped(base, it)).resize(w, h, { fit: 'fill' });
    if (it.flipX) img = img.flop();
    if (it.flipY) img = img.flip();
    buf = await img.png({ compressionLevel: 1 }).toBuffer();
  }
  tileCache.set(key, buf);
  if (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value!);
  return buf;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The whole board (or one zone) composited into a single image, with item ids
 * stamped on so the agent can ask for specific references afterwards.
 */
export async function renderGlance(
  store: BoardStore,
  board: Board,
  opts: { zone?: Zone; maxEdge: number; labels: boolean; /** Also cap total pixels, which is what image tokens scale with. */ maxPixels?: number },
): Promise<RenderedImage | null> {
  const items: Item[] = (opts.zone ? itemsInZone(board, opts.zone) : board.items).slice().sort((a, b) => a.z - b.z);
  const zones = opts.zone ? [opts.zone] : board.zones;
  const bounds = boundsOf([...items, ...zones]);
  if (!bounds) return null;

  const pad = 24;
  const minX = bounds.x - pad;
  const minY = bounds.y - pad - 28; // room for zone labels above zones
  const bw = bounds.w + pad * 2;
  const bh = bounds.h + pad * 2 + 28;
  const scale = Math.min(1, opts.maxEdge / Math.max(bw, bh), opts.maxPixels ? Math.sqrt(opts.maxPixels / (bw * bh)) : 1);
  const W = Math.max(1, Math.round(bw * scale));
  const H = Math.max(1, Math.round(bh * scale));
  const sx = (x: number) => Math.round((x - minX) * scale);
  const sy = (y: number) => Math.round((y - minY) * scale);
  const sl = (l: number) => Math.max(1, Math.round(l * scale));

  const under: string[] = [];
  const over: string[] = [];
  const composites: OverlayOptions[] = [];

  for (const z of zones) {
    const c = ZONE_HEX[z.color];
    under.push(`<rect x="${sx(z.x)}" y="${sy(z.y)}" width="${sl(z.w)}" height="${sl(z.h)}" fill="${c}" fill-opacity="0.06"/>`);
    over.push(
      `<rect x="${sx(z.x)}" y="${sy(z.y)}" width="${sl(z.w)}" height="${sl(z.h)}" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
      `<text x="${sx(z.x)}" y="${sy(z.y) - 6}" fill="${c}" font-family="sans-serif" font-size="14" font-weight="600">${esc(z.name)}</text>`,
    );
  }

  // Geometry first, then all image tiles in parallel (cached), then compose in z order.
  const geo = new Map<string, { left: number; top: number; w: number; h: number }>();
  for (const it of items) {
    const left = sx(it.x);
    const top = sy(it.y);
    geo.set(it.id, { left, top, w: Math.min(sl(it.w), W - left), h: Math.min(sl(it.h), H - top) });
  }
  const images = items.filter((it): it is ImageItem => it.kind === 'image' && geo.get(it.id)!.w >= 1 && geo.get(it.id)!.h >= 1);
  const tiles = new Map(await mapLimit(images, 8, async (it) => [it.id, await tile(store, it, geo.get(it.id)!.w, geo.get(it.id)!.h)] as const));

  for (const it of items) {
    const { left, top, w, h } = geo.get(it.id)!;
    if (w < 1 || h < 1) continue;

    if (it.kind === 'image') {
      const buf = tiles.get(it.id);
      if (buf) {
        composites.push({ input: buf, left, top });
      } else {
        over.push(`<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="#333"/><text x="${left + 6}" y="${top + 18}" fill="#999" font-family="sans-serif" font-size="12">missing</text>`);
      }
      if (it.addedBy === 'agent') {
        over.push(`<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="none" stroke="${AGENT_HEX}" stroke-width="2"/>`);
      }
    } else {
      const fs = Math.max(10, Math.min(18, Math.round(18 * scale * 1.4 * (it.scale ?? 1))));
      // Start below the id stamp so it never covers the first line.
      const top0 = top + (opts.labels ? 18 : 6);
      const lines = wrap(it.text || '(empty note)', Math.max(6, Math.floor((w - 12) / (fs * 0.62))), Math.max(1, Math.floor((h - (top0 - top) - 4) / (fs * 1.25))));
      over.push(
        `<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="#26231f" stroke="${it.addedBy === 'agent' ? AGENT_HEX : '#4a463f'}"/>`,
        ...lines.map(
          (l, i) => `<text x="${left + 6}" y="${top0 + fs * (i + 1)}" fill="#E8E2D6" font-family="sans-serif" font-size="${fs}">${esc(l)}</text>`,
        ),
      );
    }

    if (opts.labels) {
      const label = `${it.pinned ? '★ ' : ''}${it.id}`;
      const lw = Math.round(label.length * 6.6 + 8);
      over.push(
        `<rect x="${left}" y="${top}" width="${lw}" height="16" fill="#000" fill-opacity="0.75"/>`,
        `<text x="${left + 4}" y="${top + 12}" fill="${it.pinned ? FOCUS_HEX : '#fff'}" font-family="monospace" font-size="11">${esc(label)}</text>`,
      );
    }
  }

  const svg = (parts: string[]) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`);
  const img = sharp({ create: { width: W, height: H, channels: 3, background: '#161616' } }).composite([
    { input: svg(under), left: 0, top: 0 },
    ...composites,
    { input: svg(over), left: 0, top: 0 },
  ]);
  return encode(img, false);
}
