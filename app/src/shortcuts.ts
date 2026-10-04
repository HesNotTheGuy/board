import { h } from './dom';
import { icon } from './icons';
import { ACTIONS, RESERVED, comboFromEvent, display, keymap, type Action } from './keys';

/**
 * The keyboard shortcuts screen: click a shortcut, press the new keys.
 * Esc cancels a recording; a combo used elsewhere moves here (and says so).
 */
export class ShortcutsPanel {
  private el = h('section', { class: 'shortcuts', attrs: { role: 'dialog', 'aria-label': 'Keyboard shortcuts' } });
  /** Which binding is being recorded: an action plus the index it replaces (-1 = adding). */
  private recording: { action: Action; index: number } | null = null;
  private notice = '';

  constructor() {
    this.el.hidden = true;
    document.getElementById('app')!.append(this.el);
    // Capture phase, so a recorded key never also triggers its old action.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close(); // click on the backdrop
    });
  }

  get open() {
    return !this.el.hidden;
  }

  show() {
    this.el.hidden = false;
    this.notice = '';
    this.render();
  }

  close() {
    this.recording = null;
    this.el.hidden = true;
  }

  private onKey(e: KeyboardEvent) {
    if (!this.open) return;
    if (!this.recording) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      }
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
      this.recording = null;
      this.notice = '';
      return this.render();
    }
    const combo = comboFromEvent(e);
    if (!combo) return; // waiting for a key to go with the modifiers
    const { action, index } = this.recording;
    const def = ACTIONS.find((a) => a.id === action)!;
    if (RESERVED.has(combo)) {
      this.notice = `${display(combo)} is kept for copy and paste.`;
      return this.render();
    }
    if (def.hold && combo.includes('+')) {
      this.notice = 'Pan needs a single key you can hold, without Ctrl, Alt or Shift.';
      return this.render();
    }
    const list = [...keymap.bindings(action)];
    if (index < 0) list.push(combo);
    else list[index] = combo;
    const from = keymap.set(action, list);
    this.notice = from ? `${display(combo)} moved here from “${ACTIONS.find((a) => a.id === from)!.label}”.` : '';
    this.recording = null;
    this.render();
  }

  private chip(action: Action, combo: string, index: number) {
    const recording = this.recording?.action === action && this.recording.index === index;
    const set = h(
      'button',
      { class: `key-chip${recording ? ' recording' : ''}`, title: 'Click, then press new keys', attrs: { type: 'button' } },
      recording ? 'Press keys…' : display(combo),
    );
    set.addEventListener('click', () => {
      this.recording = { action, index };
      this.notice = '';
      this.render();
    });
    const remove = h('button', { class: 'key-remove', title: 'Remove this shortcut', attrs: { type: 'button', 'aria-label': `Remove ${display(combo)}` } }, icon('close'));
    remove.addEventListener('click', () => {
      keymap.set(action, keymap.bindings(action).filter((_, i) => i !== index));
      this.render();
    });
    return h('span', { class: 'key-slot' }, set, recording ? null : remove);
  }

  private render() {
    const rows: Node[] = [];
    let group = '';
    for (const def of ACTIONS) {
      if (def.group !== group) {
        group = def.group;
        rows.push(h('h3', { text: group }));
      }
      const combos = keymap.bindings(def.id);
      const addingHere = this.recording?.action === def.id && this.recording.index < 0;
      const add = h('button', { class: `key-add${addingHere ? ' recording' : ''}`, title: 'Add another shortcut', attrs: { type: 'button' } }, addingHere ? 'Press keys…' : '+');
      add.addEventListener('click', () => {
        this.recording = { action: def.id, index: -1 };
        this.notice = '';
        this.render();
      });
      const reset = h('button', { class: 'key-reset', title: 'Back to default', attrs: { type: 'button' } }, icon('undo'));
      reset.hidden = keymap.isDefault(def.id);
      reset.addEventListener('click', () => {
        keymap.reset(def.id);
        this.render();
      });
      rows.push(
        h(
          'div',
          { class: 'key-row' },
          h('span', { class: 'key-name', text: def.label }),
          h('span', { class: 'key-chips' }, ...combos.map((c, i) => this.chip(def.id, c, i)), add, reset),
        ),
      );
    }

    const close = h('button', { class: 'tb-icon', attrs: { type: 'button', 'aria-label': 'Close' } }, icon('close'));
    close.addEventListener('click', () => this.close());
    const resetAll = h('button', { class: 'btn-ghost', text: 'Reset all', attrs: { type: 'button' } });
    resetAll.addEventListener('click', () => {
      keymap.reset();
      this.notice = 'All shortcuts are back to their defaults.';
      this.render();
    });

    this.el.replaceChildren(
      h(
        'div',
        { class: 'shortcuts-card' },
        h('div', { class: 'settings-head' }, h('span', { class: 'insp-kind', text: 'Keyboard shortcuts' }), close),
        h('p', { class: 'settings-help dim', text: 'Click a shortcut and press the new keys. Esc cancels.' }),
        h('div', { class: 'key-list' }, ...rows),
        h('p', { class: `key-notice${this.notice ? '' : ' empty'}`, text: this.notice || ' ' }),
        h(
          'div',
          { class: 'shortcuts-foot' },
          h('p', { class: 'settings-help dim', text: 'Always: Ctrl V paste · arrow keys nudge (Shift for 10px) · wheel zoom · middle-drag pan.' }),
          resetAll,
        ),
      ),
    );
  }
}
