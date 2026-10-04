import type { Backend, McpAccess } from './backend';
import { h } from './dom';
import { icon } from './icons';
import { actionKbd, keymap } from './keys';

const OPACITY_KEY = 'board.opacity';
const ON_TOP_KEY = 'board.onTop';
const MIN_OPACITY = 0.2;

const ACCESS: { mode: McpAccess; label: string; help: string }[] = [
  { mode: 'off', label: 'Off', help: 'AI tools connected over MCP get nothing from Board.' },
  { mode: 'read', label: 'View only', help: 'AI tools connected over MCP can read your boards and see the images, but change nothing.' },
  { mode: 'write', label: 'View & add', help: 'AI tools connected over MCP can also add their work (screenshots, generated images, notes) to your boards.' },
];

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // per-machine convenience only
  }
}

/**
 * Our own title bar (the OS one is turned off on Windows): drag to move,
 * window buttons, keep-on-top pin, settings, and the MCP access chip.
 */
export class TitleBar {
  onTop = false;
  private access: McpAccess = 'off';
  private opacity = 1;
  /** Opacity needs a transparent window, which we only make on Windows for now. */
  private readonly transparent: boolean;
  private panel = document.getElementById('settings')!;
  private chip = document.getElementById('ai-chip')!;
  private pin = document.getElementById('pin-window')!;
  private gear = document.getElementById('open-settings')!;
  private maxBtn = document.getElementById('win-max')!;

