import { createBoard, newId, serializeBoard, type ImageItem, type NoteItem, type Zone } from '@board/format';

export type SaveResult = { ok: true } | { ok: false; disk: string };

/** What MCP clients (AI tools) may do with boards. Off unless the user turns it on. */
export type McpAccess = 'off' | 'read' | 'write';

/** Our own title bar's window buttons (desktop only). */
export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onResized(cb: () => void): Promise<void>;
  /** Runs before the window closes (awaited), e.g. to finish saving. */
  onCloseRequested(cb: () => Promise<void>): Promise<void>;
}

/** A board in the app's library (not inside a project folder). */
export interface LibraryEntry {
  root: string;
  slug: string;
  title: string | null;
  items: number;
  /** Seconds since the epoch. */
  modified: number;
}

/** A sanitized image stored in the board's assets. */
export interface Imported {
  asset: string;
  width: number;
  height: number;
  /** Where it was downloaded from (query string stripped), for web images. */
  source?: string | null;
}

/** Everything the UI needs from the host. The Tauri backend touches disk; the memory one lets the UI run in a plain browser. */
export interface Backend {
  readonly kind: 'tauri' | 'memory';
  /** Folder given on the command line, if any. */
  launchRoot(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  open(root: string): Promise<{ text: string | null; name: string; library: boolean }>;
  /** Standalone boards, most recent first. */
  listLibrary(): Promise<LibraryEntry[]>;
  /** Makes a new library board folder; returns its root. */
  createBoard(slug: string): Promise<string>;
  /** Moves the open library board into a project folder; returns the new root. */
  moveBoard(target: string): Promise<string>;
  /** Sends a library board to the Recycle Bin / Trash, closing it first if it's open. Resolves to whether it was the open board. */
  deleteBoard(root: string): Promise<boolean>;
  read(): Promise<string | null>;
  save(text: string, baseRev: number): Promise<SaveResult>;
  /** Untrusted image bytes in; a sanitized, re-encoded copy is stored. */
  importAsset(bytes: Uint8Array): Promise<Imported>;
  /** Downloads an image from a public web URL (guarded against local/private addresses), then sanitizes it. */
  fetchImage(url: string): Promise<Imported>;
  assetUrl(rel: string): string;
  onExternalChange(cb: () => void): Promise<void>;
  setAlwaysOnTop(on: boolean): Promise<void>;
  setTitle(title: string): Promise<void>;
  getMcpAccess(): Promise<McpAccess>;
  setMcpAccess(mode: McpAccess): Promise<void>;
  readonly window?: WindowControls;
}

export const isTauri = () => '__TAURI_INTERNALS__' in window;

export async function createBackend(): Promise<Backend> {
  return isTauri() ? createTauriBackend() : new MemoryBackend();
}

async function createTauriBackend(): Promise<Backend> {
  const [{ invoke, convertFileSrc }, { listen }, { getCurrentWindow }, { open }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/window'),
    import('@tauri-apps/plugin-dialog'),
  ]);
  return {
    kind: 'tauri',
    launchRoot: () => invoke<string | null>('launch_root'),
    async pickFolder() {
      const picked = await open({ directory: true, multiple: false, title: 'Open project folder' });
      return typeof picked === 'string' ? picked : null;
    },
    async open(root) {
      const res = await invoke<{ json: string | null; name: string; library: boolean }>('open_board', { root });
      return { text: res.json, name: res.name, library: res.library };
    },
    listLibrary: () => invoke<LibraryEntry[]>('list_library'),
    createBoard: (slug) => invoke<string>('create_board', { slug }),
    moveBoard: (target) => invoke<string>('move_board', { target }),
    deleteBoard: (root) => invoke<boolean>('delete_board', { root }),
    setTitle: (title) => getCurrentWindow().setTitle(`${title} · Board`),
    getMcpAccess: async () => (await invoke<{ mcpAccess: McpAccess }>('get_settings')).mcpAccess,
    setMcpAccess: (mode) => invoke<void>('set_mcp_access', { mode }),
    window: {
      minimize: () => getCurrentWindow().minimize(),
      toggleMaximize: () => getCurrentWindow().toggleMaximize(),
      close: () => getCurrentWindow().close(),
      isMaximized: () => getCurrentWindow().isMaximized(),
      onResized: async (cb) => void (await getCurrentWindow().onResized(() => cb())),
      onCloseRequested: async (cb) => void (await getCurrentWindow().onCloseRequested(() => cb())),
    },
    read: () => invoke<string | null>('read_board'),
    async save(text, baseRev) {
      const res = await invoke<{ ok: boolean; disk: string | null }>('save_board', { json: text, baseRev });
      return res.ok ? { ok: true } : { ok: false, disk: res.disk ?? '' };
    },
    importAsset: (bytes) => invoke<Imported>('import_asset', bytes),
    fetchImage: (url) => invoke<Imported>('fetch_image', { url }),
    assetUrl: (rel) => convertFileSrc(rel, 'board'),
    async onExternalChange(cb) {
      await listen('board:changed', () => cb());
    },
    setAlwaysOnTop: (on) => getCurrentWindow().setAlwaysOnTop(on),
  };
}

