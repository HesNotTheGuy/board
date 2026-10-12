#!/usr/bin/env node
// Films the demo beats in the browser preview (`pnpm dev`) with real mouse and
// keyboard input, one take per beat, named the way docs/demo/shots.json expects.
// Linux + X11 only (it drives the screen with xdotool and records with x11grab);
// on Windows, film by hand with docs/demo/CAPTURE.md.
//
//   pnpm dev                                   (in another terminal)
//   node docs/demo/capture-preview.mjs         takes land in board-demo-clips-preview/
//   node docs/demo/stitch.mjs --clips board-demo-clips-preview
//
// Needs google-chrome (or CHROME=...), ffmpeg, xdotool, xclip and a display of at
// least 1920x1080 with nothing drawn over the top-left corner (hide desktop panels).
// The agent-add take uses the preview's built-in simulation (`__boardDemo.agentAdds()`,
// labelled "Demo Agent"); a real MCP add needs the desktop app, see CAPTURE.md.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_BASE = process.env.BOARD_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || 'google-chrome';
const DISPLAY = process.env.DISPLAY || ':0';
const PORT = 9333;
// UI at 1.5x so text stays legible in a 1080p video: a 1280x720 page fills 1920x1080 pixels.
const SCALE = 1.5;
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > 0 ? process.argv[outArg + 1] : 'board-demo-clips-preview');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, input) => execFileSync(cmd, args.map(String), { env: { ...process.env, DISPLAY }, input });
const xdo = (...a) => sh('xdotool', a);

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith(URL_BASE));
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => (ws.addEventListener('open', r, { once: true }), ws.addEventListener('error', j, { once: true })));
        return ws;
      }
    } catch {
      // Chrome still starting
    }
    await sleep(200);
  }
  throw new Error(`Chrome didn't open ${URL_BASE}. Is \`pnpm dev\` running?`);
}

const profile = mkdtempSync(path.join(os.tmpdir(), 'board-capture-'));
const chrome = spawn(CHROME, [
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
  "--simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'", `--force-device-scale-factor=${SCALE}`,
  `--remote-debugging-port=${PORT}`, '--start-fullscreen', `--app=${URL_BASE}`,
], { env: { ...process.env, DISPLAY }, stdio: 'ignore' });

const ws = await connect();
let seq = 0;
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', on);
      resolve(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
  });
const js = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;

/** Center of the first element matching `sel` (optionally with exact text), in page px. */
const at = (sel, text) =>
  js(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
    const el = ${text ? `els.find((e) => e.textContent.trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())})` : 'els[0]'};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  })()`).then((p) => {
    if (!p) throw new Error(`Nothing matches ${sel}${text ? ` "${text}"` : ''}`);
    return p;
  });

let cur = [1700, 900];
/** Glides the real cursor to page point (x, y). */
async function move([x, y], ms = 650) {
  const [sx, sy] = cur;
  const [tx, ty] = [x * SCALE, y * SCALE];
  const steps = Math.max(1, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = p * p * (3 - 2 * p);
    xdo('mousemove', Math.round(sx + (tx - sx) * e), Math.round(sy + (ty - sy) * e));
    await sleep(16);
  }
  cur = [tx, ty];
}
const click = async (p, ms) => {
  await move(p, ms);
  await sleep(140);
  xdo('click', 1);
};
async function drag(from, to, ms = 900) {
  await move(from);
  xdo('mousedown', 1);
  await sleep(120);
  await move(to, ms);
  await sleep(80);
  xdo('mouseup', 1);
}
const key = (...k) => xdo('key', '--clearmodifiers', ...k);
const type = (s) => xdo('type', '--delay', 55, s);

let rec = null;
function record(name) {
  rec = spawn('ffmpeg', [
    '-v', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '1', '-framerate', '30', '-video_size', '1920x1080', '-i', `${DISPLAY}.0+0,0`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p', path.join(OUT, `${name}.mp4`),
  ], { stdio: ['pipe', 'ignore', 'inherit'] });
}
async function cut() {
  rec.stdin.write('q');
  await new Promise((r) => rec.on('exit', r));
  rec = null;
}

/** A small palette swatch to paste, made on the spot so the take doesn't depend on local files. */
function swatch() {
  const file = path.join(profile, 'palette.png');
  const colors = ['141824', '34496e', 'f0b450', 'e85a4f', 'f5f0e6'];
  const inputs = colors.flatMap((c) => ['-f', 'lavfi', '-i', `color=c=0x${c}:s=68x120`]);
  sh('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${colors.map((_, i) => `[${i}]`).join('')}hstack=${colors.length},pad=iw+28:ih+28:14:14:color=0xf7f4ee`, '-frames:v', '1', file]);
  return file;
}

