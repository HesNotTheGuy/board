import {
  ZONE_COLORS,
  boundsOf,
  byReadingOrder,
  center,
  containsPoint,
  newId,
  overlaps,
  topZ,
  zoneOf,
  type Board,
  type ImageItem,
  type Item,
  type NoteItem,
  type Rect,
  type Snapshot,
  type Zone,
} from '@board/format';
import type { Backend } from './backend';
import { Camera, type Point } from './camera';
import { h } from './dom';
import { comboFromEvent, keymap, type Action } from './keys';
import type { Store } from './store';

type Handle = 'nw' | 'ne' | 'sw' | 'se';

type Gesture =
  | { kind: 'pan'; start: Point; camX: number; camY: number }
  | {
      kind: 'move';
      start: Point;
      startScreen: Point;
      items: Map<string, Point>;
      zones: Map<string, Point>;
      before: Snapshot;
      release: () => void;
      moved: boolean;
      clickedId: string;
    }
  | { kind: 'resize'; id: string; handle: Handle; r0: Rect; aspect: boolean; before: Snapshot; release: () => void }
  | { kind: 'marquee'; start: Point; current: Point; base: Set<string> }
  | { kind: 'crop-resize'; handle: string; start: Rect }
  | { kind: 'crop-move'; startWorld: Point; start: Rect };

/** Crop mode: the whole image is shown and `win` (board units) is the part being kept. */
interface Cropping {
  id: string;
  before: Snapshot;
  release: () => void;
  full: Rect;
  win: Rect;
}

const MIN_SIZE = 16;
const ARRIVAL_MS = 2600;
const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se'];

const isZoneId = (id: string) => id.startsWith('zone_');
const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const px = (r: Rect) => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;

export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

export interface ViewEls {
  viewport: HTMLElement;
  world: HTMLElement;
  zones: HTMLElement;
  items: HTMLElement;
  overlay: HTMLElement;
}

/** The infinite canvas: renders the board as DOM and turns pointer/keyboard input into store edits. */
export class BoardView {
  readonly cam = new Camera();
  readonly selection = new Set<string>();
  grayscale = false;
  /** False until a project is open; shortcuts and edits are ignored before that. */
  active = false;
  /** Last pointer position in world coords (paste target); null when the pointer is off the canvas. */
  pointerWorld: Point | null = null;

  private itemEls = new Map<string, HTMLElement>();
  private zoneEls = new Map<string, HTMLElement>();
  private gesture: Gesture | null = null;
  private spaceDown = false;
  private editingNote: string | null = null;
  private cropping: Cropping | null = null;
  private arrivals = new Map<string, number>();
  private raf = 0;
  private camKey = '';
  private camSaveTimer: number | undefined;
  private listeners = new Set<() => void>();
  private focusFieldListeners = new Set<(field: string) => void>();

  constructor(
    private els: ViewEls,
    private store: Store,
    private backend: Backend,
  ) {
    store.on(() => this.requestRender());
    store.onArrivals((ids) => {
      const until = performance.now() + ARRIVAL_MS;
      for (const id of ids) this.arrivals.set(id, until);
      window.setTimeout(() => this.requestRender(), ARRIVAL_MS + 50);
    });
    this.bind();
  }

  // ── public api ───────────────────────────────────────────────────────────

  get doc(): Board {
    return this.store.doc;
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  /** The inspector listens so it can focus e.g. the name field right after a zone is created. */
  onFocusField(fn: (field: string) => void) {
    this.focusFieldListeners.add(fn);
  }

  private focusField(field: string) {
    for (const fn of this.focusFieldListeners) fn(field);
  }

  viewportSize() {
    const r = this.els.viewport.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  viewCenterWorld(): Point {
    const { w, h } = this.viewportSize();
    return this.cam.toWorld({ x: w / 2, y: h / 2 });
  }

  /** Where new things go: under the pointer if it's over the canvas, else the view center. */
  dropPoint(): Point {
    return this.pointerWorld ?? this.viewCenterWorld();
  }

  select(ids: Iterable<string>) {
    this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.requestRender();
  }

  /** Resets for a newly opened project, restoring its saved camera or framing everything. */
  attach(projectKey: string) {
    this.camKey = `board.cam.${projectKey}`;
    if (this.cropping) this.cancelCrop();
    this.selection.clear();
    for (const el of [...this.itemEls.values(), ...this.zoneEls.values()]) el.remove();
    this.itemEls.clear();
    this.zoneEls.clear();
    let restored = false;
    try {
      const saved = JSON.parse(localStorage.getItem(this.camKey) ?? 'null') as { x: number; y: number; zoom: number } | null;
      if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite)) {
        Object.assign(this.cam, saved);
        restored = true;
      }
    } catch {
      // storage unavailable; fall through to fit
    }
    if (!restored) this.fit('all', false);
    this.requestRender();
  }

  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  // ── actions (toolbar, keys, inspector) ───────────────────────────────────

