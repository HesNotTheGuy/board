/** On-disk layout, relative to a project root. */
export const BOARD_DIR = '.board';
export const BOARD_FILE = 'board.json';
export const ASSETS_DIR = 'assets';
export const LOCK_FILE = 'board.lock';

/**
 * Boards that don't belong to a project yet live in the app's data folder:
 * <OS data dir>/<APP_ID>/<LIBRARY_DIR>/<slug>/.board/. Keep APP_ID equal to the
 * Tauri `identifier` and the constants in app/src-tauri/src/lib.rs.
 */
export const APP_ID = 'com.hesnottheguy.board';
export const LIBRARY_DIR = 'boards';

export const FORMAT_VERSION = 1;

/** Formats accepted on import (sharp/image-rs names). Everything is re-encoded to png or jpg. */
export const IMAGE_EXTENSIONS = ['png', 'jpeg', 'gif', 'webp', 'bmp'] as const;

export const ZONE_COLORS = ['amber', 'mint', 'sky', 'rose', 'stone'] as const;
export type ZoneColor = (typeof ZONE_COLORS)[number];

/** Who put an item on the board. Agent-added items render differently so you can compare. */
export type Author = 'user' | 'agent';

interface ItemBase {
  id: string;
  /** World-space rect. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order; higher draws on top. */
  z: number;
  addedBy: Author;
  /** For agent items: the tool that added it, as its MCP client reports itself (e.g. "Cursor"). */
  agent?: string;
  createdAt: string;
  /** "Focus": agents weigh pinned items first. */
  pinned?: boolean;
}

export interface ImageItem extends ItemBase {
  kind: 'image';
  /** Path relative to the board dir, e.g. `assets/3f2a9c01d4e5b6a7.png`. */
  asset: string;
  srcW: number;
  srcH: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Visible part of the source image, as fractions of its size (applied before flips). Non-destructive. */
  crop?: Crop;
  /** The user's instruction about this reference ("this lighting, but warmer"). */
  note?: string;
  /** Short description an agent caches after looking, so later sessions (and text-only models) can skip the pixels. */
  caption?: string;
  tags?: string[];
  source?: string;
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoteItem extends ItemBase {
  kind: 'note';
  text: string;
  /** Text and padding scale. New notes match the zoom they were made at, so they look normal on screen. */
  scale?: number;
}

export type Item = ImageItem | NoteItem;

/** A labelled region. Items whose center falls inside belong to it. */
export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: ZoneColor;
  /** What the zone means ("Avoid these", "Palette"). */
  note?: string;
}

export interface Board {
  format: typeof FORMAT_VERSION;
  /** Display name. Falls back to the folder name. */
  title?: string;
  /** Bumped on every write; used for change detection and optimistic concurrency. */
  rev: number;
  updatedAt: string;
  items: Item[];
  zones: Zone[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
