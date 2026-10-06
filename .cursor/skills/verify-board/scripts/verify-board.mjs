#!/usr/bin/env node
// Disposable Vite + Chrome CDP driver for Board's UI-only preview.
// Invoke from the repo root. Session lives under $BOARD_VERIFY_DIR (OS temp + board-verify).

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync, openSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const EVIDENCE_ROOT = path.join(SKILL_DIR, 'evidence');
const REPO_ROOT = findRepoRoot(path.resolve(SCRIPT_DIR, '..', '..', '..', '..'));
const DEFAULT_RUN_DIR = process.env.BOARD_VERIFY_DIR || path.join(os.tmpdir(), 'board-verify');
const SESSION_PATH = path.join(DEFAULT_RUN_DIR, 'session.json');
const APP_ORIGIN = 'http://localhost:1420';
const DEMO_URL = `${APP_ORIGIN}/?demo`;
const HOME_URL = `${APP_ORIGIN}/`;

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.name === 'board-monorepo') return dir;
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not find board-monorepo package.json above this script');
}

function parseArgs(argv) {
  const cmd = argv[0] || '';
  const flags = {};
  for (let i = 1; i < argv.length; i += 1) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { cmd, flags };
}

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalProcess(pid, signal) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
    return;
  } catch (err) {
    if (err && err.code !== 'ESRCH' && err.code !== 'ENOSYS' && err.code !== 'EINVAL') throw err;
  }
  try {
    process.kill(pid, signal);
  } catch (err) {
    if (err && err.code === 'ESRCH') return;
    throw err;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cmdlineOf(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    return '';
  }
}

async function readSession() {
  try {
    return JSON.parse(await readFile(SESSION_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function writeSession(session) {
  await mkdir(DEFAULT_RUN_DIR, { recursive: true });
  await writeFile(SESSION_PATH, JSON.stringify(session, null, 2));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function httpGet(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`GET ${url} timed out`));
    });
  });
}

async function httpGetJson(url) {
  const { status, body } = await httpGet(url);
  if (status >= 400) throw new Error(`GET ${url} -> ${status}`);
  return JSON.parse(body);
}

function portAnswer(origin) {
  return httpGet(origin)
    .then((r) => r.status > 0 && r.status < 500)
    .catch(() => false);
}

function chromeBin() {
  const named = process.env.CHROME_BIN || process.env.GOOGLE_CHROME;
  if (named && existsSync(named)) return named;
  const candidates = [
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/local/bin/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

async function listTargets(cdpPort) {
  const urls = [`http://127.0.0.1:${cdpPort}/json/list`, `http://127.0.0.1:${cdpPort}/json`];
  let lastErr;
  for (const url of urls) {
    try {
      const data = await httpGetJson(url);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('CDP /json is not answering');
}

function isBoardUrl(url) {
  if (typeof url !== 'string') return false;
  return /https?:\/\/(localhost|127\.0\.0\.1):1420\b/.test(url);
}

function pickAppTarget(targets) {
  const pages = targets.filter((t) => t && t.webSocketDebuggerUrl);
  const board = pages.find((t) => isBoardUrl(t.url));
  if (board) return board;
  const byTitle = pages.find((t) => typeof t.title === 'string' && /\bBoard\b/.test(t.title) && !/^chrome/i.test(t.url || ''));
  return byTitle || null;
}

function cdpCall(wsUrl, method, params = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error(`CDP ${method} timed out`));
    }, timeoutMs);

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      if (err) reject(err);
      else resolve(value);
    };

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch (err) {
        finish(err);
        return;
      }
      if (msg.id !== id) return;
      if (msg.error) finish(new Error(`CDP ${method}: ${msg.error.message || JSON.stringify(msg.error)}`));
      else finish(null, msg.result);
    });
    ws.addEventListener('error', () => finish(new Error(`CDP websocket error for ${method}`)));
  });
}

async function withTarget(session, fn) {
  const targets = await listTargets(session.cdpPort);
  const target = pickAppTarget(targets);
  if (!target) throw new Error('no Board page on CDP (looking for localhost:1420)');
  return fn(target.webSocketDebuggerUrl);
}

async function evaluate(session, expression, awaitPromise = false) {
  return withTarget(session, async (wsUrl) => {
    const result = await cdpCall(wsUrl, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'evaluate failed';
      throw new Error(text);
    }
    return result.result?.value;
  });
}

