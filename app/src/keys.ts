// Keyboard shortcuts: defaults, the user's overrides, and matching key events
// to actions. Every place that shows a key reads it from here, so a rebind is
// reflected everywhere (tooltips, tour, hints).

export type Action =
  | 'note'
  | 'zone'
  | 'arrange'
  | 'selectAll'
  | 'deselect'
  | 'undo'
  | 'redo'
  | 'crop'
  | 'flip'
  | 'flipV'
  | 'focus'
  | 'duplicate'
  | 'front'
  | 'back'
  | 'delete'
  | 'fit'
  | 'fitSelection'
  | 'zoom100'
  | 'zoomIn'
  | 'zoomOut'
  | 'gray'
  | 'pan'
  | 'onTop'
  | 'openFolder';

export interface ActionDef {
  id: Action;
  label: string;
  group: 'Canvas' | 'Image' | 'View' | 'Window';
  defaults: string[];
  /** Held rather than pressed (pan: hold, then drag). Must be a single key without modifiers. */
  hold?: boolean;
}

// Defaults follow the most common binding in other image and design apps
// (Photoshop, Affinity, Krita for crop; Figma, tldraw, Excalidraw for flips,
// zoom and framing). Where no convention exists, the key is ours.
export const ACTIONS: ActionDef[] = [
  { id: 'note', label: 'New note', group: 'Canvas', defaults: ['N'] },
  { id: 'zone', label: 'Zone (around selection)', group: 'Canvas', defaults: ['F', 'Ctrl+Alt+G'] },
  { id: 'arrange', label: 'Arrange (tidy up)', group: 'Canvas', defaults: ['Ctrl+Alt+T'] },
  { id: 'selectAll', label: 'Select all', group: 'Canvas', defaults: ['Ctrl+A'] },
  { id: 'deselect', label: 'Deselect', group: 'Canvas', defaults: ['Escape'] },
  { id: 'undo', label: 'Undo', group: 'Canvas', defaults: ['Ctrl+Z'] },
  { id: 'redo', label: 'Redo', group: 'Canvas', defaults: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'crop', label: 'Crop', group: 'Image', defaults: ['C'] },
  { id: 'flip', label: 'Flip horizontally', group: 'Image', defaults: ['Shift+H'] },
  { id: 'flipV', label: 'Flip vertically', group: 'Image', defaults: ['Shift+V'] },
  { id: 'focus', label: 'Focus pin', group: 'Image', defaults: ['P'] },
  { id: 'duplicate', label: 'Duplicate', group: 'Image', defaults: ['Ctrl+D'] },
  { id: 'front', label: 'Bring to front', group: 'Image', defaults: ['Ctrl+Shift+]'] },
  { id: 'back', label: 'Send to back', group: 'Image', defaults: ['Ctrl+Shift+['] },
  { id: 'delete', label: 'Delete', group: 'Image', defaults: ['Delete', 'Backspace'] },
  { id: 'fit', label: 'Fit everything', group: 'View', defaults: ['Shift+1'] },
  { id: 'fitSelection', label: 'Zoom to selection', group: 'View', defaults: ['Shift+2'] },
  { id: 'zoom100', label: 'Zoom to 100%', group: 'View', defaults: ['Shift+0'] },
  { id: 'zoomIn', label: 'Zoom in', group: 'View', defaults: ['Ctrl+=', '='] },
  { id: 'zoomOut', label: 'Zoom out', group: 'View', defaults: ['Ctrl+-', '-'] },
  { id: 'gray', label: 'Grayscale view', group: 'View', defaults: ['G'] },
  { id: 'pan', label: 'Pan (hold, then drag)', group: 'View', defaults: ['Space'], hold: true },
  { id: 'onTop', label: 'Keep on top', group: 'Window', defaults: ['T'] },
  { id: 'openFolder', label: 'Open project folder', group: 'Window', defaults: ['Ctrl+O'] },
];

/** Left to the system clipboard; never bindable. */
export const RESERVED = new Set(['Ctrl+C', 'Ctrl+X', 'Ctrl+V']);

