import { ZONE_COLORS, center, containsPoint, type Item, type Snapshot, type Zone } from '@board/format';
import { h } from './dom';
import { actionKbd, keymap, type Action } from './keys';
import { icon } from './icons';
import type { Store } from './store';
import type { BoardView } from './view';

type Entity = Item | Zone;

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * Right-hand panel for the selection. Rebuilt only when *which* thing is selected
 * changes, so typing is never interrupted by re-renders; values sync otherwise.
 */
export class Inspector {
  private key = '';
  private before: Snapshot | null = null;
  private pendingFocus: string | null = null;

  constructor(
    private el: HTMLElement,
    private store: Store,
    private view: BoardView,
  ) {
    view.onChange(() => this.update());
    keymap.onChange(() => {
      this.key = ''; // rebuild so key chips show the new bindings
      this.update();
    });
    view.onFocusField((field) => {
      this.pendingFocus = field;
      this.update();
    });
    // Field edits: snapshot on focus, live updates on input, one undo entry on blur.
    el.addEventListener('focusin', (e) => {
      if ((e.target as HTMLElement).dataset.field) this.before = store.snapshot();
    });
    el.addEventListener('focusout', (e) => {
      if ((e.target as HTMLElement).dataset.field && this.before) {
        store.record(this.before);
        this.before = null;
      }
    });
    el.addEventListener('input', (e) => this.onInput(e.target as HTMLInputElement | HTMLTextAreaElement));
    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (e.key === 'Escape' || (e.key === 'Enter' && t.tagName === 'INPUT')) t.blur();
      e.stopPropagation();
    });
  }

  private selected(): Entity[] {
    const sel = [...this.view.selection].map((id) => this.view.entity(id)).filter((e): e is Entity => !!e);
    // A single note is edited right on the canvas; a side panel would just be a second editor.
    return sel.length === 1 && 'kind' in sel[0]! && sel[0].kind === 'note' ? [] : sel;
  }

  private update() {
    const sel = this.selected();
    const key = sel.map((e) => `${e.id}${'kind' in e && e.kind === 'image' && e.crop ? ':c' : ''}`).join(',');
    if (key !== this.key) {
      this.key = key;
      this.build(sel);
    }
    this.sync(sel);
    if (this.pendingFocus) {
      const f = this.el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${this.pendingFocus}"]`);
      this.pendingFocus = null;
      if (f) {
        f.focus();
        f.select();
      }
    }
  }

  private build(sel: Entity[]) {
    this.el.hidden = sel.length === 0;
    if (!sel.length) {
      this.el.replaceChildren();
      return;
    }
    if (sel.length > 1) {
      this.el.replaceChildren(
        h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind', text: `${sel.length} selected` })),
        h(
          'div',
          { class: 'insp-actions stack' },
          this.action('arrange', 'Arrange in rows', 'arrange', () => this.view.arrange()),
          this.action('pin', 'Toggle focus', 'focus', () => this.view.togglePin()),
          this.action('zone', 'Zone around', 'zone', () => this.view.addZone()),
          this.action('trash', 'Delete', 'delete', () => this.view.deleteSelection(), true),
        ),
      );
      return;
    }

    const e = sel[0]!;
    if (!('kind' in e)) {
      this.el.replaceChildren(...this.zoneFields(e));
      return;
    }
    const head = h(
      'div',
      { class: 'insp-head' },
      h('span', { class: 'insp-kind', text: e.kind === 'image' ? 'Reference' : 'Note' }),
      h('span', { class: 'insp-id', text: e.id, title: 'AI tools refer to items by this id' }),
    );
    const by = e.addedBy === 'agent' ? `added by ${e.agent ?? 'an AI tool'}` : 'added by you';
    if (e.kind === 'image') {
      this.el.replaceChildren(
        head,
        h('div', { class: 'insp-meta', text: [`${e.srcW} × ${e.srcH}`, by, fmtDate(e.createdAt)].filter(Boolean).join(' · ') }),
        this.textarea('note', 'Note for AI', 'What should an AI take from this? e.g. "this lighting, but warmer"', 4),
        this.focusToggle(),
        this.textarea('caption', 'Caption', 'An AI tool writes a short caption the first time it looks.', 2, 'written by AI, editable'),
        this.input('tags', 'Tags', 'lighting, warm, ui'),
        ...(e.source ? [h('div', { class: 'insp-source', text: e.source })] : []),
        h(
          'div',
          { class: 'insp-actions' },
          this.action('crop', 'Crop', 'crop', () => this.view.startCrop()),
          this.action('flip', 'Flip H', 'flip', () => this.view.flip('x')),
          this.action('flipV', 'Flip V', 'flipV', () => this.view.flip('y')),
          this.action('trash', 'Delete', 'delete', () => this.view.deleteSelection(), true),
          e.crop ? this.plainAction('Reset crop', () => this.view.resetCrop()) : null,
        ),
      );
    } else {
      this.el.replaceChildren(
        head,
        h('div', { class: 'insp-meta', text: [by, fmtDate(e.createdAt)].filter(Boolean).join(' · ') }),
        this.textarea('text', 'Text', 'Rules, intent, vibes…', 6),
        this.focusToggle(),
        h('div', { class: 'insp-actions' }, this.action('trash', 'Delete', 'delete', () => this.view.deleteSelection(), true)),
      );
    }
  }

  private zoneFields(z: Zone): Node[] {
    const swatches = h(
      'div',
      { class: 'swatches', attrs: { role: 'radiogroup', 'aria-label': 'Zone color' } },
      ...ZONE_COLORS.map((c) => {
        const b = h('button', { class: 'swatch', data: { color: c }, title: c, attrs: { type: 'button', role: 'radio' } });
        // Look the zone up fresh: a merge with an agent's edits may have replaced the object.
        b.addEventListener('click', () => {
          const zone = this.view.entity(z.id);
          if (zone && !('kind' in zone)) this.store.commit(() => void (zone.color = c));
        });
        return b;
      }),
    );
    const selectContents = h('button', { class: 'btn-ghost', attrs: { type: 'button' } }, 'Select contents');
    selectContents.addEventListener('click', () => {
      const zone = this.view.entity(z.id);
      if (zone) this.view.select(this.store.doc.items.filter((i) => containsPoint(zone, center(i))).map((i) => i.id));
    });
    return [
      h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind', text: 'Zone' }), h('span', { class: 'insp-id', text: z.id })),
      this.input('name', 'Name', 'Palette, Layout, Avoid…'),
      this.textarea('meaning', 'What this zone means', 'Tell AI tools how to read it, e.g. "anti-references: never do this"', 3),
      h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Color' }), swatches),
      h(
        'div',
        { class: 'insp-actions' },
        selectContents,
        this.action('trash', 'Delete zone', 'delete', () => this.view.deleteSelection(), true),
      ),
      h('p', { class: 'insp-hint', text: 'Deleting a zone keeps the items inside it. Drag the label to move the zone with its contents.' }),
    ];
  }

  private label(text: string, sub?: string) {
    return h('span', { class: 'field-label', text }, sub ? h('em', { text: sub }) : null);
  }

  private textarea(field: string, label: string, placeholder: string, rows: number, sub?: string) {
    const ta = h('textarea', { data: { field }, attrs: { placeholder, rows: String(rows), spellcheck: 'true' } });
    return h('label', { class: 'field' }, this.label(label, sub), ta);
  }

  private input(field: string, label: string, placeholder: string) {
    const inp = h('input', { data: { field }, attrs: { placeholder, type: 'text', spellcheck: 'false' } });
    return h('label', { class: 'field' }, this.label(label), inp);
  }

  private focusToggle() {
    const b = h(
      'button',
      { class: 'toggle', data: { toggle: 'pinned' }, attrs: { type: 'button', 'aria-pressed': 'false' } },
      icon('pin'),
      h('span', { class: 'toggle-text' }, h('b', { text: 'Focus' }), h('small', { text: 'AI tools weigh focused items first' })),
      actionKbd('focus'),
    );
    b.addEventListener('click', () => this.view.togglePin());
    return b;
  }

  private plainAction(text: string, fn: () => void) {
    const b = h('button', { class: 'btn-ghost', attrs: { type: 'button' } }, h('span', { text }));
    b.addEventListener('click', fn);
    return b;
  }

  private action(ic: Parameters<typeof icon>[0], text: string, key: Action, fn: () => void, danger = false) {
    const b = h('button', { class: `btn-ghost${danger ? ' danger' : ''}`, attrs: { type: 'button' } }, icon(ic), h('span', { text }), actionKbd(key));
    b.addEventListener('click', fn);
    return b;
  }

  /** Pushes model values into fields that aren't being edited. */
  private sync(sel: Entity[]) {
    if (sel.length !== 1) return;
    const e = sel[0]!;
    const values: Record<string, string> =
      'kind' in e
        ? e.kind === 'image'
          ? { note: e.note ?? '', caption: e.caption ?? '', tags: (e.tags ?? []).join(', ') }
          : { text: e.text }
        : { name: e.name, meaning: e.note ?? '' };
    for (const f of this.el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]')) {
      if (f === document.activeElement) continue;
      const v = values[f.dataset.field!] ?? '';
      if (f.value !== v) f.value = v;
    }
    const pin = this.el.querySelector<HTMLElement>('[data-toggle="pinned"]');
    if (pin && 'kind' in e) pin.setAttribute('aria-pressed', String(!!e.pinned));
    if (!('kind' in e)) {
      for (const s of this.el.querySelectorAll<HTMLElement>('.swatch')) s.setAttribute('aria-checked', String(s.dataset.color === e.color));
    }
  }

  private onInput(f: HTMLInputElement | HTMLTextAreaElement) {
    const field = f.dataset.field;
    const e = this.selected()[0];
    if (!field || !e) return;
    const v = f.value;
    const opt = (s: string) => (s.trim() ? s : undefined);
    if (!('kind' in e)) {
      if (field === 'name') e.name = v;
      if (field === 'meaning') setOpt(e, 'note', opt(v));
    } else if (e.kind === 'image') {
      if (field === 'note') setOpt(e, 'note', opt(v));
      if (field === 'caption') setOpt(e, 'caption', opt(v));
      if (field === 'tags') {
        const tags = v.split(',').map((t) => t.trim()).filter(Boolean);
        setOpt(e, 'tags', tags.length ? tags : undefined);
      }
    } else if (field === 'text') {
      e.text = v;
    }
    this.store.touch();
  }
}

/** Sets or deletes an optional field so empty values don't linger in board.json. */
function setOpt<T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined) {
  if (v === undefined) delete o[k];
  else o[k] = v;
}