function snapshotExpr() {
  return `(() => {
    const chip = document.getElementById('ai-chip');
    const settings = document.getElementById('settings');
    const inspector = document.getElementById('inspector');
    const welcome = document.getElementById('welcome');
    const tour = document.getElementById('tour');
    const hint = document.getElementById('hint');
    const status = document.getElementById('status');
    const noteField = inspector && inspector.querySelector('[data-field="note"]');
    const nameField = inspector && inspector.querySelector('[data-field="name"]');
    const meaningField = inspector && inspector.querySelector('[data-field="meaning"]');
    const pin = inspector && inspector.querySelector('[data-toggle="pinned"]');
    const kind = inspector && inspector.querySelector('.insp-kind');
    const inspId = inspector && inspector.querySelector('.insp-id');
    return {
      title: document.title,
      host: document.body.dataset.host || '',
      open: document.body.dataset.open || '',
      home: document.body.dataset.home || '',
      tour: document.body.dataset.tour || '',
      tourHidden: !tour || tour.hidden,
      mcpMode: chip ? chip.dataset.mode : '',
      mcpTitle: chip ? chip.title : '',
      settingsOpen: !!(settings && !settings.hidden),
      settingsLabels: settings
        ? [...settings.querySelectorAll('button.segment')].map((b) => ({
            text: (b.textContent || '').trim(),
            checked: b.getAttribute('aria-checked') === 'true',
          }))
        : [],
      boardName: (document.getElementById('board-name') || {}).textContent || '',
      status: status ? status.dataset.state : '',
      welcomeHidden: !welcome || welcome.hidden,
      hintHidden: !hint || hint.hidden,
      inspectorHidden: !inspector || inspector.hidden,
      inspectorKind: kind ? kind.textContent : '',
      inspectorId: inspId ? inspId.textContent : '',
      noteField: noteField ? noteField.value : '',
      zoneNameField: nameField ? nameField.value : '',
      zoneMeaningField: meaningField ? meaningField.value : '',
      focusPressed: pin ? pin.getAttribute('aria-pressed') : '',
      items: [...document.querySelectorAll('#items .item')].map((el) => ({
        id: el.dataset.id,
        kind: el.dataset.kind,
        pinned: el.classList.contains('pinned'),
        agent: el.classList.contains('agent'),
        selected: el.classList.contains('selected'),
        cropping: el.classList.contains('cropping'),
        badges: [...el.querySelectorAll('.badge')].map((b) => b.textContent),
      })),
      zones: [...document.querySelectorAll('#zones .zone')].map((el) => ({
        id: el.dataset.id,
        name: (el.querySelector('.zone-name') || {}).textContent || '',
        color: el.dataset.color,
        selected: el.classList.contains('selected'),
      })),
      cropWin: !!document.querySelector('#overlay .crop-win'),
      toastTexts: [...document.querySelectorAll('#toasts .toast span')].map((s) => s.textContent),
    };
  })()`;
}

async function snapshotState(session) {
  return evaluate(session, snapshotExpr());
}

function resolveOut(p) {
  if (!p || p === true) die('need --out <path>');
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
}

async function writeOut(filePath, contents, encoding) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, encoding);
}

async function screenshot(session, outPath) {
  const data = await withTarget(session, async (wsUrl) => {
    const result = await cdpCall(wsUrl, 'Page.captureScreenshot', { format: 'png' });
    return result.data;
  });
  await writeOut(outPath, Buffer.from(data, 'base64'));
}

function clickExpr(flags) {
  const text = typeof flags.text === 'string' ? flags.text : '';
  if (flags.id && flags.id !== true) {
    return `(() => {
      const el = document.getElementById(${JSON.stringify(flags.id)});
      if (!el) return { ok: false, error: 'not found: #' + ${JSON.stringify(flags.id)} };
      el.click();
      return { ok: true, id: el.id, text: (el.innerText || '').trim().slice(0, 80) };
    })()`;
  }
  const selector = flags.selector;
  if (!selector || selector === true) throw new Error('need --id or --selector');
  return `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const want = ${JSON.stringify(text)};
    const el = want ? nodes.find((n) => (n.textContent || '').trim() === want) : nodes[0];
    if (!el) return { ok: false, error: 'not found: ' + ${JSON.stringify(selector)} + (want ? ' text=' + want : '') };
    el.click();
    return { ok: true, id: el.id, text: (el.innerText || '').trim().slice(0, 80) };
  })()`;
}