const STORAGE_KEY = 'board.keys';
/** Punctuation by physical key, so Shift doesn't turn "]" into "}" or "=" into "+". */
const CODE_KEYS: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: '=',
  NumpadSubtract: '-',
};
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS']);

/**
 * "Ctrl+Shift+Z" style name for a key event, or null for a lone modifier.
 * Letters and digits use the physical key so Shift doesn't turn "1" into "!".
 * Cmd on macOS counts as Ctrl, so defaults work on both.
 */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.key.length === 1 && /[a-z]/i.test(e.key) ? e.key.toUpperCase() : e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code]!;
  else if (e.key === ' ' || e.code === 'Space') key = 'Space';
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean);
  return [...mods, key].join('+');
}

const PRETTY: Record<string, string> = {
  Delete: 'Del',
  Backspace: '⌫',
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  '=': '+', // the zoom-in key is labelled + on most keyboards
};

/** "Ctrl+Shift+Z" → "Ctrl Shift Z" for key chips. */
export function display(combo: string): string {
  return combo
    .split('+')
    .map((p) => PRETTY[p] ?? p)
    .join(' ');
}

class Keymap {
  private overrides: Partial<Record<Action, string[]>> = {};
  private listeners = new Set<() => void>();

  constructor() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
      for (const def of ACTIONS) {
        const v = raw[def.id];
        if (Array.isArray(v)) this.overrides[def.id] = v.filter((c): c is string => typeof c === 'string' && !RESERVED.has(c));
      }
    } catch {
      // defaults
    }
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  bindings(action: Action): string[] {
    return this.overrides[action] ?? ACTIONS.find((a) => a.id === action)!.defaults;
  }

  isDefault(action: Action): boolean {
    return !this.overrides[action];
  }

  /** The first binding, formatted for a key chip; '' when unbound. */
  label(action: Action): string {
    const first = this.bindings(action)[0];
    return first ? display(first) : '';
  }

  /** "Note (N)" style tooltip text. */
  title(name: string, action: Action): string {
    const k = this.label(action);
    return k ? `${name} (${k})` : name;
  }

  actionFor(combo: string | null): Action | undefined {
    if (!combo) return undefined;
    return ACTIONS.find((a) => !a.hold && this.bindings(a.id).includes(combo))?.id;
  }

  /** True when this event is the pan key (held, no modifiers). */
  isPan(e: KeyboardEvent): boolean {
    const combo = comboFromEvent(e);
    return !!combo && this.bindings('pan').includes(combo);
  }

  /** Which action already uses this combo, if any. */
  owner(combo: string): Action | undefined {
    return ACTIONS.find((a) => this.bindings(a.id).includes(combo))?.id;
  }

  /** Assigns bindings; a combo taken by another action moves here. Returns the action it was taken from. */
  set(action: Action, combos: string[]): Action | undefined {
    let movedFrom: Action | undefined;
    for (const combo of combos) {
      const owner = this.owner(combo);
      if (owner && owner !== action) {
        this.overrides[owner] = this.bindings(owner).filter((c) => c !== combo);
        movedFrom = owner;
      }
    }
    this.overrides[action] = [...new Set(combos)];
    this.save();
    return movedFrom;
  }

  reset(action?: Action) {
    if (action) delete this.overrides[action];
    else this.overrides = {};
    this.save();
  }

  private save() {
    for (const def of ACTIONS) {
      const o = this.overrides[def.id];
      if (o && o.length === def.defaults.length && o.every((c, i) => c === def.defaults[i])) delete this.overrides[def.id];
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides));
    } catch {
      // per-machine convenience
    }
    for (const fn of this.listeners) fn();
    refreshKeyChips();
  }
}

export const keymap = new Keymap();

/** Updates every <kbd data-action="…"> on the page to the current binding. */
export function refreshKeyChips(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('kbd[data-action]')) {
    el.textContent = keymap.label(el.dataset.action as Action);
  }
}

/** A key chip that follows the user's binding for `action`. */
export function actionKbd(action: Action): HTMLElement {
  const k = document.createElement('kbd');
  k.dataset.action = action;
  k.textContent = keymap.label(action);
  return k;
}