  entity(id: string): Item | Zone | undefined {
    return isZoneId(id) ? this.doc.zones.find((z) => z.id === id) : this.doc.items.find((i) => i.id === id);
  }

  selectedItems(): Item[] {
    return this.doc.items.filter((i) => this.selection.has(i.id));
  }

  selectedZones(): Zone[] {
    return this.doc.zones.filter((z) => this.selection.has(z.id));
  }

  selectAll() {
    this.select(this.doc.items.map((i) => i.id));
  }

  deleteSelection() {
    if (!this.selection.size) return;
    const ids = new Set(this.selection);
    this.store.commit((b) => {
      b.items = b.items.filter((i) => !ids.has(i.id));
      b.zones = b.zones.filter((z) => !ids.has(z.id));
    });
    this.select([]);
  }

  togglePin() {
    const items = this.selectedItems();
    if (!items.length) return;
    const pin = items.some((i) => !i.pinned);
    this.store.commit(() => {
      for (const i of items) {
        if (pin) i.pinned = true;
        else delete i.pinned;
      }
    });
  }

  flip(axis: 'x' | 'y' = 'x') {
    const images = this.selectedItems().filter((i): i is ImageItem => i.kind === 'image');
    if (!images.length) return;
    const key = axis === 'x' ? 'flipX' : 'flipY';
    this.store.commit(() => {
      for (const i of images) {
        if (i[key]) delete i[key];
        else i[key] = true;
      }
    });
  }

  /** Copies the selection, slightly offset, and selects the copies. */
  duplicate() {
    const items = this.selectedItems().sort((a, b) => a.z - b.z);
    const zones = this.selectedZones();
    if (!items.length && !zones.length) return;
    const off = 24 / this.cam.zoom;
    const now = new Date().toISOString();
    let z = topZ(this.doc);
    const itemCopies = items.map((it) => {
      const copy = structuredClone(it) as Item;
      Object.assign(copy, { id: newId(it.kind === 'image' ? 'img' : 'note'), x: r2(it.x + off), y: r2(it.y + off), z: ++z, addedBy: 'user', createdAt: now });
      delete copy.agent;
      return copy;
    });
    const zoneCopies = zones.map((zn) => ({ ...structuredClone(zn), id: newId('zone'), name: `${zn.name} copy`, x: r2(zn.x + off), y: r2(zn.y + off) }));
    this.store.commit((b) => {
      b.items.push(...itemCopies);
      b.zones.push(...zoneCopies);
    });
    this.select([...itemCopies, ...zoneCopies].map((e) => e.id));
  }

  /** Bring the selection to the front, or send it to the back, keeping its own stacking order. */
  order(toFront: boolean) {
    const sel = this.selectedItems();
    if (!sel.length) return;
    this.store.commit(() => {
      if (toFront) {
        let z = topZ(this.doc);
        for (const it of sel.sort((a, b) => a.z - b.z)) it.z = ++z;
      } else {
        let z = Math.min(...this.doc.items.map((i) => i.z));
        for (const it of sel.sort((a, b) => b.z - a.z)) it.z = --z;
      }
    });
  }

  // ── crop ────────────────────────────────────────────────────────────────

  get isCropping() {
    return this.cropping !== null;
  }

  /** Board rect the whole (uncropped) image would cover, in display orientation (after flips). */
  private fullRect(it: ImageItem): Rect {
    const c = it.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const fw = it.w / c.w;
    const fh = it.h / c.h;
    const dx = it.flipX ? 1 - c.x - c.w : c.x;
    const dy = it.flipY ? 1 - c.y - c.h : c.y;
    return { x: it.x - dx * fw, y: it.y - dy * fh, w: fw, h: fh };
  }

  /** Enter crop mode on the single selected image (or apply, if already cropping). */
  startCrop() {
    if (this.cropping) return this.commitCrop();
    const sel = this.selectedItems();
    const it = sel.length === 1 && sel[0]!.kind === 'image' ? sel[0] : null;
    if (!it) return;
    this.cropping = {
      id: it.id,
      before: this.store.snapshot(),
      release: this.store.hold(),
      full: this.fullRect(it),
      win: { x: it.x, y: it.y, w: it.w, h: it.h },
    };
    this.requestRender();
  }