/**
 * In-browser stand-in for UI development (`pnpm dev`). Nothing is persisted.
 * `?demo` seeds a sample board; `window.__boardDemo.agentAdds()` simulates an AI tool adding an image.
 */
class MemoryBackend implements Backend {
  readonly kind = 'memory' as const;
  private boards = new Map<string, string | null>();
  private current = '';
  private urls = new Map<string, string>();
  private listeners: (() => void)[] = [];
  private counter = 0;

  async launchRoot() {
    return null;
  }

  async pickFolder() {
    return 'demo-project';
  }

  private get text(): string | null {
    return this.boards.get(this.current) ?? null;
  }

  private set text(t: string | null) {
    this.boards.set(this.current, t);
  }

  async open(root: string) {
    this.current = root;
    if (root === 'demo-project' && !this.boards.has(root)) this.text = serializeBoard(await this.seed());
    (window as unknown as { __boardDemo: unknown }).__boardDemo = { agentAdds: () => this.simulateAgent() };
    return { text: this.text, name: root.replace(/^library\//, ''), library: root.startsWith('library/') };
  }

  async listLibrary(): Promise<LibraryEntry[]> {
    return [...this.boards.entries()]
      .filter(([root]) => root.startsWith('library/'))
      .map(([root, text]) => {
        const b = text ? (JSON.parse(text) as { title?: string; items: unknown[] }) : null;
        return { root, slug: root.slice(8), title: b?.title ?? null, items: b?.items.length ?? 0, modified: Math.floor(Date.now() / 1000) };
      });
  }

  async createBoard(slug: string) {
    let root = `library/${slug}`;
    for (let n = 2; this.boards.has(root); n++) root = `library/${slug}-${n}`;
    this.boards.set(root, null);
    return root;
  }

  async moveBoard(): Promise<string> {
    throw new Error('Moving boards needs the desktop app');
  }

  async deleteBoard(root: string) {
    this.boards.delete(root);
    const wasOpen = this.current === root;
    if (wasOpen) this.current = '';
    return wasOpen;
  }

  async setTitle(title: string) {
    document.title = `${title} · Board`;
  }

  private access: McpAccess = 'off';

  async getMcpAccess() {
    return this.access;
  }

  async setMcpAccess(mode: McpAccess) {
    this.access = mode;
  }

  async read() {
    return this.text;
  }

  async save(text: string, baseRev: number): Promise<SaveResult> {
    const diskRev = this.text ? (JSON.parse(this.text) as { rev: number }).rev : 0;
    if (this.text && diskRev !== baseRev) return { ok: false, disk: this.text };
    this.text = text;
    return { ok: true };
  }

  // No sanitizing in the browser preview; the desktop app does that in Rust.
  async importAsset(bytes: Uint8Array): Promise<Imported> {
    const blob = new Blob([bytes as BlobPart]);
    const bmp = await createImageBitmap(blob);
    const imported = { asset: `assets/mem-${++this.counter}.img`, width: bmp.width, height: bmp.height };
    bmp.close();
    this.urls.set(imported.asset, URL.createObjectURL(blob));
    return imported;
  }

  async fetchImage(): Promise<Imported> {
    throw new Error('Downloading web images needs the desktop app');
  }

  assetUrl(rel: string) {
    return this.urls.get(rel) ?? '';
  }

  async onExternalChange(cb: () => void) {
    this.listeners.push(cb);
  }

  async setAlwaysOnTop() {}

  private async swatch(w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d')!, w, h);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    return (await this.importAsset(new Uint8Array(await blob.arrayBuffer()))).asset;
  }

  private async seed() {
    const b = createBoard();
    const now = new Date().toISOString();
    const sunset = await this.swatch(960, 600, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#2b1b4a');
      grd.addColorStop(0.55, '#e0613a');
      grd.addColorStop(1, '#f7c26b');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#1a1020';
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 40) g.lineTo(x, h * 0.72 - Math.sin(x / 90) * 40 - (x % 120 === 0 ? 30 : 0));
      g.lineTo(w, h);
      g.fill();
    });
    const grid = await this.swatch(640, 640, (g, w, h) => {
      g.fillStyle = '#0d1b14';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#3ddc97';
      g.lineWidth = 2;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i * 3 + j * 5) % 7 < 3) g.strokeRect(i * 80 + 8, j * 80 + 8, 64, 64);
    });
    const card = await this.swatch(800, 520, (g, w, h) => {
      g.fillStyle = '#f3efe6';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#111';
      g.font = 'bold 64px Georgia';
      g.fillText('Quiet type.', 56, 150);
      g.font = '22px Georgia';
      g.fillStyle = '#555';
      g.fillText('Lots of air. One accent.', 58, 200);
      g.fillStyle = '#e4572e';
      g.fillRect(56, 260, 180, 56);
    });
    const busy = await this.swatch(600, 400, (g, w, h) => {
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `hsl(${(i * 47) % 360} 90% 55%)`;
        g.fillRect((i * 97) % w, (i * 53) % h, 80, 60);
      }
    });
    const img = (id: string, asset: string, x: number, y: number, w: number, h: number, extra: Partial<ImageItem> = {}): ImageItem => ({
      id, kind: 'image', asset, srcW: w * 1.5, srcH: h * 1.5, x, y, w, h, z: 1, addedBy: 'user', createdAt: now, ...extra,
    });
    const zones: Zone[] = [
      { id: 'zone_mood', name: 'Mood', x: -40, y: -40, w: 1240, h: 520, color: 'amber', note: 'Overall feel for the landing page' },
      { id: 'zone_avoid', name: 'Avoid', x: 1280, y: -40, w: 520, h: 400, color: 'rose', note: 'Anti-references' },
    ];
    const note: NoteItem = { id: 'note_flat', kind: 'note', text: 'Flat surfaces, no drop shadows. Warm, late-evening light.', x: 0, y: 520, w: 340, h: 150, z: 2, addedBy: 'user', createdAt: now };
    b.zones = zones;
    b.items = [
      img('img_sunset', sunset, 0, 0, 640, 400, { pinned: true, note: 'This light, but less purple', caption: 'Dusk gradient, purple to orange, dark hill silhouette' }),
      img('img_card', card, 680, 0, 480, 312),
      img('img_grid', grid, 680, 340 - 20, 120, 120, { z: 3 }),
      img('img_busy', busy, 1320, 0, 420, 280, { note: 'Too noisy' }),
      note,
    ];
    b.rev = 1;
    return b;
  }

  private async simulateAgent() {
    const b = JSON.parse(this.text ?? serializeBoard(createBoard()));
    const asset = await this.swatch(720, 450, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#3a2440');
      grd.addColorStop(1, '#f0a35a');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.font = 'bold 44px sans-serif';
      g.fillText('Build #3', 40, 80);
    });
    b.items.push({
      id: newId('img'), kind: 'image', asset, srcW: 720, srcH: 450, x: 0, y: 720, w: 512, h: 320, z: 99,
      addedBy: 'agent', agent: 'Demo Agent', createdAt: new Date().toISOString(), caption: 'Hero section, iteration 3',
    });
    b.rev += 1;
    this.text = serializeBoard(b);
    for (const l of this.listeners) l();
  }
}
