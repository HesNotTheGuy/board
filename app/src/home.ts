import type { Backend, LibraryEntry } from './backend';
import { h } from './dom';
import { icon } from './icons';

export interface HomeDeps {
  backend: Backend;
  openBoard: (root: string) => void;
  newBoard: (title: string) => void;
  openFolder: () => void;
  recentProjects: () => string[];
  /** Sends a standalone board to the Recycle Bin / Trash. */
  deleteBoard: (root: string, title: string) => Promise<void>;
  /** Drops a project from the recent list; its folder is not touched. */
  forgetProject: (root: string) => void;
  /** Whether a board is open behind the home screen (so it can be dismissed). */
  hasBoard: () => boolean;
  /** Called when the home screen opens or closes, so the canvas can pause its shortcuts. */
  onToggle: (visible: boolean) => void;
}

interface Row {
  title: string;
  meta: string;
  root: string;
}

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const BIN = /Windows/i.test(navigator.userAgent) ? 'Recycle Bin' : 'Trash';

function ago(seconds: number): string {
  const s = Math.max(0, Date.now() / 1000 - seconds);
  if (!seconds) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * The start screen: new standalone board first (ideation often comes before
 * there's a project), project folders second, then both kinds of recents.
 */
export class Home {
  private el = document.getElementById('welcome')!;
  private nameInput = document.getElementById('new-board-name') as HTMLInputElement;
  private back = document.getElementById('home-back')!;
  /** The board row currently asking "delete?", if any. */
  private confirming: string | null = null;

  constructor(private deps: HomeDeps) {
    document.getElementById('new-board')!.addEventListener('submit', (e) => {
      e.preventDefault();
      deps.newBoard(this.nameInput.value);
      this.nameInput.value = '';
    });
    document.getElementById('welcome-open')!.addEventListener('click', () => deps.openFolder());
    this.back.addEventListener('click', () => this.hide());
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.visible) return;
      if (this.confirming) {
        e.preventDefault();
        this.confirming = null;
        void this.refresh();
      } else if (deps.hasBoard()) {
        e.preventDefault();
        this.hide();
      }
    });
  }

  get visible() {
    return !this.el.hidden;
  }

  async show() {
    this.el.hidden = false;
    document.body.dataset.home = 'true';
    this.deps.onToggle(true);
    this.confirming = null;
    this.nameInput.focus();
    await this.refresh();
  }

  hide() {
    this.el.hidden = true;
    delete document.body.dataset.home;
    this.deps.onToggle(false);
  }

  /** Re-reads both lists (after a delete, or when shown). */
  async refresh() {
    this.back.hidden = !this.deps.hasBoard();
    let library: LibraryEntry[] = [];
    try {
      library = await this.deps.backend.listLibrary();
    } catch {
      // show projects anyway
    }
    this.renderBoards(
      library.map((b) => ({
        title: b.title ?? b.slug,
        meta: [`${b.items} item${b.items === 1 ? '' : 's'}`, ago(b.modified)].filter(Boolean).join(' · '),
        root: b.root,
      })),
    );
    const projects = this.deps.recentProjects();
    this.renderProjects(projects.map((root) => ({ title: basename(root), meta: root, root })));
    document.getElementById('home-empty')!.hidden = library.length + projects.length > 0;
  }

  private openButton(r: Row) {
    const b = h('button', { class: 'recent', attrs: { type: 'button' }, title: r.meta }, h('b', { text: r.title }), h('span', { text: r.meta }));
    b.addEventListener('click', () => this.deps.openBoard(r.root));
    return b;
  }

  private renderBoards(rows: Row[]) {
    const list = document.getElementById('library-list')!;
    list.closest('section')!.hidden = rows.length === 0;
    list.replaceChildren(
      ...rows.map((r) => {
        if (this.confirming === r.root) {
          // Two-step delete: the row itself asks, so there's no surprise dialog.
          const yes = h('button', { class: 'row-confirm danger', text: 'Delete', attrs: { type: 'button' } });
          const no = h('button', { class: 'row-confirm', text: 'Cancel', attrs: { type: 'button' } });
          yes.addEventListener('click', async () => {
            yes.disabled = true;
            await this.deps.deleteBoard(r.root, r.title);
            this.confirming = null;
            await this.refresh();
          });
          no.addEventListener('click', () => {
            this.confirming = null;
            void this.refresh();
          });
          const row = h(
            'li',
            { class: 'row confirming' },
            h('span', { class: 'row-question' }, h('b', { text: `Delete “${r.title}”?` }), h('small', { text: `It goes to the ${BIN}, images and all.` })),
            h('span', { class: 'row-actions' }, no, yes),
          );
          queueMicrotask(() => no.focus());
          return row;
        }
        const del = h('button', { class: 'row-action', title: `Delete board (moves it to the ${BIN})`, attrs: { type: 'button', 'aria-label': `Delete ${r.title}` } }, icon('trash'));
        del.addEventListener('click', () => {
          this.confirming = r.root;
          void this.refresh();
        });
        return h('li', { class: 'row' }, this.openButton(r), del);
      }),
    );
  }

  private renderProjects(rows: Row[]) {
    const list = document.getElementById('recents')!;
    list.closest('section')!.hidden = rows.length === 0;
    list.replaceChildren(
      ...rows.map((r) => {
        const forget = h(
          'button',
          { class: 'row-action', title: 'Remove from this list (the folder and its board are not touched)', attrs: { type: 'button', 'aria-label': `Remove ${r.title} from recent projects` } },
          icon('close'),
        );
        forget.addEventListener('click', () => {
          this.deps.forgetProject(r.root);
          void this.refresh();
        });
        return h('li', { class: 'row' }, this.openButton(r), forget);
      }),
    );
  }
}
