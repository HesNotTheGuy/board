import {
  createBoard,
  mergeBoards,
  mergeSnapshots,
  parseBoard,
  sameContent,
  serializeBoard,
  type Board,
  type Snapshot,
} from '@board/format';
import type { Backend } from './backend';

export type SyncState = 'idle' | 'saving' | 'saved' | 'error' | 'memory';

interface HistoryEntry {
  before: Snapshot;
  after: Snapshot;
}

type Listener = () => void;

const HISTORY_LIMIT = 200;
const SAVE_DEBOUNCE_MS = 250;

/**
 * Holds the board being edited and keeps it in sync with disk, where an agent
 * (via MCP) may write at the same time. Saves are compare-and-swap; on conflict,
 * or when the file watcher fires, local edits are 3-way merged with the newer
 * disk copy. Undo/redo is merge-based too, so undoing never drops an agent's work.
 */
export class Store {
  doc: Board = createBoard();
  sync: SyncState = 'idle';
  lastError = '';

  /** Last version known to be on disk: the merge base. */
  private base: Board = createBoard();
  private dirty = false;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private saveTimer: number | undefined;
  private saving = false;
  private holds = 0;
  private externalPending = false;
  private listeners = new Set<Listener>();
  private arrivalListeners = new Set<(ids: string[]) => void>();

  constructor(private backend: Backend) {
    backend.onExternalChange(() => void this.pullExternal());
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fires with ids of items agents added since we last looked. */
  onArrivals(fn: (ids: string[]) => void) {
    this.arrivalListeners.add(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  load(board: Board) {
    clearTimeout(this.saveTimer);
    this.doc = board;
    this.base = structuredClone(board);
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.sync = this.backend.kind === 'memory' ? 'memory' : 'saved';
    this.emit();
  }

  snapshot(): Snapshot {
    return structuredClone({ items: this.doc.items, zones: this.doc.zones });
  }

  /** One undoable action. */
  commit(fn: (b: Board) => void) {
    const before = this.snapshot();
    fn(this.doc);
    this.record(before);
    this.touch();
  }

  /** Records history for edits that were applied live (drags, typing). */
  record(before: Snapshot) {
    const after = this.snapshot();
    if (sameContent(before, after)) return;
    this.undoStack.push({ before, after });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Marks the doc changed (no history) and schedules a save. */
  touch() {
    this.dirty = true;
    this.emit();
    this.scheduleSave();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.apply(mergeSnapshots(entry.after, entry.before, this.snapshot()));
    this.redoStack.push(entry);
    this.touch();
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.apply(mergeSnapshots(entry.before, entry.after, this.snapshot()));
    this.undoStack.push(entry);
    this.touch();
  }

  private apply(s: Snapshot) {
    this.doc.items = s.items;
    this.doc.zones = s.zones;
  }

  /** Pauses saving and external merges during a gesture, so dragged objects stay stable. Returns the release fn. */
  hold(): () => void {
    this.holds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
      if (this.holds === 0) {
        if (this.dirty) this.scheduleSave();
        if (this.externalPending) void this.pullExternal();
      }
    };
  }

  private scheduleSave() {
    if (this.holds > 0) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), SAVE_DEBOUNCE_MS);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    await this.save();
  }

  private async save() {
    if (this.saving || this.holds > 0 || !this.dirty) return;
    this.saving = true;
    this.setSync('saving');
    try {
      for (let attempt = 0; this.dirty && attempt < 8; attempt++) {
        const next: Board = { ...structuredClone(this.doc), rev: this.base.rev + 1, updatedAt: new Date().toISOString() };
        this.dirty = false; // edits made while awaiting set it again
        const res = await this.backend.save(serializeBoard(next), this.base.rev);
        if (res.ok) {
          this.base = next;
          this.doc.rev = next.rev;
          this.doc.updatedAt = next.updatedAt;
        } else {
          this.integrate(parseBoard(res.disk));
          this.dirty = true;
        }
      }
      this.setSync(this.backend.kind === 'memory' ? 'memory' : 'saved');
    } catch (e) {
      this.dirty = true;
      this.lastError = e instanceof Error ? e.message : String(e);
      this.setSync('error');
    } finally {
      this.saving = false;
      if (this.dirty) {
        // Back off after a failure (e.g. lock held too long) instead of hammering the disk.
        if (this.sync === 'error') window.setTimeout(() => this.scheduleSave(), 2000);
        else this.scheduleSave();
      }
      if (this.externalPending) void this.pullExternal();
    }
  }

  private setSync(s: SyncState) {
    this.sync = s;
    this.emit();
  }

  /** Called when the watcher says board.json changed. */
  private async pullExternal() {
    if (this.holds > 0 || this.saving) {
      this.externalPending = true;
      return;
    }
    this.externalPending = false;
    let text: string | null;
    try {
      text = await this.backend.read();
    } catch {
      return;
    }
    if (!text) return;
    let remote: Board;
    try {
      remote = parseBoard(text);
    } catch {
      return; // half-written or hand-edited badly; the next change event will retry
    }
    if (remote.rev <= this.base.rev) return;
    this.integrate(remote);
    if (!sameContent(this.doc, remote)) {
      this.dirty = true;
      this.scheduleSave();
    }
  }

  private integrate(remote: Board) {
    const known = new Set([...this.base.items, ...this.doc.items].map((i) => i.id));
    const arrivals = remote.items.filter((i) => i.addedBy === 'agent' && !known.has(i.id)).map((i) => i.id);
    this.doc = mergeBoards(this.base, this.doc, remote);
    this.base = remote;
    this.emit();
    if (arrivals.length) for (const fn of this.arrivalListeners) fn(arrivals);
  }
}