async function pressKey(session, key) {
  if (!key || key === true) die('need --key <key>');
  return withTarget(session, async (wsUrl) => {
    await cdpCall(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyDown', key });
    await cdpCall(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyUp', key });
    return { ok: true, key };
  });
}

function fillExpr(selector, value) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: 'not found' };
    el.focus();
    if ('value' in el) {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.textContent = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { ok: true, value: ('value' in el ? el.value : el.textContent) };
  })()`;
}

// Tiny PNG so paste hits ingestFiles without depending on a fixture path.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pastePngExpr() {
  return `(async () => {
    const bin = Uint8Array.from(atob(${JSON.stringify(TINY_PNG_B64)}), (c) => c.charCodeAt(0));
    const file = new File([bin], 'verify.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    document.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 200));
    return { ok: true, images: document.querySelectorAll('#items .item.image').length };
  })()`;
}

function pasteTextExpr(value) {
  return `(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', ${JSON.stringify(value)});
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    document.dispatchEvent(ev);
    return { ok: true };
  })()`;
}

async function waitFor(session, predicateExpr, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(session, predicateExpr, /\bawait\b/.test(predicateExpr));
    if (last) return last;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label}: last=${JSON.stringify(last)}`);
}

async function requireSession() {
  const session = await readSession();
  if (!session) die(`no session at run dir (start with launch). Set BOARD_VERIFY_DIR to override.`);
  return session;
}

async function cmdDoctor(session, { quiet } = {}) {
  const issues = [];
  if (!pidAlive(session.vitePid)) issues.push('vite pid is not alive');
  if (!pidAlive(session.chromePid)) issues.push('chrome pid is not alive');
  if (!(await portAnswer(APP_ORIGIN))) issues.push(`${APP_ORIGIN} is not answering`);
  const cmd = cmdlineOf(session.chromePid);
  if (session.userDataDir && cmd && !cmd.includes(session.userDataDir)) {
    issues.push('chrome cmdline does not contain this run user-data-dir');
  }
  let state = null;
  try {
    const targets = await listTargets(session.cdpPort);
    const target = pickAppTarget(targets);
    if (!target) issues.push('no CDP page for localhost:1420');
    else if (!isBoardUrl(target.url)) issues.push(`CDP page url is not the Board preview: ${target.url}`);
    state = await snapshotState(session);
    const titleOk = state.title === 'Board' || / · Board$/.test(state.title);
    if (!titleOk) issues.push(`title is ${JSON.stringify(state.title)}`);
    if (state.host !== 'browser') issues.push(`body.dataset.host is ${JSON.stringify(state.host)} (expected browser)`);
    if (session.mode === 'demo' && state.open !== 'true') issues.push('demo session is not open');
    if (session.mode === 'home' && state.welcomeHidden) issues.push('home session does not show #welcome');
  } catch (err) {
    issues.push(err instanceof Error ? err.message : String(err));
  }
  const result = {
    ok: issues.length === 0,
    issues,
    appUrl: session.appUrl,
    mode: session.mode,
    title: state?.title,
    host: state?.host,
    open: state?.open,
    mcpMode: state?.mcpMode,
    tourHidden: state?.tourHidden,
  };
  if (!quiet) printJson(result);
  if (!result.ok) process.exitCode = 1;
  return result;
}

async function dismissTour(session) {
  const state = await snapshotState(session);
  if (state.tourHidden) return { ok: true, skipped: true };
  const clicked = await evaluate(session, clickExpr({ selector: '#tour button.tour-skip' }));
  await sleep(200);
  const after = await snapshotState(session);
  return { ok: after.tourHidden, clicked, tourHidden: after.tourHidden };
}

async function spawnLogged(command, args, logPath, extraEnv = {}) {
  await mkdir(path.dirname(logPath), { recursive: true });
  const fd = openSync(logPath, 'a');
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, ...extraEnv },
  });
  child.unref();
  return { pid: child.pid, pgid: child.pid };
}

async function waitHttp(origin, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portAnswer(origin)) return;
    await sleep(200);
  }
  throw new Error(`${origin} did not become ready`);
}