const newestItem = (before) =>
  js(`(() => { const ids = ${JSON.stringify(before)}; const el = [...document.querySelectorAll('.item')].find((e) => !ids.includes(e.dataset.id)); return el?.dataset.id ?? null; })()`);
const itemIds = () => js(`[...document.querySelectorAll('.item')].map((e) => e.dataset.id)`);
const itemAt = (id) => at(`.item[data-id="${id}"]`);

const takes = [
  ['01-open', async () => {
    await sleep(700);
    await click(await at('#browser-note a'), 900);
    await sleep(2600);
  }],
  ['02-paste-drop', async () => {
    const before = await itemIds();
    await sleep(500);
    await move([1000, 520], 500);
    key('ctrl+v');
    await sleep(900);
    const id = await newestItem(before);
    const p = await itemAt(id);
    await drag(p, [1040, 540], 1100);
    await sleep(500);
    await click([640, 590], 500);
    await sleep(900);
    return id;
  }],
  ['03-zones', async (pasted) => {
    await sleep(400);
    await click(await itemAt(pasted), 700);
    await sleep(400);
    key('f');
    while (!(await js(`document.activeElement?.dataset?.field === 'name'`))) await sleep(50);
    await sleep(250);
    key('ctrl+a');
    type('Palette');
    await sleep(300);
    await click(await at('[data-field="meaning"]'), 700);
    type('Stick to these.');
    await sleep(1300);
  }],
  ['04-focus-note', async () => {
    key('Escape');
    await sleep(300);
    await click(await itemAt('img_card'), 800);
    await sleep(400);
    key('p');
    await sleep(600);
    await click(await at('[data-field="note"]'), 800);
    type('Lots of air like this. One accent color.');
    await sleep(1400);
  }],
  ['05-mcp-view-only', async () => {
    key('Escape');
    await sleep(500);
    await click(await at('#ai-chip'), 900);
    await sleep(700);
    await click(await at('#settings button', 'View only'), 700);
    await sleep(1600);
    key('Escape');
    await move([800, 380], 700);
    await sleep(900);
  }],
  ['06-agent-add', async () => {
    await sleep(800);
    await js('window.__boardDemo.agentAdds()');
    await sleep(1500);
    await click(await at('.toast.actionable u'), 800);
    await sleep(600);
    await move([730, 250], 900);
    await sleep(1600);
  }],
  ['07-fit-all', async () => {
    await sleep(600);
    key('Escape');
    await sleep(300);
    key('shift+1');
    await sleep(3000);
  }],
];

try {
  mkdirSync(OUT, { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1920 / SCALE, height: 1080 / SCALE, deviceScaleFactor: SCALE, mobile: false });
  while (!(await js(`location.href.startsWith(${JSON.stringify(URL_BASE)}) && document.readyState === 'complete'`))) await sleep(200);
  await js(`localStorage.clear(); localStorage.setItem('board.tourDone', 'true'); location.reload();`);
  await sleep(2000);
  // xclip stays alive to serve the clipboard, so it must not hold our stdio open.
  spawn('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i', swatch()], { env: { ...process.env, DISPLAY }, stdio: 'ignore', detached: true }).unref();
  await sleep(300);
  xdo('mousemove', ...cur);
  let carry;
  for (const [name, take] of takes) {
    if (name === '06-agent-add') {
      // Off camera: allow adds, so the chip matches what an agent would need.
      await click(await at('#ai-chip'), 300);
      await sleep(300);
      await click(await at('#settings button', 'View & add'), 300);
      key('Escape');
      await move([1400, 800], 300);
      await sleep(3800);
    }
    console.log(`  ${name}`);
    record(name);
    carry = (await take(carry)) ?? carry;
    await cut();
  }
  console.log(`→ ${path.relative(process.cwd(), OUT) || '.'}/`);
} finally {
  if (rec) await cut();
  ws.close();
  const exited = new Promise((r) => chrome.on('exit', r));
  chrome.kill();
  await exited;
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // Chrome's helper processes can still be writing; it's a temp folder either way.
  }
}
