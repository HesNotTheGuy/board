import '@fontsource/martian-mono/400.css';
import '@fontsource/martian-mono/500.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './styles.css';

import { createBoard, parseBoard, slugify } from '@board/format';
import { createBackend } from './backend';
import { Chrome } from './chrome';
import { Home } from './home';
import { bindIngest } from './ingest';
import { Inspector } from './inspector';
import { Store } from './store';
import { comboFromEvent, keymap, refreshKeyChips } from './keys';
import { ShortcutsPanel } from './shortcuts';
import { TitleBar } from './titlebar';
import { Tour } from './tour';
import { BoardView, isEditableTarget } from './view';

// Paths of recent project folders and the last open board live only in this
// machine's webview storage, never in board files.
const RECENTS_KEY = 'board.recents';
const LAST_KEY = 'board.last';
const MAX_RECENTS = 6;

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // convenience only
  }
}

/** The same folder can be spelled with / or \ and different case on Windows. */
const samePath = (a: string, b: string) => {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
};

const loadRecents = () => readJson<unknown[]>(RECENTS_KEY, []).filter((x): x is string => typeof x === 'string');
const saveRecent = (root: string) => writeJson(RECENTS_KEY, [root, ...loadRecents().filter((r) => r !== root)].slice(0, MAX_RECENTS));
const forgetRecent = (root: string) => writeJson(RECENTS_KEY, loadRecents().filter((r) => r !== root));