async function cmdLaunch(flags) {
  const existing = await readSession();
  if (existing && (pidAlive(existing.vitePid) || pidAlive(existing.chromePid))) {
    die('a verification session is already running; run cleanup first (refusing to double-drive port 1420)');
  }

  if (!existsSync(path.join(REPO_ROOT, 'node_modules'))) {
    die('node_modules missing; run pnpm install from the repo root first');
  }

  const mode = flags.home ? 'home' : 'demo';
  const appUrl = mode === 'home' ? HOME_URL : DEMO_URL;
  const userDataDir = path.join(DEFAULT_RUN_DIR, 'chrome-profile');
  const viteLog = path.join(DEFAULT_RUN_DIR, 'vite.log');
  const chromeLog = path.join(DEFAULT_RUN_DIR, 'chrome.log');

  const occupied = await portAnswer(APP_ORIGIN);
  let vitePid = null;
  let vitePgid = null;
  if (occupied) {
    die(`${APP_ORIGIN} is already answering; refuse to hijack a foreign Vite. Stop it or reuse only after cleanup of this helper's session.`);
  }

  const vite = await spawnLogged('pnpm', ['dev'], viteLog);
  vitePid = vite.pid;
  vitePgid = vite.pgid;
  try {
    await waitHttp(APP_ORIGIN, 60000);
  } catch (err) {
    signalProcess(vitePgid, 'SIGTERM');
    throw err;
  }

  const bin = chromeBin();
  if (!bin) die('Chrome/Chromium not found. Set CHROME_BIN to a browser binary.');

  const cdpPort = await freePort();
  await mkdir(userDataDir, { recursive: true });
  const chromeArgs = [
    `--remote-debugging-port=${cdpPort}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--disable-popup-blocking',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1280,820',
    appUrl,
  ];
  const chrome = await spawnLogged(bin, chromeArgs, chromeLog);
  const session = {
    mode,
    appUrl,
    vitePid,
    vitePgid,
    chromePid: chrome.pid,
    chromePgid: chrome.pgid,
    cdpPort,
    userDataDir,
    startedAt: new Date().toISOString(),
  };
  await writeSession(session);

  try {
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const targets = await listTargets(cdpPort);
        if (pickAppTarget(targets)) {
          const state = await snapshotState(session);
          const titleOk = state.title === 'Board' || / · Board$/.test(state.title);
          const hostOk = state.host === 'browser';
          const modeOk = mode === 'demo' ? state.open === 'true' : !state.welcomeHidden;
          if (titleOk && hostOk && modeOk) {
            ready = true;
            break;
          }
        }
      } catch {
        // chrome still booting
      }
      await sleep(250);
    }
    if (!ready) throw new Error('Board preview did not become ready over CDP');
    printJson({
      ok: true,
      mode,
      appUrl,
      vitePid,
      chromePid: chrome.pid,
      cdpPort,
      runDir: 'BOARD_VERIFY_DIR (default OS temp + board-verify)',
    });
  } catch (err) {
    await cmdCleanup({ silent: true });
    throw err;
  }
}

async function cmdCleanup({ silent } = {}) {
  const session = await readSession();
  if (session) {
    signalProcess(session.chromePgid || session.chromePid, 'SIGTERM');
    signalProcess(session.vitePgid || session.vitePid, 'SIGTERM');
    await sleep(400);
    if (pidAlive(session.chromePid)) signalProcess(session.chromePgid || session.chromePid, 'SIGKILL');
    if (pidAlive(session.vitePid)) signalProcess(session.vitePgid || session.vitePid, 'SIGKILL');
    await sleep(200);
  }
  await rm(DEFAULT_RUN_DIR, { recursive: true, force: true });
  const result = {
    ok: true,
    removedRunDir: true,
    evidenceKept: '.cursor/skills/verify-board/evidence',
    chromeAlive: session ? pidAlive(session.chromePid) : false,
    viteAlive: session ? pidAlive(session.vitePid) : false,
  };
  if (!silent) printJson(result);
  return result;
}

async function cmdDriveMcpAccess() {
  let session = await readSession();
  if (!session || !pidAlive(session.chromePid) || !pidAlive(session.vitePid)) {
    await cmdLaunch({});
    session = await requireSession();
  }
  const doctor = await cmdDoctor(session, { quiet: true });
  if (!doctor.ok) die(`doctor failed: ${(doctor.issues || []).join('; ')}`);

  await sleep(500);
  await dismissTour(session);
  await sleep(200);

  const evidenceDir = path.join(EVIDENCE_ROOT, 'mcp-access');
  await mkdir(evidenceDir, { recursive: true });

  const before = await snapshotState(session);
  await writeOut(path.join(evidenceDir, 'before.json'), JSON.stringify(before, null, 2) + '\n');

  const open = await evaluate(session, clickExpr({ id: 'ai-chip' }));
  if (!open.ok) die(`could not click #ai-chip: ${open.error}`);
  await sleep(200);

  const choose = await evaluate(session, clickExpr({ selector: '#settings button.segment', text: 'View only' }));
  if (!choose.ok) die(`could not click View only: ${choose.error}`);
  await sleep(300);

  const after = await snapshotState(session);
  await writeOut(path.join(evidenceDir, 'after.json'), JSON.stringify(after, null, 2) + '\n');
  await screenshot(session, path.join(evidenceDir, 'after-view-only.png'));

  const viewOnly = (after.settingsLabels || []).find((l) => l.text === 'View only');
  const proof = {
    feature: 'mcp-access',
    entry: 'chip-settings',
    surface: 'browser-cdp',
    appUrl: DEMO_URL,
    action: 'clicked #ai-chip then Settings radio View only',
    before: { mcpMode: before.mcpMode, mcpTitle: before.mcpTitle, settingsOpen: before.settingsOpen },
    after: {
      mcpMode: after.mcpMode,
      mcpTitle: after.mcpTitle,
      settingsOpen: after.settingsOpen,
      viewOnlyChecked: !!(viewOnly && viewOnly.checked),
    },
    ok: after.mcpMode === 'read' && after.mcpTitle === 'MCP access: View only' && !!(viewOnly && viewOnly.checked),
    evidence: [
      'evidence/mcp-access/before.json',
      'evidence/mcp-access/after.json',
      'evidence/mcp-access/after-view-only.png',
      'evidence/mcp-access/proof.json',
    ],
  };
  await writeOut(path.join(evidenceDir, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  printJson(proof);
  if (!proof.ok) process.exitCode = 1;
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  try {
    if (cmd === 'launch') {
      await cmdLaunch(flags);
      return;
    }
    if (cmd === 'cleanup') {
      await cmdCleanup();
      return;
    }
    if (cmd === 'drive-mcp-access') {
      await cmdDriveMcpAccess();
      return;
    }

    const session = await requireSession();

    if (cmd === 'doctor') {
      await cmdDoctor(session);
      return;
    }
    if (cmd === 'dismiss-tour') {
      printJson(await dismissTour(session));
      return;
    }
    if (cmd === 'snapshot') {
      const state = await snapshotState(session);
      const out = flags.out;
      if (out && out !== true) await writeOut(resolveOut(out), JSON.stringify(state, null, 2) + '\n');
      printJson(state);
      return;
    }
    if (cmd === 'screenshot') {
      const out = resolveOut(flags.out);
      await screenshot(session, out);
      printJson({ ok: true, out: flags.out });
      return;
    }
    if (cmd === 'click') {
      const result = await evaluate(session, clickExpr(flags));
      printJson(result);
      if (!result?.ok) process.exitCode = 1;
      return;
    }
    if (cmd === 'press') {
      printJson(await pressKey(session, flags.key));
      return;
    }
    if (cmd === 'fill') {
      if (!flags.selector || flags.value === undefined || flags.value === true) die('fill needs --selector and --value');
      const result = await evaluate(session, fillExpr(flags.selector, String(flags.value)));
      printJson(result);
      if (!result?.ok) process.exitCode = 1;
      return;
    }
    if (cmd === 'paste-png') {
      printJson(await evaluate(session, pastePngExpr(), true));
      return;
    }
    if (cmd === 'paste-text') {
      const value = flags.value === undefined || flags.value === true ? 'Verify note' : String(flags.value);
      printJson(await evaluate(session, pasteTextExpr(value)));
      return;
    }
    if (cmd === 'eval') {
      if (!flags.expr || flags.expr === true) die('eval needs --expr');
      printJson({ value: await evaluate(session, flags.expr, flags.await === true) });
      return;
    }
    die(`unknown command ${cmd || '(none)'}. Try launch | doctor | dismiss-tour | click | fill | press | snapshot | screenshot | paste-png | paste-text | eval | drive-mcp-access | cleanup`);
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }
}

await main();
