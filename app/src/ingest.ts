import { newId, topZ, type ImageItem } from '@board/format';
import type { Backend, Imported } from './backend';
import type { Point } from './camera';
import type { Store } from './store';
import type { BoardView } from './view';
import { isEditableTarget } from './view';

/** A new image takes at most this share of the window; a pasted batch at most FIT_BATCH of its width. */
const FIT_ONE = 0.7;
const FIT_BATCH = 0.9;
/** Space between images in a batch, on screen. */
const GAP_SCREEN = 20;
/** Mirrors the sanitizer's cap in Rust; checked here too so huge files never cross IPC. */
const MAX_BYTES = 40 * 1024 * 1024;

export interface IngestDeps {
  store: Store;
  backend: Backend;
  view: BoardView;
  toast: (msg: string, tone?: 'info' | 'error') => void;
  isOpen: () => boolean;
}

const isFetchable = (s: string) => /^https?:\/\/\S+$/i.test(s) || /^data:image\/[a-z+.-]+;base64,/i.test(s);

/**
 * Picks the image URL out of something dragged from a web page. Browsers put
 * the link target in text/uri-list when the image is wrapped in a link, so the
 * <img src> in text/html wins when present. DOMParser builds an inert document:
 * nothing in it runs or loads.
 */
export function droppedImageUrl(dt: { types: readonly string[]; getData(type: string): string }): string | null {
  if (dt.types.includes('text/html')) {
    const doc = new DOMParser().parseFromString(dt.getData('text/html'), 'text/html');
    const src = doc.querySelector('img')?.getAttribute('src')?.trim();
    if (src && isFetchable(src)) return src;
  }
  if (dt.types.includes('text/uri-list')) {
    for (const line of dt.getData('text/uri-list').split(/\r?\n/)) {
      const l = line.trim();
      if (l && !l.startsWith('#') && isFetchable(l)) return l;
    }
  }
  const text = dt.types.includes('text/plain') ? dt.getData('text/plain').trim() : '';
  return isFetchable(text) ? text : null;
}

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  if (b64.length > (MAX_BYTES * 4) / 3) throw new Error('Image is over 40 MB');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Lays a batch out in a row centered on `at` and selects it. Sizes are chosen
 * on screen, then converted to the board: an image lands at its real pixel
 * size, but never bigger than ~70% of the window, and a batch fits the window
 * together. Zoomed in, it lands smaller on the board; zoomed out, larger.
 */
function place(imported: Imported[], at: Point, deps: IngestDeps) {
  if (!imported.length) return;
  const { w: vw, h: vh } = deps.view.viewportSize();
  const zoom = deps.view.cam.zoom;
  const perImage = imported.map((im) => {
    const k = Math.min(1, (vw * FIT_ONE) / im.width, (vh * FIT_ONE) / im.height);
    return { im, sw: im.width * k, sh: im.height * k };
  });
  const rowW = perImage.reduce((s, p) => s + p.sw, 0) + GAP_SCREEN * (perImage.length - 1);
  const rowH = Math.max(...perImage.map((p) => p.sh));
  const fitAll = Math.min(1, (vw * FIT_BATCH) / rowW, (vh * FIT_ONE) / rowH);
  const gap = (GAP_SCREEN * fitAll) / zoom;
  const sized = perImage.map(({ im, sw, sh }) => ({ im, w: round2((sw * fitAll) / zoom), h: round2((sh * fitAll) / zoom) }));
  const totalW = sized.reduce((s, p) => s + p.w, 0) + gap * (sized.length - 1);
  let x = round2(at.x - totalW / 2);
  let z = topZ(deps.store.doc);
  const now = new Date().toISOString();
  const items: ImageItem[] = sized.map(({ im, w, h }) => {
    const item: ImageItem = {
      id: newId('img'),
      kind: 'image',
      asset: im.asset,
      srcW: im.width,
      srcH: im.height,
      x,
      y: round2(at.y - h / 2),
      w,
      h,
      z: ++z,
      addedBy: 'user',
      createdAt: now,
      ...(im.source ? { source: im.source } : {}),
    };
    x = round2(x + w + gap);
    return item;
  });
  deps.store.commit((b) => b.items.push(...items));
  deps.view.select(items.map((i) => i.id));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function ingestFiles(files: File[], at: Point, deps: IngestDeps): Promise<void> {
  const imported: Imported[] = [];
  for (const file of files) {
    try {
      if (file.size > MAX_BYTES) throw new Error('Image is over 40 MB');
      // Bytes go straight to the Rust sanitizer; nothing decodes them in the webview first.
      imported.push(await deps.backend.importAsset(new Uint8Array(await file.arrayBuffer())));
    } catch (e) {
      deps.toast(`Couldn't add ${file.name || 'image'}: ${message(e)}`, 'error');
    }
  }
  place(imported, at, deps);
}

/** Returns false if nothing was added (the caller may fall back, e.g. to a text note). */
export async function ingestUrl(url: string, at: Point, deps: IngestDeps): Promise<boolean> {
  try {
    let im: Imported;
    if (url.startsWith('data:')) {
      im = await deps.backend.importAsset(dataUrlBytes(url));
    } else {
      deps.toast(`Downloading ${new URL(url).hostname}…`);
      im = await deps.backend.fetchImage(url);
    }
    place([im], at, deps);
    return true;
  } catch (e) {
    deps.toast(message(e), 'error');
    return false;
  }
}

/** Clipboard paste and drag-and-drop from Explorer/Finder or any browser. */
export function bindIngest(viewport: HTMLElement, veil: HTMLElement, deps: IngestDeps) {
  document.addEventListener('paste', (e) => {
    if (!deps.isOpen() || isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
    const data = e.clipboardData;
    if (!data) return;
    const at = deps.view.dropPoint();
    const files = [...data.files];
    if (files.length) {
      e.preventDefault();
      void ingestFiles(files, at, deps);
      return;
    }
    const url = droppedImageUrl(data);
    const text = data.getData('text/plain').trim();
    if (url) {
      e.preventDefault();
      // A pasted link that isn't an image still lands on the board, as a note.
      void ingestUrl(url, at, deps).then((ok) => !ok && text && deps.view.addNote(text));
    } else if (text) {
      e.preventDefault();
      deps.view.addNote(text);
    }
  });

  let depth = 0;
  viewport.addEventListener('dragenter', (e) => {
    if (!deps.isOpen()) return;
    e.preventDefault();
    depth++;
    veil.hidden = false;
  });
  viewport.addEventListener('dragover', (e) => {
    if (!deps.isOpen()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  viewport.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) veil.hidden = true;
  });
  viewport.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    veil.hidden = true;
    const dt = e.dataTransfer;
    if (!deps.isOpen() || !dt) return;
    const r = viewport.getBoundingClientRect();
    const at = deps.view.cam.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
    const files = [...dt.files];
    if (files.length) {
      void ingestFiles(files, at, deps);
      return;
    }
    const url = droppedImageUrl(dt);
    if (url) void ingestUrl(url, at, deps);
    else deps.toast('Nothing to add there. Drop image files, or images from a web page.', 'error');
  });
}
