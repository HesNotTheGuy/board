import { FORMAT_VERSION, ZONE_COLORS, type Board, type Crop, type ImageItem, type Item, type NoteItem, type Zone, type ZoneColor } from './types';

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const optStr = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
const optBool = (v: unknown) => (v === true ? true : undefined);

/** Tidies a tool name for display: printable characters only, bounded length. */
export function agentName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[^\p{L}\p{N} ._()+-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return s || undefined;
}

/** A crop as fractions of the source; dropped when it's missing, broken or the whole image. */
function parseCrop(v: unknown): Crop | undefined {
  if (!isObj(v)) return undefined;
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const x = clamp(num(v.x), 0, 0.99);
  const y = clamp(num(v.y), 0, 0.99);
  const w = clamp(num(v.w, 1), 0.01, 1 - x);
  const h = clamp(num(v.h, 1), 0.01, 1 - y);
  if (x < 0.0005 && y < 0.0005 && w > 0.9995 && h > 0.9995) return undefined;
  return { x, y, w, h };
}

/** Drops `undefined` keys so serialized boards stay tidy and diffable. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

function parseItem(raw: unknown): Item | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const base = {
    id: raw.id,
    x: num(raw.x),
    y: num(raw.y),
    w: Math.max(1, num(raw.w, 100)),
    h: Math.max(1, num(raw.h, 100)),
    z: num(raw.z),
    addedBy: raw.addedBy === 'agent' ? ('agent' as const) : ('user' as const),
    agent: raw.addedBy === 'agent' ? agentName(raw.agent) : undefined,
    createdAt: str(raw.createdAt, new Date(0).toISOString()),
    pinned: optBool(raw.pinned),
  };
  if (raw.kind === 'image') {
    if (typeof raw.asset !== 'string' || !raw.asset) return null;
    const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string' && t.length > 0) : [];
    const item: ImageItem = {
      ...base,
      kind: 'image',
      asset: raw.asset,
      srcW: Math.max(1, num(raw.srcW, base.w)),
      srcH: Math.max(1, num(raw.srcH, base.h)),
      flipX: optBool(raw.flipX),
      flipY: optBool(raw.flipY),
      crop: parseCrop(raw.crop),
      note: optStr(raw.note),
      caption: optStr(raw.caption),
      tags: tags.length ? tags : undefined,
      source: optStr(raw.source),
    };
    return compact(item);
  }
  if (raw.kind === 'note') {
    const scale = Math.min(10, Math.max(0.1, num(raw.scale, 1)));
    const item: NoteItem = { ...base, kind: 'note', text: str(raw.text), scale: scale === 1 ? undefined : scale };
    return compact(item);
  }
  return null;
}

function parseZone(raw: unknown): Zone | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const color = (ZONE_COLORS as readonly string[]).includes(raw.color as string) ? (raw.color as ZoneColor) : 'stone';
  return compact({
    id: raw.id,
    name: str(raw.name, 'Zone'),
    x: num(raw.x),
    y: num(raw.y),
    w: Math.max(1, num(raw.w, 400)),
    h: Math.max(1, num(raw.h, 300)),
    color,
    note: optStr(raw.note),
  });
}

/** Leniently normalizes anything board-shaped. Unknown or broken entries are dropped, not fatal. */
export function normalizeBoard(raw: unknown): Board {
  const o = isObj(raw) ? raw : {};
  const seen = new Set<string>();
  const unique = <T extends { id: string }>(x: T | null): x is T => {
    if (!x || seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  };
  return compact({
    format: FORMAT_VERSION,
    title: optStr(typeof o.title === 'string' ? o.title.trim().slice(0, 80) : undefined),
    rev: Math.max(0, Math.floor(num(o.rev))),
    updatedAt: str(o.updatedAt, new Date(0).toISOString()),
    items: (Array.isArray(o.items) ? o.items : []).map(parseItem).filter(unique),
    zones: (Array.isArray(o.zones) ? o.zones : []).map(parseZone).filter(unique),
  });
}

/** Folder-safe name for a board title: "Moody Neon Alley!" → "moody-neon-alley". */
export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'board';
}

/** Parses board.json text. Throws on invalid JSON so callers never overwrite a file they couldn't read. */
export function parseBoard(text: string): Board {
  return normalizeBoard(JSON.parse(text));
}

export function serializeBoard(board: Board): string {
  return JSON.stringify(board, null, 2) + '\n';
}
