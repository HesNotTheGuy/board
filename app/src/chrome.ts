import { h } from './dom';
import { icon, type IconName } from './icons';
import { keymap, type Action } from './keys';
import type { Store, SyncState } from './store';
import type { BoardView } from './view';

// Only about saving to disk (MCP access is the separate chip). Saved is just a quiet dot;
// words appear only when something deserves attention.
const STATUS_TEXT: Record<SyncState, string> = {
  idle: '',
  saving: 'saving…',
  saved: '',
  error: 'not saved',
  memory: 'preview, not saved',
};

interface ToolDef {
  id: string;
  icon: IconName;
  label: string;
  action?: Action;
  run: () => void;
  toggle?: () => boolean;
  enabled?: () => boolean;
}

export interface ChromeDeps {
  store: Store;
  view: BoardView;
  showHome: () => void;
  /** Board title, falling back to the folder name. */
  displayName: () => string;
  /** True for standalone boards (offered "Move to project…"). */
  isLibrary: () => boolean;
  rename: (title: string) => void;
  moveToProject: () => void;
}

/** Top bar, bottom toolbar and toasts. */
export class Chrome {
  private toolButtons = new Map<string, { def: ToolDef; el: HTMLButtonElement }>();
  private status = document.getElementById('status')!;
  private zoom: HTMLButtonElement;
  private toasts = document.getElementById('toasts')!;
  private hint = document.getElementById('hint')!;
  private nameBtn = document.getElementById('board-name') as HTMLButtonElement;
  private moveBtn = document.getElementById('move-board') as HTMLButtonElement;

  constructor(private deps: ChromeDeps) {
    const { view, store } = deps;
    const groups: ToolDef[][] = [
      [
        { id: 'note', icon: 'note', label: 'Note', action: 'note', run: () => view.addNote() },
        { id: 'zone', icon: 'zone', label: 'Zone', action: 'zone', run: () => view.addZone() },
        {
          id: 'pin',
          icon: 'pin',
          label: 'Focus',
          action: 'focus',
          run: () => view.togglePin(),
          enabled: () => view.selectedItems().length > 0,
        },
        { id: 'arrange', icon: 'arrange', label: 'Arrange', action: 'arrange', run: () => view.arrange() },
        { id: 'delete', icon: 'trash', label: 'Delete', action: 'delete', run: () => view.deleteSelection(), enabled: () => view.selection.size > 0 },
      ],
      [
        { id: 'fit', icon: 'fit', label: 'Fit everything', action: 'fit', run: () => view.fit('all') },
        { id: 'gray', icon: 'gray', label: 'Grayscale', action: 'gray', run: () => view.setGrayscale(!view.grayscale), toggle: () => view.grayscale },
      ],
      [
        { id: 'undo', icon: 'undo', label: 'Undo', action: 'undo', run: () => store.undo(), enabled: () => store.canUndo },
        { id: 'redo', icon: 'redo', label: 'Redo', action: 'redo', run: () => store.redo(), enabled: () => store.canRedo },
      ],
    ];

    const bar = document.getElementById('toolbar')!;
    for (const group of groups) {
      const g = h('div', { class: 'tool-group' });
      for (const def of group) {
        const el = h(
          'button',
          {
            class: 'tool',
            data: { tool: def.id },
            title: def.label,
            attrs: { type: 'button', 'aria-label': def.label },
          },
          icon(def.icon),
        );
        if (def.toggle) el.setAttribute('aria-pressed', 'false');
        // Keep keyboard focus on the canvas so shortcuts keep working after a click.
        el.addEventListener('mousedown', (e) => e.preventDefault());
        el.addEventListener('click', () => {
          def.run();
          this.update();
        });
        g.append(el);
        this.toolButtons.set(def.id, { def, el });
      }
      bar.append(g);
    }
    // Zoom readout at the end; click for 100%.
    this.zoom = h('button', { class: 'zoom', title: 'Zoom: click for 100%', attrs: { type: 'button' } });
    this.zoom.addEventListener('mousedown', (e) => e.preventDefault());
    this.zoom.addEventListener('click', () => view.zoomTo(1));
    bar.append(h('div', { class: 'tool-group' }, this.zoom));
    document.getElementById('home-button')!.addEventListener('click', () => deps.showHome());

    view.onChange(() => this.update());
    store.on(() => this.update());
    keymap.onChange(() => this.update());
    this.nameBtn.addEventListener('click', () => this.beginRename());
    this.moveBtn.addEventListener('click', () => deps.moveToProject());
  }

  /** Swaps the board name for an input; Enter or blur saves, Escape cancels. */
  private beginRename() {
    if (document.body.dataset.open !== 'true') return;
    const input = h('input', { class: 'project rename', attrs: { type: 'text', maxlength: '80', 'aria-label': 'Board name' } });
    input.value = this.deps.displayName();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      if (save && input.value.trim() !== this.deps.displayName()) this.deps.rename(input.value.trim());
      input.replaceWith(this.nameBtn);
      this.update();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    this.nameBtn.replaceWith(input);
    input.focus();
    input.select();
  }

  update() {
    const { store, view } = this.deps;
    const doc = store.doc;
    this.status.dataset.state = store.sync;
    this.status.querySelector('b')!.textContent = STATUS_TEXT[store.sync];
    this.status.title = store.sync === 'error' ? store.lastError : store.sync === 'saved' ? 'Saved' : '';
    const images = doc.items.filter((i) => i.kind === 'image').length;
    const notes = doc.items.length - images;
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    this.nameBtn.title = `Rename board · ${plural(images, 'image')}, ${plural(notes, 'note')}, ${plural(doc.zones.length, 'zone')}`;
    this.zoom.textContent = `${Math.round(view.cam.zoom * 100)}%`;
    for (const { def, el } of this.toolButtons.values()) {
      el.title = def.action ? keymap.title(def.label, def.action) : def.label;
      if (def.toggle) el.setAttribute('aria-pressed', String(def.toggle()));
      if (def.enabled) el.disabled = !def.enabled();
    }
    this.hint.hidden = doc.items.length > 0 || doc.zones.length > 0 || document.body.dataset.open !== 'true';
    const open = document.body.dataset.open === 'true';
    this.nameBtn.textContent = open ? this.deps.displayName() : 'Board';
    this.moveBtn.hidden = !open || !this.deps.isLibrary();
  }

  toast(msg: string, tone: 'info' | 'agent' | 'error' = 'info', action?: { label: string; run: () => void }) {
    const t = h('div', { class: `toast ${tone}${action ? ' actionable' : ''}` }, h('i'), h('span', { text: msg }), action && h('u', { text: action.label }));
    if (action) t.addEventListener('click', action.run);
    this.toasts.append(t);
    window.setTimeout(() => t.classList.add('out'), tone === 'error' ? 6000 : 3200);
    window.setTimeout(() => t.remove(), tone === 'error' ? 6400 : 3600);
  }
}