  commitCrop() {
    const c = this.cropping;
    if (!c) return;
    this.cropping = null;
    const it = this.doc.items.find((i) => i.id === c.id);
    if (it?.kind === 'image') {
      const { full, win } = c;
      const fx = (win.x - full.x) / full.w;
      const fy = (win.y - full.y) / full.h;
      const fw = win.w / full.w;
      const fh = win.h / full.h;
      // The window is in display orientation; crops are stored in source orientation.
      const crop = { x: it.flipX ? 1 - fx - fw : fx, y: it.flipY ? 1 - fy - fh : fy, w: fw, h: fh };
      const r4 = (v: number) => Math.round(v * 10000) / 10000;
      if (crop.x < 0.0005 && crop.y < 0.0005 && crop.w > 0.9995 && crop.h > 0.9995) delete it.crop;
      else it.crop = { x: r4(Math.max(0, crop.x)), y: r4(Math.max(0, crop.y)), w: r4(crop.w), h: r4(crop.h) };
      Object.assign(it, { x: r2(win.x), y: r2(win.y), w: r2(win.w), h: r2(win.h) });
      this.store.record(c.before);
      this.store.touch();
    }
    c.release();
    this.requestRender();
  }

  cancelCrop() {
    const c = this.cropping;
    if (!c) return;
    this.cropping = null;
    c.release();
    this.requestRender();
  }

  /** Shows the whole image again, at the same scale. */
  resetCrop() {
    const it = this.selectedItems().find((i): i is ImageItem => i.kind === 'image' && !!i.crop);
    if (!it) return;
    const full = this.fullRect(it);
    this.store.commit(() => {
      delete it.crop;
      Object.assign(it, { x: r2(full.x), y: r2(full.y), w: r2(full.w), h: r2(full.h) });
    });
  }

  addNote(text = '') {
    const at = this.dropPoint();
    // Same size on screen whatever the zoom: zoomed in 3x, the note is a third the size on the board.
    const scale = Math.round(Math.min(4, Math.max(0.25, 1 / this.cam.zoom)) * 100) / 100;
    const w = Math.round(300 * scale);
    const h = Math.round(180 * scale);
    const note: NoteItem = {
      id: newId('note'),
      kind: 'note',
      text,
      ...(scale !== 1 ? { scale } : {}),
      x: Math.round(at.x - w / 2),
      y: Math.round(at.y - h / 2),
      w,
      h,
      z: topZ(this.doc) + 1,
      addedBy: 'user',
      createdAt: new Date().toISOString(),
    };
    this.store.commit((b) => b.items.push(note));
    this.select([note.id]);
    if (!text) requestAnimationFrame(() => requestAnimationFrame(() => this.beginEditNote(note.id)));
  }

  addZone() {
    const b = boundsOf(this.selectedItems());
    const c = this.viewCenterWorld();
    const rect = b
      ? { x: b.x - 40, y: b.y - 40, w: b.w + 80, h: b.h + 80 }
      : { x: Math.round(c.x - 360), y: Math.round(c.y - 240), w: 720, h: 480 };
    const zone: Zone = {
      id: newId('zone'),
      name: `Zone ${this.doc.zones.length + 1}`,
      ...rect,
      color: ZONE_COLORS[this.doc.zones.length % ZONE_COLORS.length]!,
    };
    this.store.commit((d) => d.zones.push(zone));
    this.select([zone.id]);
    this.focusField('name');
  }

  /**
   * Packs items into tidy rows at a shared height. With a
   * selection, packs just that. Without one, packs each zone's contents inside
   * its zone (growing it to fit) and loose items on their own, so nothing ever
   * changes zone; zones carry meaning for the AI tools reading the board.
   */
  arrange() {
    const groups: { items: Item[]; zone?: Zone }[] = [];
    if (this.selection.size) {
      groups.push({ items: this.selectedItems() });
    } else {
      const byZone = new Map<string, Item[]>();
      const loose: Item[] = [];
      for (const it of this.doc.items) {
        const z = zoneOf(this.doc, it);
        if (z) byZone.set(z.id, [...(byZone.get(z.id) ?? []), it]);
        else loose.push(it);
      }
      for (const zone of this.doc.zones) groups.push({ items: byZone.get(zone.id) ?? [], zone });
      groups.push({ items: loose });
    }
    const work = groups.filter((g) => g.items.length >= 2);
    if (!work.length) return;
    this.store.commit(() => {
      for (const g of work) {
        const pad = 40;
        const origin = g.zone ? { x: g.zone.x + pad, y: g.zone.y + pad } : boundsOf(g.items)!;
        const packed = packRows(g.items, origin);
        if (g.zone) {
          g.zone.w = Math.max(g.zone.w, packed.x + packed.w + pad - g.zone.x);
          g.zone.h = Math.max(g.zone.h, packed.y + packed.h + pad - g.zone.y);
        }
      }
    });
  }

