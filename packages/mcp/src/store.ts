import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp, { type Sharp, type SharpOptions } from 'sharp';
import {
  APP_ID,
  ASSETS_DIR,
  BOARD_DIR,
  BOARD_FILE,
  LIBRARY_DIR,
  LOCK_FILE,
  createBoard,
  parseBoard,
  serializeBoard,
  slugify,
  sniffImage,
  type Board,
} from '@board/format';

export const MAX_INPUT_BYTES = 40 * 1024 * 1024;
export const MAX_PIXELS = 100_000_000;
const MAX_BOARD_BYTES = 20 * 1024 * 1024;
/** Decoder guard rails for any image sharp opens: pixel cap (decompression bombs), strict errors, first frame only. */
export const SHARP_INPUT: SharpOptions = { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false };

const LOCK_TIMEOUT_MS = 3000;
const LOCK_STALE_MS = 10_000;
const RETRYABLE = new Set(['EEXIST', 'EPERM', 'EBUSY', 'EACCES']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (e: unknown) => (e as NodeJS.ErrnoException).code ?? '';

/**
 * Finds the project root: `--root <dir>`, then `BOARD_ROOT`, then the nearest
 * ancestor of cwd that has a board, then cwd itself.
 */
export function resolveRoot(argv: readonly string[], env: NodeJS.ProcessEnv, cwd: string): string {
  const flag = argv.indexOf('--root');
  if (flag >= 0 && argv[flag + 1]) return path.resolve(argv[flag + 1]!);
  if (env.BOARD_ROOT) return path.resolve(env.BOARD_ROOT);
  let dir = path.resolve(cwd);
  for (;;) {
    if (existsSync(path.join(dir, BOARD_DIR, BOARD_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

/**
 * Where standalone boards live; the same folder the desktop app uses
 * (Tauri's app data dir for APP_ID). `BOARD_LIBRARY` overrides it.
 */
export function libraryDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BOARD_LIBRARY) return path.resolve(env.BOARD_LIBRARY);
  const base =
    process.platform === 'win32'
      ? (env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : (env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'));
  return path.join(base, APP_ID, LIBRARY_DIR);
}

export type McpAccess = 'off' | 'read' | 'write';

/** The app's settings file (same folder family as the library). `BOARD_SETTINGS` overrides it. */
export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BOARD_SETTINGS) return path.resolve(env.BOARD_SETTINGS);
  return path.join(path.dirname(libraryDir({ ...env, BOARD_LIBRARY: '' })), 'settings.json');
}

let cachedAccess: { mtimeMs: number; value: McpAccess } | null = null;

/**
 * What the user allows MCP clients to do, from the app's settings. Fails closed:
 * no file, an unreadable file or an unknown value all mean 'off'.
 */
export async function readMcpAccess(file = settingsPath()): Promise<McpAccess> {
  try {
    const { mtimeMs } = await stat(file);
    if (cachedAccess?.mtimeMs === mtimeMs) return cachedAccess.value;
    const raw = JSON.parse(await readFile(file, 'utf8')) as { mcpAccess?: unknown };
    const value: McpAccess = raw.mcpAccess === 'read' || raw.mcpAccess === 'write' ? raw.mcpAccess : 'off';
    cachedAccess = { mtimeMs, value };
    return value;
  } catch {
    return 'off';
  }
}

export interface LibraryBoard {
  slug: string;
  root: string;
  title: string;
  items: number;
  updatedAt: string;
}

/** Standalone boards, most recently updated first. Unreadable ones are skipped. */
export async function listLibrary(dir = libraryDir()): Promise<LibraryBoard[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const boards = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e): Promise<LibraryBoard | null> => {
        const store = new BoardStore(path.join(dir, e.name));
        const board = await store.read().catch(() => null);
        if (!board && !existsSync(store.dir)) return null;
        return { slug: e.name, root: store.root, title: board?.title ?? e.name, items: board?.items.length ?? 0, updatedAt: board?.updatedAt ?? '' };
      }),
  );
  return boards.filter((b): b is LibraryBoard => b !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Creates a standalone board (same layout the app uses) and returns its store. */
export async function createLibraryBoard(title: string, dir = libraryDir()): Promise<BoardStore> {
  const slug = slugify(title);
  await mkdir(dir, { recursive: true });
  for (let n = 1; n < 1000; n++) {
    const root = path.join(dir, n === 1 ? slug : `${slug}-${n}`);
    try {
      await mkdir(root); // fails if taken
    } catch (e) {
      if (code(e) === 'EEXIST') continue;
      throw e;
    }
    const store = new BoardStore(root);
    await store.mutate((b) => void (b.title = title.trim().slice(0, 80) || 'Untitled board'));
    return store;
  }
  throw new Error('Too many boards with that name');
}

export class BoardStore {
  readonly dir: string;
  readonly file: string;

  /**
   * @param importRoots folders `add` may read images from, besides the OS temp
   * folder; defaults to the board's own root.
   */
  constructor(
    readonly root: string,
    private importRoots: string[] = [root],
  ) {
    this.dir = path.join(root, BOARD_DIR);
    this.file = path.join(this.dir, BOARD_FILE);
  }

  get name(): string {
    return path.basename(this.root);
  }

  /** Returns null when the project has no board yet. */
  async read(): Promise<Board | null> {
    let text: string;
    try {
      if ((await stat(this.file)).size > MAX_BOARD_BYTES) throw new Error('board.json is unreasonably large; refusing to read it.');
      text = await readFile(this.file, 'utf8');
    } catch (e) {
      if (code(e) === 'ENOENT') return null;
      throw e;
    }
    return parseBoard(text);
  }

  /** Read-modify-write under the cross-process lock the desktop app also uses. */
  async mutate<T>(fn: (board: Board) => T | Promise<T>): Promise<T> {
    await mkdir(path.join(this.dir, ASSETS_DIR), { recursive: true });
    const release = await this.lock();
    try {
      const board = (await this.read()) ?? createBoard();
      const result = await fn(board);
      board.rev += 1;
      board.updatedAt = new Date().toISOString();
      await this.writeAtomic(this.file, serializeBoard(board));
      return result;
    } finally {
      await release();
    }
  }

  /**
   * Opens a board asset for rendering. Assets may come from someone else's
   * board (a cloned repo), so they get the same magic-byte check and decoder
   * limits as imports.
   */
  async openAsset(rel: string): Promise<Sharp> {
    const file = this.assetPath(rel);
    if ((await stat(file)).size > MAX_INPUT_BYTES) throw new Error('Asset is over 40 MB');
    const bytes = await readFile(file);
    if (!sniffImage(bytes) || sniffImage(bytes) === 'bmp') throw new Error('Asset is not a supported image');
    return sharp(bytes, SHARP_INPUT).rotate();
  }

  /** Absolute path of an asset, refusing anything that escapes the assets folder. */
  assetPath(rel: string): string {
    const normalized = path.normalize(rel);
    if (path.isAbsolute(normalized) || normalized.split(path.sep)[0] !== ASSETS_DIR || normalized.includes('..')) {
      throw new Error(`Invalid asset path: ${rel}`);
    }
    return path.join(this.dir, normalized);
  }

  /**
   * Only files inside the project or the OS temp dir (where screenshot tools
   * write) may be added. Stops a prompt-injected request from copying, say, a
   * screenshot of a password manager from elsewhere on disk into a board that
   * might get committed.
   */
  async checkImportPath(srcPath: string): Promise<string> {
    const real = await realpath(srcPath).catch(() => {
      throw new Error(`File not found: ${path.basename(srcPath)}`);
    });
    const roots = await Promise.all([...this.importRoots, os.tmpdir()].map((r) => realpath(r).catch(() => path.resolve(r))));
    const inside = roots.some((r) => {
      const rel = path.relative(r, real);
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
    if (!inside) throw new Error('Only images inside the project folder or the system temp folder can be added to the board.');
    if (real.split(path.sep).includes(BOARD_DIR)) throw new Error('That file is already part of the board.');
    return real;
  }

  /**
   * Copies an image into the board's content-addressed asset store, sanitized:
   * decoded with pixel limits, re-encoded, metadata (EXIF GPS etc.) stripped.
   */
  async importImage(srcPath: string): Promise<{ asset: string; width: number; height: number }> {
    const real = await this.checkImportPath(srcPath);
    const size = (await stat(real)).size;
    if (size > MAX_INPUT_BYTES) throw new Error('Image is over 40 MB');
    const bytes = await readFile(real);
    // Magic bytes first: SVG, TIFF and friends never reach sharp's decoders.
    const sniffed = sniffImage(bytes);
    if (!sniffed || sniffed === 'bmp') {
      throw new Error(`Not a supported image (png, jpg, gif, webp): ${path.basename(srcPath)}`);
    }
    const meta = await sharp(bytes, SHARP_INPUT).metadata();
    if (meta.format !== sniffed || !meta.width || !meta.height) {
      throw new Error(`Not a supported image (png, jpg, gif, webp): ${path.basename(srcPath)}`);
    }
    if (meta.width * meta.height > MAX_PIXELS) throw new Error(`Image is too large (${meta.width}×${meta.height})`);
    // .rotate() bakes in EXIF orientation; sharp drops all metadata on output by default.
    const img = sharp(bytes, SHARP_INPUT).rotate();
    const isJpeg = sniffed === 'jpeg';
    const { data, info } = await (isJpeg ? img.jpeg({ quality: 92 }) : img.png()).toBuffer({ resolveWithObject: true });
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
    const asset = `${ASSETS_DIR}/${hash}.${isJpeg ? 'jpg' : 'png'}`;
    const dest = path.join(this.dir, asset);
    await mkdir(path.dirname(dest), { recursive: true });
    if (!existsSync(dest)) await this.writeAtomic(dest, data);
    return { asset, width: info.width, height: info.height };
  }

  private async lock(): Promise<() => Promise<void>> {
    const lockPath = path.join(this.dir, LOCK_FILE);
    const started = Date.now();
    for (;;) {
      try {
        const handle = await open(lockPath, 'wx');
        await handle.writeFile(String(process.pid));
        await handle.close();
        return () => rm(lockPath, { force: true });
      } catch (e) {
        if (!RETRYABLE.has(code(e))) throw e;
        const age = await stat(lockPath).then((s) => Date.now() - s.mtimeMs, () => 0);
        if (age > LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
        if (Date.now() - started > LOCK_TIMEOUT_MS) throw new Error('Board is locked by another process; try again.');
        await sleep(25);
      }
    }
  }

  private async writeAtomic(dest: string, data: string | Uint8Array): Promise<void> {
    const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, data);
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, dest);
        return;
      } catch (e) {
        // Windows refuses to replace a file another process has open for a moment.
        if (attempt >= 20 || !RETRYABLE.has(code(e))) {
          await rm(tmp, { force: true });
          throw e;
        }
        await sleep(20);
      }
    }
  }
}