  constructor(
    private backend: Backend,
    private toast: (msg: string) => void,
    beforeClose: () => Promise<void>,
    private startTour: () => void,
    private openShortcuts: () => void,
  ) {
    const win = backend.window;
    this.transparent = !!win && /Windows/i.test(navigator.userAgent);
    document.body.dataset.chrome = win && this.transparent ? 'custom' : 'native';

    this.pin.append(icon('pushpin'));
    this.gear.append(icon('gear'));
    document.getElementById('win-min')!.append(icon('minimize'));
    this.maxBtn.append(icon('maximize'));
    document.getElementById('win-close')!.append(icon('close'));

    this.pin.addEventListener('click', () => this.toggleOnTop());
    this.gear.addEventListener('click', () => (this.panel.hidden ? this.openSettings() : this.closeSettings()));
    this.chip.addEventListener('click', () => this.openSettings());
    for (const b of [this.pin, this.gear, this.chip]) b.addEventListener('mousedown', (e) => e.preventDefault());

    if (win) {
      document.getElementById('win-min')!.addEventListener('click', () => void win.minimize());
      this.maxBtn.addEventListener('click', () => void win.toggleMaximize());
      document.getElementById('win-close')!.addEventListener('click', () => void win.close());
      void win.onResized(() => void this.syncMaximized());
      void win.onCloseRequested(beforeClose);
      void this.syncMaximized();
    }

    keymap.onChange(() => this.render());

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) {
        e.stopImmediatePropagation();
        this.closeSettings();
      }
    }, true);
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!this.panel.hidden && !this.panel.contains(t) && !this.gear.contains(t) && !this.chip.contains(t)) this.closeSettings();
    });
  }

  /** Restores saved preferences and reads the MCP access setting from disk. */
  async init() {
    this.setOpacity(read(OPACITY_KEY, 1), false);
    if (read(ON_TOP_KEY, false)) await this.setOnTop(true, false);
    try {
      this.access = await this.backend.getMcpAccess();
    } catch {
      this.access = 'off';
    }
    this.render();
  }

  toggleOnTop() {
    void this.setOnTop(!this.onTop, true);
  }

  private async setOnTop(on: boolean, announce: boolean) {
    this.onTop = on;
    write(ON_TOP_KEY, on);
    await this.backend.setAlwaysOnTop(on);
    if (announce) this.toast(on ? 'Kept on top of other windows' : 'No longer kept on top');
    this.render();
  }

  private setOpacity(v: number, save = true) {
    this.opacity = Math.min(1, Math.max(MIN_OPACITY, Number.isFinite(v) ? v : 1));
    document.documentElement.style.setProperty('--canvas-opacity', this.transparent ? String(this.opacity) : '1');
    if (save) write(OPACITY_KEY, this.opacity);
  }

  private async setAccess(mode: McpAccess) {
    try {
      await this.backend.setMcpAccess(mode);
      this.access = mode;
      this.toast(mode === 'off' ? 'MCP access is off' : mode === 'read' ? 'MCP: AI tools can now view your boards' : 'MCP: AI tools can now view and add to your boards');
    } catch (e) {
      this.toast(`Couldn't save the setting: ${e instanceof Error ? e.message : e}`);
    }
    this.render();
  }

  private async syncMaximized() {
    const max = (await this.backend.window?.isMaximized()) ?? false;
    this.maxBtn.replaceChildren(icon(max ? 'restore' : 'maximize'));
    this.maxBtn.title = max ? 'Restore' : 'Maximize';
  }

  openSettings() {
    this.panel.hidden = false;
    this.gear.setAttribute('aria-expanded', 'true');
    this.render();
  }

  closeSettings() {
    this.panel.hidden = true;
    this.gear.setAttribute('aria-expanded', 'false');
  }

  private render() {
    const current = ACCESS.find((a) => a.mode === this.access)!;
    this.chip.dataset.mode = this.access;
    this.chip.querySelector('span')!.textContent = 'MCP';
    this.chip.title = `MCP access: ${current.label}`;
    this.pin.setAttribute('aria-pressed', String(this.onTop));
    this.pin.title = keymap.title(this.onTop ? 'Kept on top' : 'Keep on top', 'onTop');
    if (!this.panel.hidden) this.renderPanel(current.help);
  }

  private renderPanel(help: string) {
    const segments = h(
      'div',
      { class: 'segmented', attrs: { role: 'radiogroup', 'aria-label': 'MCP access' } },
      ...ACCESS.map((a) => {
        const b = h('button', { class: 'segment', text: a.label, attrs: { type: 'button', role: 'radio', 'aria-checked': String(a.mode === this.access) } });
        b.addEventListener('click', () => void this.setAccess(a.mode));
        return b;
      }),
    );

    const slider = h('input', {
      class: 'slider',
      attrs: { type: 'range', min: String(MIN_OPACITY * 100), max: '100', step: '1', value: String(Math.round(this.opacity * 100)), 'aria-label': 'Canvas opacity' },
    });
    const value = h('span', { class: 'slider-value', text: `${Math.round(this.opacity * 100)}%` });
    slider.addEventListener('input', () => {
      this.setOpacity(Number(slider.value) / 100);
      value.textContent = `${slider.value}%`;
    });

    const onTop = h(
      'button',
      { class: 'switch-row', attrs: { type: 'button', role: 'switch', 'aria-checked': String(this.onTop) } },
      h('span', { text: 'Keep on top' }),
      actionKbd('onTop'),
      h('i', { class: 'switch' }),
    );
    onTop.addEventListener('click', () => this.toggleOnTop());

    const close = h('button', { class: 'tb-icon panel-close', attrs: { type: 'button', 'aria-label': 'Close settings' } }, icon('close'));
    close.addEventListener('click', () => this.closeSettings());

    this.panel.replaceChildren(
      h('div', { class: 'settings-head' }, h('span', { class: 'insp-kind', text: 'Settings' }), close),
      h(
        'div',
        { class: 'settings-group' },
        h('span', { class: 'field-label', text: 'MCP access' }),
        segments,
        h('p', { class: 'settings-help', text: help }),
        h('p', {
          class: 'settings-help dim',
          text: 'Nothing runs on its own: an AI tool only connects if you have set it up with Board’s MCP server, and then it can only do what this allows.',
        }),
      ),
      h(
        'div',
        { class: 'settings-group' },
        h('span', { class: 'field-label', text: 'Window' }),
        this.transparent
          ? h('label', { class: 'slider-row' }, h('span', { text: 'Canvas opacity' }), slider, value)
          : h('p', { class: 'settings-help dim', text: 'See-through canvas is available on Windows for now.' }),
        onTop,
      ),
      h('div', { class: 'settings-links' }, this.shortcutsButton(), this.tourButton()),
    );
  }

  private shortcutsButton() {
    const b = h('button', { class: 'btn-ghost', text: 'Keyboard shortcuts', attrs: { type: 'button' } });
    b.addEventListener('click', () => {
      this.closeSettings();
      this.openShortcuts();
    });
    return b;
  }

  private tourButton() {
    const b = h('button', { class: 'btn-ghost', text: 'Show the tour', attrs: { type: 'button' } });
    b.addEventListener('click', () => {
      this.closeSettings();
      this.startTour();
    });
    return b;
  }
}