  /** 'all' frames the whole board; 'selection' frames what's selected (or everything if nothing is). */
  fit(mode: 'all' | 'selection' = 'all', animate = true) {
    const sel = mode === 'selection' ? [...this.selection].map((id) => this.entity(id)).filter((e): e is Item | Zone => !!e) : [];
    const r = boundsOf(sel.length ? sel : [...this.doc.items, ...this.doc.zones]);
    const { w, h } = this.viewportSize();
    if (r) this.cam.fit(r, w, h, 80, sel.length ? 2 : 1);
    else Object.assign(this.cam, { x: w / 2, y: h / 2, zoom: 1 });
    if (animate) {
      this.els.world.classList.add('easing');
      window.setTimeout(() => this.els.world.classList.remove('easing'), 260);
    }
    this.cameraMoved();
  }

  zoomTo(z: number) {
    const { w, h } = this.viewportSize();
    this.cam.zoomAt({ x: w / 2, y: h / 2 }, z / this.cam.zoom);
    this.cameraMoved();
  }

  zoomBy(factor: number) {
    this.zoomTo(this.cam.zoom * factor);
  }

  setGrayscale(on: boolean) {
    this.grayscale = on;
    this.els.world.classList.toggle('grayscale', on);
    this.emit();
  }

  beginEditNote(id: string) {
    const el = this.itemEls.get(id)?.querySelector<HTMLElement>('.note-text');
    if (!el) return;
    this.editingNote = id;
    el.contentEditable = 'plaintext-only';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  // ── rendering ────────────────────────────────────────────────────────────

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private cameraMoved() {
    this.requestRender();
    clearTimeout(this.camSaveTimer);
    this.camSaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(this.camKey, JSON.stringify({ x: this.cam.x, y: this.cam.y, zoom: this.cam.zoom }));
      } catch {
        // per-viewer convenience only
      }
    }, 400);
  }

  private render() {
    const { cam, els } = this;
    for (const id of [...this.selection]) if (!this.entity(id)) this.selection.delete(id);

    els.world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
    els.world.style.setProperty('--zoom', String(cam.zoom));
    let grid = 32 * cam.zoom;
    while (grid < 14) grid *= 4;
    // The grid is painted by the canvas backdrop layer (#viewport::before), which reads these.
    els.viewport.style.setProperty('--grid', `${grid}px`);
    els.viewport.style.setProperty('--grid-x', `${cam.x}px`);
    els.viewport.style.setProperty('--grid-y', `${cam.y}px`);

    this.renderZones();
    this.renderItems();
    this.renderOverlay();
    this.emit();
  }

  private renderZones() {
    const doc = this.doc;
    const seen = new Set<string>();
    for (const z of doc.zones) {
      seen.add(z.id);
      let el = this.zoneEls.get(z.id);
      if (!el) {
        el = h(
          'div',
          { class: 'zone', data: { id: z.id } },
          h('div', { class: 'zone-label', data: { zone: z.id } }, h('span', { class: 'zone-name' }), h('span', { class: 'zone-count' })),
        );
        this.els.zones.append(el);
        this.zoneEls.set(z.id, el);
      }
      el.dataset.color = z.color;
      el.style.cssText = px(z);
      el.classList.toggle('selected', this.selection.has(z.id));
      el.querySelector('.zone-name')!.textContent = z.name || 'Untitled';
      const count = doc.items.filter((i) => containsPoint(z, center(i))).length;
      el.querySelector('.zone-count')!.textContent = count ? String(count) : '';
    }
    for (const [id, el] of this.zoneEls) {
      if (!seen.has(id)) {
        el.remove();
        this.zoneEls.delete(id);
      }
    }
  }

  private createItemEl(it: Item): HTMLElement {
    const badges = h('div', { class: 'badges' });
    if (it.kind === 'image') {
      const img = h('img', { attrs: { draggable: 'false', alt: '' } });
      // The frame clips to the crop and carries the flips, so a flip mirrors what you see.
      return h('div', { class: 'item image', data: { id: it.id, kind: it.kind } }, h('div', { class: 'img-frame' }, img), badges);
    }
    const text = h('div', { class: 'note-text' });
    text.addEventListener('blur', () => this.endEditNote(it.id, text));
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') text.blur();
      e.stopPropagation();
    });
    return h('div', { class: 'item note', data: { id: it.id, kind: it.kind } }, text, badges);
  }

  private renderItems() {
    const now = performance.now();
    const seen = new Set<string>();
    for (const it of this.doc.items) {
      seen.add(it.id);
      let el = this.itemEls.get(it.id);
      if (!el || el.dataset.kind !== it.kind) {
        el?.remove();
        el = this.createItemEl(it);
        this.els.items.append(el);
        this.itemEls.set(it.id, el);
      }
      const cropMode = this.cropping?.id === it.id;
      const rect = cropMode ? this.cropping!.full : it;
      el.style.cssText = `${px(rect)};z-index:${Math.round(it.z)}${it.kind === 'note' && it.scale ? `;--note-scale:${it.scale}` : ''}`;
      el.classList.toggle('cropping', cropMode);
      el.classList.toggle('pinned', !!it.pinned);
      el.classList.toggle('agent', it.addedBy === 'agent');
      el.classList.toggle('selected', this.selection.has(it.id));
      const arrival = this.arrivals.get(it.id);
      el.classList.toggle('arrive', arrival !== undefined && arrival > now);
      if (arrival !== undefined && arrival <= now) this.arrivals.delete(it.id);

      if (it.kind === 'image') {
        const img = el.querySelector('img')!;
        if (img.dataset.asset !== it.asset) {
          img.dataset.asset = it.asset;
          img.src = this.backend.assetUrl(it.asset);
        }
        const c = cropMode ? undefined : it.crop;
        const want = c ? `width:${100 / c.w}%;height:${100 / c.h}%;left:${(-c.x / c.w) * 100}%;top:${(-c.y / c.h) * 100}%` : '';
        if (img.dataset.crop !== want) {
          img.dataset.crop = want;
          img.style.cssText = want;
        }
        const frame = img.parentElement!;
        frame.style.transform = it.flipX || it.flipY ? `scale(${it.flipX ? -1 : 1}, ${it.flipY ? -1 : 1})` : '';
      } else if (this.editingNote !== it.id) {
        const text = el.querySelector<HTMLElement>('.note-text')!;
        if (text.textContent !== it.text) text.textContent = it.text;
        text.dataset.empty = it.text ? '' : 'Write a note…';
      }

      const want = [it.pinned && 'focus', it.addedBy === 'agent' && 'agent', it.kind === 'image' && it.note && 'has-note'].filter(Boolean) as string[];
      const badgeEl = el.querySelector<HTMLElement>('.badges')!;
      const sig = `${want.join(' ')}|${it.agent ?? ''}`;
      if (badgeEl.dataset.sig !== sig) {
        badgeEl.dataset.sig = sig;
        const label: Record<string, string> = { focus: 'Focus', agent: it.agent ?? 'AI', 'has-note': 'Note' };
        badgeEl.replaceChildren(...want.map((b) => h('span', { class: `badge ${b}`, text: label[b] })));
      }
    }
    for (const [id, el] of this.itemEls) {
      if (!seen.has(id)) {
        el.remove();
        this.itemEls.delete(id);
      }
    }
  }

  private renderOverlay() {
    const nodes: HTMLElement[] = [];
    if (this.cropping && !this.entity(this.cropping.id)) this.cancelCrop();
    if (this.cropping) {
      const full = this.cam.rectToScreen(this.cropping.full);
      const win = this.cam.rectToScreen(this.cropping.win);
      const shade = (r: Rect) => r.w > 0 && r.h > 0 && nodes.push(h('div', { class: 'crop-shade', style: px(r) }));
      shade({ x: full.x, y: full.y, w: full.w, h: win.y - full.y });
      shade({ x: full.x, y: win.y + win.h, w: full.w, h: full.y + full.h - win.y - win.h });
      shade({ x: full.x, y: win.y, w: win.x - full.x, h: win.h });
      shade({ x: win.x + win.w, y: win.y, w: full.x + full.w - win.x - win.w, h: win.h });
      nodes.push(
        h('div', { class: 'crop-win', style: px(win), data: { cropMove: '1' } }, ...CROP_HANDLES.map((hd) => h('i', { class: `crop-h ${hd}`, data: { cropHandle: hd } }))),
        h('div', { class: 'crop-hint', style: `left:${win.x + win.w / 2}px;top:${win.y + win.h}px`, text: 'Enter to crop · Esc to cancel' }),
      );
      this.els.overlay.replaceChildren(...nodes);
      return;
    }
    const ids = [...this.selection];
    const single = ids.length === 1;
    const rects: Rect[] = [];
    for (const id of ids) {
      const e = this.entity(id);
      if (!e) continue;
      const r = this.cam.rectToScreen(e);
      rects.push(r);
      const corners = HANDLES.map((hd) => h('i', { class: `corner ${hd}`, data: single ? { handle: hd, id } : {} }));
      nodes.push(h('div', { class: `sel${isZoneId(id) ? ' zone-sel' : ''}${single ? ' single' : ''}`, style: px(r) }, ...corners));
    }
    if (rects.length > 1) {
      const b = boundsOf(rects)!;
      nodes.push(h('div', { class: 'group-box', style: px({ x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 }) }));
    }
    const g = this.gesture;
    if (g?.kind === 'marquee') {
      const r = {
        x: Math.min(g.start.x, g.current.x),
        y: Math.min(g.start.y, g.current.y),
        w: Math.abs(g.current.x - g.start.x),
        h: Math.abs(g.current.y - g.start.y),
      };
      nodes.push(h('div', { class: 'marquee', style: px(r) }));
    }
    this.els.overlay.replaceChildren(...nodes);
  }

  // ── input ────────────────────────────────────────────────────────────────

  private screenPoint(e: { clientX: number; clientY: number }): Point {
    const r = this.els.viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private bind() {
    const vp = this.els.viewport;
    vp.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    vp.addEventListener('pointermove', (e) => this.onPointerMove(e));
    vp.addEventListener('pointerup', (e) => this.onPointerUp(e));
    vp.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    vp.addEventListener('pointerleave', () => {
      if (!this.gesture) this.pointerWorld = null;
    });
    vp.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    vp.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    vp.addEventListener('auxclick', (e) => e.button === 1 && e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    const releaseSpace = () => {
      this.spaceDown = false;
      vp.classList.remove('pan-ready');
    };
    window.addEventListener('keyup', (e) => keymap.isPan(e) && releaseSpace());
    window.addEventListener('blur', releaseSpace);
    window.addEventListener('resize', () => this.requestRender());
  }

  private onPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (this.editingNote && target.closest('.note-text[contenteditable="plaintext-only"]')) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && isEditableTarget(active)) active.blur();
    this.els.viewport.focus({ preventScroll: true });

    const p = this.screenPoint(e);
    const vp = this.els.viewport;

    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      this.gesture = { kind: 'pan', start: p, camX: this.cam.x, camY: this.cam.y };
      vp.classList.add('panning');
      vp.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    if (this.cropping) {
      const cropHandle = target.closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle;
      if (cropHandle) {
        this.gesture = { kind: 'crop-resize', handle: cropHandle, start: { ...this.cropping.win } };
      } else if (target.closest('[data-crop-move]')) {
        this.gesture = { kind: 'crop-move', startWorld: this.cam.toWorld(p), start: { ...this.cropping.win } };
      } else {
        this.commitCrop(); // clicking away applies the crop, like other editors
        return;
      }
      vp.setPointerCapture(e.pointerId);
      return;
    }

    const handle = target.closest<HTMLElement>('[data-handle]');
    if (handle?.dataset.id) {
      const ent = this.entity(handle.dataset.id);
      if (!ent) return;
      this.gesture = {
        kind: 'resize',
        id: ent.id,
        handle: handle.dataset.handle as Handle,
        r0: { x: ent.x, y: ent.y, w: ent.w, h: ent.h },
        aspect: 'kind' in ent && ent.kind === 'image',
        before: this.store.snapshot(),
        release: this.store.hold(),
      };
      vp.setPointerCapture(e.pointerId);
      return;
    }

    const zoneId = target.closest<HTMLElement>('.zone-label')?.dataset.zone;
    const itemId = target.closest<HTMLElement>('.item')?.dataset.id;
    const hit = itemId ?? zoneId;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    if (hit) {
      if (additive && this.selection.has(hit)) {
        this.selection.delete(hit);
        this.requestRender();
        return;
      }
      if (additive) this.selection.add(hit);
      else if (!this.selection.has(hit)) this.select([hit]);
      this.startMove(p, hit);
      vp.setPointerCapture(e.pointerId);
      this.requestRender();
      return;
    }

    if (!additive) this.selection.clear();
    this.gesture = { kind: 'marquee', start: p, current: p, base: new Set(this.selection) };
    vp.setPointerCapture(e.pointerId);
    this.requestRender();
  }

  private startMove(p: Point, clickedId: string) {
    const items = new Map<string, Point>();
    const zones = new Map<string, Point>();
    for (const id of this.selection) {
      const e = this.entity(id);
      if (!e) continue;
      if (isZoneId(id)) {
        zones.set(id, { x: e.x, y: e.y });
        // A zone carries everything inside it.
        for (const it of this.doc.items) if (containsPoint(e, center(it))) items.set(it.id, { x: it.x, y: it.y });
      } else {
        items.set(id, { x: e.x, y: e.y });
      }
    }
    this.gesture = {
      kind: 'move',
      start: this.cam.toWorld(p),
      startScreen: p,
      items,
      zones,
      before: this.store.snapshot(),
      release: this.store.hold(),
      moved: false,
      clickedId,
    };
  }

  private onPointerMove(e: PointerEvent) {
    const p = this.screenPoint(e);
    const w = this.cam.toWorld(p);
    this.pointerWorld = w;
    const g = this.gesture;
    if (!g) return;

    if (g.kind === 'pan') {
      this.cam.x = g.camX + (p.x - g.start.x);
      this.cam.y = g.camY + (p.y - g.start.y);
      this.cameraMoved();
      return;
    }

    if ((g.kind === 'crop-resize' || g.kind === 'crop-move') && this.cropping) {
      const { full } = this.cropping;
      const s0 = g.start;
      if (g.kind === 'crop-move') {
        const x = clamp(s0.x + (w.x - g.startWorld.x), full.x, full.x + full.w - s0.w);
        const y = clamp(s0.y + (w.y - g.startWorld.y), full.y, full.y + full.h - s0.h);
        this.cropping.win = { ...s0, x, y };
      } else {
        const min = 12 / this.cam.zoom;
        let x1 = s0.x;
        let y1 = s0.y;
        let x2 = s0.x + s0.w;
        let y2 = s0.y + s0.h;
        if (g.handle.includes('w')) x1 = clamp(w.x, full.x, x2 - min);
        if (g.handle.includes('e')) x2 = clamp(w.x, x1 + min, full.x + full.w);
        if (g.handle.includes('n')) y1 = clamp(w.y, full.y, y2 - min);
        if (g.handle.includes('s')) y2 = clamp(w.y, y1 + min, full.y + full.h);
        this.cropping.win = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      this.requestRender();
      return;
    }

    if (g.kind === 'move') {
      if (!g.moved) {
        if (Math.hypot(p.x - g.startScreen.x, p.y - g.startScreen.y) < 3) return;
        g.moved = true;
        // Bring what's being dragged to the front, keeping its relative order.
        let z = topZ(this.doc);
        for (const it of this.doc.items.filter((i) => g.items.has(i.id)).sort((a, b) => a.z - b.z)) it.z = ++z;
      }
      // Whole screen pixels at any zoom (whole board units would jump when zoomed in).
      const dx = Math.round((w.x - g.start.x) * this.cam.zoom) / this.cam.zoom;
      const dy = Math.round((w.y - g.start.y) * this.cam.zoom) / this.cam.zoom;
      const r2 = (v: number) => Math.round(v * 100) / 100; // keep board.json tidy
      for (const it of this.doc.items) {
        const o = g.items.get(it.id);
        if (o) Object.assign(it, { x: r2(o.x + dx), y: r2(o.y + dy) });
      }
      for (const z of this.doc.zones) {
        const o = g.zones.get(z.id);
        if (o) Object.assign(z, { x: r2(o.x + dx), y: r2(o.y + dy) });
      }
      this.requestRender();
      return;
    }

    if (g.kind === 'resize') {
      const ent = this.entity(g.id);
      if (!ent) return;
      const { r0, handle } = g;
      const west = handle.includes('w');
      const north = handle.includes('n');
      const fx = west ? r0.x + r0.w : r0.x;
      const fy = north ? r0.y + r0.h : r0.y;
      // Limits and rounding are in screen pixels, so this behaves the same at any zoom.
      const min = MIN_SIZE / this.cam.zoom;
      const snap = (v: number) => Math.round(v * 100) / 100;
      let nw = Math.max(min, west ? fx - w.x : w.x - fx);
      let nh = Math.max(min, north ? fy - w.y : w.y - fy);
      if (g.aspect && !e.shiftKey) {
        const s = Math.max(nw / r0.w, nh / r0.h);
        nw = Math.max(min, r0.w * s);
        nh = Math.max(min, r0.h * s);
      }
      Object.assign(ent, {
        w: snap(nw),
        h: snap(nh),
        x: snap(west ? fx - nw : fx),
        y: snap(north ? fy - nh : fy),
      });
      this.requestRender();
      return;
    }

    if (g.kind !== 'marquee') return;
    g.current = p;
    const a = this.cam.toWorld(g.start);
    const box = { x: Math.min(a.x, w.x), y: Math.min(a.y, w.y), w: Math.abs(w.x - a.x), h: Math.abs(w.y - a.y) };
    this.selection.clear();
    for (const id of g.base) this.selection.add(id);
    for (const it of this.doc.items) if (overlaps(it, box)) this.selection.add(it.id);
    for (const z of this.doc.zones) {
      if (z.x >= box.x && z.y >= box.y && z.x + z.w <= box.x + box.w && z.y + z.h <= box.y + box.h) this.selection.add(z.id);
    }
    this.requestRender();
  }

  private onPointerUp(e: PointerEvent) {
    const g = this.gesture;
    this.gesture = null;
    const vp = this.els.viewport;
    if (vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId);
    vp.classList.remove('panning');
    if (!g) return;

    if (g.kind === 'move') {
      if (g.moved) {
        this.store.record(g.before);
        this.store.touch();
      } else if (!(e.shiftKey || e.ctrlKey || e.metaKey) && this.selection.size > 1) {
        // A plain click on one of several selected items narrows the selection to it.
        this.select([g.clickedId]);
      }
      g.release();
    } else if (g.kind === 'resize') {
      this.store.record(g.before);
      this.store.touch();
      g.release();
    }
    this.requestRender();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    // Trackpad pinch arrives as ctrl+wheel with small deltas.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    this.cam.zoomAt(this.screenPoint(e), Math.exp(-e.deltaY * unit * k));
    this.cameraMoved();
  }

  private onDoubleClick(e: MouseEvent) {
    if (this.cropping) return;
    const target = e.target as HTMLElement;
    const itemId = target.closest<HTMLElement>('.item')?.dataset.id;
    const it = itemId ? this.doc.items.find((i) => i.id === itemId) : undefined;
    if (it) {
      this.select([it.id]);
      if (it.kind === 'note') this.beginEditNote(it.id);
      else this.focusField('note');
      return;
    }
    const zoneId = target.closest<HTMLElement>('.zone-label')?.dataset.zone;
    if (zoneId) {
      this.select([zoneId]);
      this.focusField('name');
    }
  }

  private endEditNote(id: string, el: HTMLElement) {
    if (this.editingNote !== id) return;
    this.editingNote = null;
    el.contentEditable = 'false';
    const text = (el.innerText ?? '').replace(/\n$/, '');
    const note = this.doc.items.find((i) => i.id === id);
    if (note?.kind === 'note' && note.text !== text) {
      this.store.commit(() => {
        note.text = text;
      });
    }
    this.requestRender();
  }

  private nudge(dx: number, dy: number) {
    const targets = [...this.selectedItems(), ...this.selectedZones()];
    if (!targets.length) return;
    this.store.commit(() => {
      for (const t of targets) {
        t.x += dx;
        t.y += dy;
      }
    });
  }

  /** Canvas shortcuts (from the user's keymap); ignored while typing in a field. */
  private onKeyDown(e: KeyboardEvent) {
    if (!this.active || isEditableTarget(e.target)) return;

    if (keymap.isPan(e)) {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.els.viewport.classList.add('pan-ready');
      }
      e.preventDefault();
      return;
    }

    if (this.cropping) {
      const a = keymap.actionFor(comboFromEvent(e));
      if (e.key === 'Enter' || a === 'crop') {
        e.preventDefault();
        this.commitCrop();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelCrop();
      }
      return;
    }

    // Arrow keys always nudge (Shift = 10px); they aren't rebindable.
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const arrow = !e.ctrlKey && !e.metaKey && !e.altKey ? arrows[e.key] : undefined;
    if (arrow) {
      const step = e.shiftKey ? 10 : 1;
      e.preventDefault();
      this.nudge(arrow[0] * step, arrow[1] * step);
      return;
    }

    const handlers: Partial<Record<Action, () => void>> = {
      note: () => this.addNote(),
      zone: () => this.addZone(),
      focus: () => this.togglePin(),
      flip: () => this.flip('x'),
      flipV: () => this.flip('y'),
      crop: () => this.startCrop(),
      duplicate: () => this.duplicate(),
      front: () => this.order(true),
      back: () => this.order(false),
      arrange: () => this.arrange(),
      delete: () => this.deleteSelection(),
      deselect: () => this.select([]),
      selectAll: () => this.selectAll(),
      undo: () => this.store.undo(),
      redo: () => this.store.redo(),
      fit: () => this.fit('all'),
      fitSelection: () => this.fit('selection'),
      zoom100: () => this.zoomTo(1),
      zoomIn: () => this.zoomBy(1.25),
      zoomOut: () => this.zoomBy(0.8),
      gray: () => this.setGrayscale(!this.grayscale),
    };
    const action = keymap.actionFor(comboFromEvent(e));
    const run = action && handlers[action];
    if (!run) return;
    e.preventDefault();
    // Holding a key shouldn't stamp out a dozen notes; undo/redo/delete may repeat.
    if (e.repeat && !['undo', 'redo', 'delete', 'zoomIn', 'zoomOut'].includes(action)) return;
    run();
  }
}

/** Shelf-packs items (mutating them) into rows at the median image height; returns the packed bounds. */
function packRows(items: Item[], origin: Point): Rect {
  const sorted = items.slice().sort(byReadingOrder);
  const heights = sorted.filter((i) => i.kind === 'image').map((i) => i.h).sort((a, b) => a - b);
  const H = heights.length ? heights[Math.floor(heights.length / 2)]! : 240;
  const gap = 24;
  const sized = sorted.map((it) => ({
    it,
    w: it.kind === 'image' ? Math.round((it.w / it.h) * H) : it.w,
    h: it.kind === 'image' ? H : it.h,
  }));
  const totalW = sized.reduce((s, x) => s + x.w + gap, 0);
  const rowW = Math.max(Math.max(...sized.map((s) => s.w)), Math.sqrt(totalW * H) * 1.4);
  let x = origin.x;
  let y = origin.y;
  let rowH = 0;
  for (const s of sized) {
    if (x > origin.x && x + s.w > origin.x + rowW) {
      x = origin.x;
      y += rowH + gap;
      rowH = 0;
    }
    Object.assign(s.it, { x, y, w: s.w, h: s.h });
    x += s.w + gap;
    rowH = Math.max(rowH, s.h);
  }
  return boundsOf(items)!;
}
