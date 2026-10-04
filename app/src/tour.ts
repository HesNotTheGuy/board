import { h, kbd } from './dom';
import { actionKbd } from './keys';

const DONE_KEY = 'board.tourDone';

interface Step {
  /** The element to point at; steps whose target is missing or hidden are skipped. */
  target: () => Element | null;
  title: string;
  body: () => (string | HTMLElement)[];
}

const $ = (sel: string) => document.querySelector(sel);
const visible = (el: Element | null): el is Element => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
};

const STEPS: Step[] = [
  {
    target: () => $('#viewport'),
    title: 'The canvas',
    body: () => ['Paste images with ', kbd('Ctrl V'), ' or drop them here, from your files or a browser. Hold ', actionKbd('pan'), ' and drag to move around, scroll to zoom.'],
  },
  {
    target: () => $('#toolbar'),
    title: 'Tools',
    body: () => ['Notes, zones to group things, focus pins for what matters most, arrange, fit to screen, grayscale, undo. Hover any button for its name and shortcut; change shortcuts in settings.'],
  },
  {
    target: () => $('#items .item.image'),
    title: 'References',
    body: () => ['Click an image to add a note about it (“this lighting, but warmer”), pin it as focus, or flip it. Drag the corner marks to resize.'],
  },
  {
    target: () => $('#home-button'),
    title: 'All boards',
    body: () => ['Switch boards, start a new one, or open a project folder. A board doesn’t need a project; you can move it into one later.'],
  },
  {
    target: () => $('#board-name'),
    title: 'Name and saving',
    body: () => ['Click the name to rename the board. The dot next to it shows that everything is saved; there is no save button.'],
  },
  {
    target: () => $('#ai-chip'),
    title: 'MCP access',
    body: () => ['AI tools connect to Board over MCP. They can’t see your boards until you allow it here: off, view only, or view and add. The tool also has to be set up with Board’s MCP server; see the README.'],
  },
  {
    target: () => $('#pin-window'),
    title: 'Keep on top',
    body: () => ['Pins the window above everything else, handy while you work in another app. Shortcut ', actionKbd('onTop'), '.'],
  },
  {
    target: () => $('#open-settings'),
    title: 'Settings',
    body: () => ['MCP access, canvas opacity for tracing over other windows, keep on top, keyboard shortcuts, and this tour again.'],
  },
];

/** A short spotlight walkthrough of the real controls. Runs once, replayable from settings. */
export class Tour {
  private el = document.getElementById('tour')!;
  private steps: Step[] = [];
  private i = 0;
  private onKey = (e: KeyboardEvent) => {
    if (this.el.hidden) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') this.end();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') this.go(this.i + 1);
    else if (e.key === 'ArrowLeft') this.go(this.i - 1);
    e.preventDefault();
  };

  constructor() {
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', () => !this.el.hidden && this.render());
  }

  get done(): boolean {
    try {
      return localStorage.getItem(DONE_KEY) === 'true';
    } catch {
      return true; // no storage: don't nag every launch
    }
  }

  start() {
    this.steps = STEPS.filter((s) => visible(s.target()));
    if (!this.steps.length) return;
    this.el.hidden = false;
    document.body.dataset.tour = 'true';
    this.go(0);
  }

  private go(i: number) {
    if (i < 0) return;
    if (i >= this.steps.length) return this.end();
    this.i = i;
    this.render();
  }

  private end() {
    this.el.hidden = true;
    delete document.body.dataset.tour;
    try {
      localStorage.setItem(DONE_KEY, 'true');
    } catch {
      // fine
    }
  }

  private render() {
    const step = this.steps[this.i]!;
    const target = step.target();
    const r = target?.getBoundingClientRect() ?? new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0);
    // Big targets (the canvas) get an inset frame; small ones a padded ring.
    const big = r.width > innerWidth * 0.6;
    const pad = big ? -16 : 6;
    const spot = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };

    const last = this.i === this.steps.length - 1;
    const back = h('button', { class: 'btn-ghost', text: 'Back', attrs: { type: 'button' } });
    back.disabled = this.i === 0;
    back.addEventListener('click', () => this.go(this.i - 1));
    const next = h('button', { class: 'btn-primary small', text: last ? 'Done' : 'Next', attrs: { type: 'button' } });
    next.addEventListener('click', () => this.go(this.i + 1));
    const skip = h('button', { class: 'tour-skip', text: 'Skip tour', attrs: { type: 'button' } });
    skip.addEventListener('click', () => this.end());

    const card = h(
      'div',
      { class: 'tour-card', attrs: { role: 'dialog', 'aria-label': step.title } },
      h('div', { class: 'tour-count', text: `${this.i + 1} / ${this.steps.length}` }),
      h('h2', { text: step.title }),
      h('p', {}, ...step.body()),
      h('div', { class: 'tour-actions' }, skip, h('span', { class: 'tour-gap' }), back, next),
    );
    const ring = h('div', { class: 'tour-spot', style: `left:${spot.x}px;top:${spot.y}px;width:${spot.w}px;height:${spot.h}px` });
    this.el.replaceChildren(ring, card);

    // Place the card beside the spotlight, preferring below, then above, then centered; keep it on screen.
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const gap = 14;
    let x = Math.min(Math.max(12, spot.x + spot.w / 2 - cw / 2), innerWidth - cw - 12);
    let y: number;
    if (big) {
      x = innerWidth / 2 - cw / 2;
      y = innerHeight / 2 - ch / 2;
    } else if (spot.y + spot.h + gap + ch < innerHeight - 12) {
      y = spot.y + spot.h + gap;
    } else if (spot.y - gap - ch > 12) {
      y = spot.y - gap - ch;
    } else {
      y = innerHeight / 2 - ch / 2;
    }
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    next.focus();
  }
}