async function boot() {
  const backend = await createBackend();
  const store = new Store(backend);
  const $ = (id: string) => document.getElementById(id)!;
  const view = new BoardView({ viewport: $('viewport'), world: $('world'), zones: $('zones'), items: $('items'), overlay: $('overlay') }, store, backend);
  new Inspector($('inspector'), store, view);

  let open: { root: string; folder: string; library: boolean } | null = null;
  const displayName = () => store.doc.title ?? open?.folder ?? 'Board';

  async function openBoard(root: string, opts: { title?: string } = {}) {
    try {
      // Finish writing the current board before the backend switches folders.
      await store.flush();
      const { text, name, library } = await backend.open(root);
      let board;
      try {
        board = text ? parseBoard(text) : createBoard();
      } catch {
        // Never load (and later overwrite) a board we couldn't parse.
        chrome.toast(`Couldn't read ${name}/.board/board.json. Fix or move it, then reopen.`, 'error');
        return;
      }
      if (opts.title && !board.title) board.title = opts.title;
      store.load(board);
      if (opts.title) store.touch(); // persist the new board right away
      open = { root, folder: name, library };
      view.active = true;
      document.body.dataset.open = 'true';
      home.hide();
      view.attach(root);
      writeJson(LAST_KEY, root);
      // First board ever opened: show where everything is.
      if (!tour.done) window.setTimeout(() => tour.start(), 400);
      if (backend.kind === 'tauri' && !library) saveRecent(root);
      void backend.setTitle(displayName());
      chrome.update();
    } catch (e) {
      if (backend.kind === 'tauri') forgetRecent(root);
      chrome.toast(e instanceof Error ? e.message : String(e), 'error');
      if (!open) void home.show();
    }
  }

  async function newBoard(title: string) {
    const name = title.trim() || 'Untitled board';
    try {
      await openBoard(await backend.createBoard(slugify(name)), { title: name });
    } catch (e) {
      chrome.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  const openFolder = async () => {
    const root = await backend.pickFolder();
    if (root) await openBoard(root);
  };

  async function moveToProject() {
    if (!open?.library) return;
    const target = await backend.pickFolder();
    if (!target) return;
    try {
      await store.flush();
      const root = await backend.moveBoard(target);
      await openBoard(root);
      chrome.toast(`Moved into ${open?.folder ?? 'the project'}. AI tools working in that folder see it now.`);
    } catch (e) {
      chrome.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  /** Deleting a board (never a project folder) sends it to the Recycle Bin; if it's open, close it first. */
  async function deleteBoard(root: string, title: string) {
    const maybeOpen = open !== null && samePath(open.root, root);
    try {
      if (maybeOpen) await store.flush();
      const wasOpen = (await backend.deleteBoard(root)) || maybeOpen;
      if (wasOpen) {
        open = null;
        store.load(createBoard());
        view.active = false;
        document.body.dataset.open = 'false';
        void backend.setTitle('Board');
      }
      const last = readJson<string | null>(LAST_KEY, null);
      if (last && samePath(last, root)) writeJson(LAST_KEY, null);
      chrome.toast(`Moved “${title}” to the ${/Windows/i.test(navigator.userAgent) ? 'Recycle Bin' : 'Trash'}`);
      chrome.update();
    } catch (e) {
      chrome.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  const home = new Home({
    backend,
    openBoard: (root) => void openBoard(root),
    newBoard: (title) => void newBoard(title),
    openFolder: () => void openFolder(),
    recentProjects: () => (backend.kind === 'tauri' ? loadRecents() : []),
    deleteBoard,
    forgetProject: (root) => {
      forgetRecent(root);
      if (readJson<string | null>(LAST_KEY, null) === root) writeJson(LAST_KEY, null);
    },
    hasBoard: () => open !== null,
    onToggle: (visible) => {
      view.active = !visible && open !== null;
      chrome?.update();
    },
  });

  const chrome = new Chrome({
    store,
    view,
    showHome: () => void home.show(),
    displayName,
    isLibrary: () => open?.library ?? false,
    rename: (title) => {
      if (title) store.doc.title = title;
      else delete store.doc.title;
      store.touch();
      void backend.setTitle(displayName());
    },
    moveToProject: () => void moveToProject(),
  });

  store.onArrivals((ids) => {
    const n = ids.length;
    const names = [...new Set(store.doc.items.filter((i) => ids.includes(i.id)).map((i) => i.agent ?? 'An AI tool'))];
    const who = names.length === 1 ? names[0] : 'AI tools';
    chrome.toast(`${who} added ${n} item${n === 1 ? '' : 's'} to the board`, 'agent', {
      label: 'Show',
      run: () => {
        view.select(ids);
        view.fit('selection');
      },
    });
  });

  bindIngest($('viewport'), $('drop-veil'), {
    store,
    backend,
    view,
    toast: (m, tone) => chrome.toast(m, tone),
    isOpen: () => open !== null && !home.visible,
  });

  // Finish saving before the window goes away (our close button, Alt+F4, taskbar close).
  const tour = new Tour();
  const startTour = () => {
    if (open && !home.visible) tour.start();
    else chrome.toast('Open a board first, then the tour can point at everything.');
  };
  const shortcuts = new ShortcutsPanel();
  const titlebar = new TitleBar(backend, (m) => chrome.toast(m), () => store.flush(), startTour, () => shortcuts.show());
  await titlebar.init();

  // Window-level shortcuts (canvas ones live in BoardView); both read the user's keymap.
  window.addEventListener('keydown', (e) => {
    if (isEditableTarget(e.target) || e.repeat || shortcuts.open) return;
    const action = keymap.actionFor(comboFromEvent(e));
    if (action === 'openFolder') {
      e.preventDefault();
      void openFolder();
    } else if (action === 'onTop') {
      e.preventDefault();
      titlebar.toggleOnTop();
    }
  });
  refreshKeyChips();

  window.addEventListener('beforeunload', () => void store.flush());

  if (backend.kind === 'memory') {
    document.body.dataset.host = 'browser';
    $('browser-note').hidden = false;
    if (new URLSearchParams(location.search).has('demo')) await openBoard('demo-project');
    else void home.show();
    return;
  }

  const first = (await backend.launchRoot()) ?? readJson<string | null>(LAST_KEY, null);
  if (first) await openBoard(first);
  if (!open) void home.show();
}

void boot();
