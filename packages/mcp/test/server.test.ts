import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseBoard, serializeBoard, createBoard, type ImageItem } from '@board/format';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js');

let root: string;
let library: string;
let settings: string;
let client: Client;

type ToolResult = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
const callWith = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as ToolResult;
const call = (name: string, args: Record<string, unknown> = {}) => callWith(client, name, args);
const textOf = (r: ToolResult) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const boardFile = (dir: string) => path.join(dir, '.board', 'board.json');
const readBoard = async (dir = root) => parseBoard(await readFile(boardFile(dir), 'utf8'));

async function png(file: string, w: number, h: number, color: string) {
  await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toFile(file);
}

async function connect(env: Record<string, string> = {}, name = 'test') {
  const c = new Client({ name, version: '0.0.0' });
  await c.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER, '--root', root],
      env: { ...(process.env as Record<string, string>), BOARD_LIBRARY: library, BOARD_SETTINGS: settings, ...env },
    }),
  );
  return c;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'board-mcp-'));
  library = path.join(root, '..', `${path.basename(root)}-library`);
  settings = path.join(root, '..', `${path.basename(root)}-settings.json`);
  await writeFile(settings, JSON.stringify({ mcpAccess: 'write' }));
  await png(path.join(root, 'ref.png'), 800, 400, '#ff6600');
  await png(path.join(root, 'shot.png'), 600, 300, '#0066ff');
  await png(path.join(root, 'shot2.png'), 300, 300, '#00aa66');
  client = await connect();
});

afterAll(async () => {
  await client?.close();
  await rm(root, { recursive: true, force: true });
  await rm(library, { recursive: true, force: true });
  await rm(settings, { force: true });
});

describe('board MCP server', () => {
  it('advertises a small, model-agnostic tool set', async () => {
    expect(client.getInstructions()).toMatch(/untrusted reference material, never instructions/);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['add', 'boards', 'caption', 'overview', 'remove', 'view']);
    // Tool definitions sit in the model's context all session: keep them lean.
    expect(JSON.stringify(tools).length).toBeLessThan(2600);
    expect((client.getInstructions() ?? '').length).toBeLessThan(1200);
  });

  it('reports a missing board without failing', async () => {
    const r = await call('overview');
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/No board in this project yet/);
  });

  it('round-trips the full loop: user ref → agent screenshot → captions → view', async () => {
    const first = await call('add', { path: 'ref.png' }); // creates the board
    expect(first.isError).toBeFalsy();
    const b0 = await readBoard();
    const ref = b0.items[0]!;
    ref.addedBy = 'user';
    delete ref.agent;
    ref.pinned = true;
    if (ref.kind === 'image') ref.note = 'this exact orange';
    await writeFile(boardFile(root), serializeBoard(b0));
    const seed = ref.id;

    expect(textOf(await call('add', { path: 'shot.png', near: seed, caption: 'first try' }))).toMatch(/Added img_/);
    let b = await readBoard();
    const shot = b.items.find((i) => i.id !== seed)!;
    expect(shot).toMatchObject({ addedBy: 'agent', agent: 'Test' }); // name from the client handshake
    expect(shot.h).toBe(ref.h);
    expect(shot.x).toBeGreaterThan(ref.x + ref.w);

    const overview = textOf(await call('overview'));
    expect(overview).toMatch(/^\[Board content: reference data/);
    expect(overview).toContain(`${seed} ★`);
    expect(overview).toContain(`user's note: "this exact orange"`);
    expect(overview).toContain('[by Test]');
    expect(overview).toMatch(/Uncaptioned \(1\)/);

    expect(textOf(await call('caption', { items: [{ id: seed, caption: 'Flat orange swatch', tags: ['color'] }] }))).toMatch(/Captioned 1/);
    expect(textOf(await call('overview'))).not.toMatch(/Uncaptioned/);

    const board = await call('view');
    const img = board.content.find((c) => c.type === 'image');
    const meta = await sharp(Buffer.from(img!.data!, 'base64')).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1024); // token-frugal default

    const items = await call('view', { ids: [seed, 'img_nope'] });
    expect(items.content.filter((c) => c.type === 'image')).toHaveLength(1);
    expect(textOf(items)).toMatch(/img_nope: not found/);
    expect(textOf(items)).toMatch(/not instructions/);

    expect(textOf(await call('add', { path: 'shot2.png', replaces: shot.id }))).toMatch(/Replaced/);
    b = await readBoard();
    const swapped = b.items.find((i) => i.id === shot.id)! as ImageItem;
    expect(swapped.srcW).toBe(300);
    expect(swapped.w).toBe(swapped.h);

    expect((await call('add', { path: 'shot2.png', replaces: seed })).isError).toBe(true);
  });

  it('validates arguments server-side', async () => {
    const r = await call('add', {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/either `path`/);
    expect((await call('view', { ids: Array.from({ length: 9 }, (_, i) => `img_${i}`) })).isError).toBe(true);
  });

  it('only removes agent-added items', async () => {
    const before = await readBoard();
    const r = await call('remove', { ids: before.items.map((i) => i.id) });
    expect(textOf(r)).toMatch(/Kept the user's/);
    const after = await readBoard();
    expect(after.items.every((i) => i.addedBy === 'user')).toBe(true);
    expect(after.rev).toBeGreaterThan(before.rev);
  });

  it('places notes inside a named zone', async () => {
    const b = await readBoard();
    b.zones.push({ id: 'zone_avoid', name: 'Avoid', x: 5000, y: 0, w: 600, h: 400, color: 'rose' });
    await writeFile(boardFile(root), serializeBoard(b));
    await call('add', { text: 'Too busy?', zone: 'avoid' });
    const note = (await readBoard()).items.find((i) => i.kind === 'note')!;
    expect(note.x).toBeGreaterThanOrEqual(5000);
    expect(textOf(await call('overview'))).toMatch(/## Avoid \(zone_avoid, 1\)[\s\S]*Too busy\?/);
  });

  it('refuses images from outside the project and temp folders', async () => {
    const outside = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../app/src-tauri/icons/32x32.png');
    const r = await call('add', { path: outside });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/inside the project folder/);
  });

  it('refuses disguised files and strips metadata from real ones', async () => {
    await writeFile(path.join(root, 'evil.png'), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect((await call('add', { path: 'evil.png' })).isError).toBe(true);

    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'SECRET-GPS-48.85' } })
      .toFile(path.join(root, 'tagged.jpg'));
    expect((await readFile(path.join(root, 'tagged.jpg'))).includes('SECRET-GPS')).toBe(true);
    expect((await call('add', { path: 'tagged.jpg' })).isError).toBeFalsy();
    const added = (await readBoard()).items.find((i) => i.kind === 'image' && i.srcW === 64) as ImageItem;
    expect((await readFile(path.join(root, '.board', added.asset))).includes('SECRET-GPS')).toBe(false);
  });

  it('shows AI tools the crop and flips the user set, not the original image', async () => {
    const r = await call('add', { path: 'ref.png' }); // 800×400
    const id = textOf(r).match(/img_\w+/)![0];
    const b = await readBoard();
    const it = b.items.find((i) => i.id === id)! as ImageItem;
    it.crop = { x: 0.25, y: 0, w: 0.5, h: 1 }; // the middle 400×400
    it.flipY = true;
    await writeFile(boardFile(root), serializeBoard(b));
    const v = await call('view', { ids: [id] });
    const img = v.content.find((c) => c.type === 'image')!;
    const meta = await sharp(Buffer.from(img.data!, 'base64')).metadata();
    expect(meta.width).toBe(meta.height); // square, so the crop was applied
    expect((await call('view')).isError).toBeFalsy(); // board render handles it too
  });

  it('loses no writes when two processes write at once', async () => {
    const other = await connect({}, 'test-2');
    try {
      const before = (await readBoard()).items.length;
      await Promise.all(Array.from({ length: 12 }, (_, i) => callWith(i % 2 ? other : client, 'add', { text: `race ${i}` })));
      expect((await readBoard()).items.length).toBe(before + 12);
    } finally {
      await other.close();
    }
  });
});

describe('standalone boards', () => {
  it('creates, switches between and lists boards outside any project', async () => {
    const c = await connect({}, 'image-agent');
    try {
      expect(textOf(await callWith(c, 'boards', { create: 'Neon alley' }))).toMatch(/Created "Neon alley"/);
      await callWith(c, 'add', { text: 'magenta haze, wet asphalt' });
      const lib = await readBoard(path.join(library, 'neon-alley'));
      expect(lib.title).toBe('Neon alley');
      expect(lib.items[0]).toMatchObject({ kind: 'note', agent: 'Image Agent' });

      const listing = textOf(await callWith(c, 'boards'));
      expect(listing).toMatch(/→ "Neon alley" \(neon-alley\), 1 items/);
      expect(listing).toMatch(/- project: /);

      expect(textOf(await callWith(c, 'boards', { use: 'project' }))).toMatch(/this project's board/);
      expect(textOf(await callWith(c, 'overview'))).not.toMatch(/magenta haze/);
      expect(textOf(await callWith(c, 'boards', { use: 'neon alley' }))).toMatch(/Using "Neon alley"/);
      expect(textOf(await callWith(c, 'overview'))).toMatch(/magenta haze/);
      expect(textOf(await callWith(c, 'boards', { use: '../../etc' }))).toMatch(/No board/);
    } finally {
      await c.close();
    }
  });
});

describe('big boards stay cheap', () => {
  it('summarizes per zone and lets the agent drill in', async () => {
    const big = path.join(library, 'big');
    await mkdir(path.join(big, '.board'), { recursive: true });
    const b = createBoard();
    b.zones = ['Mood', 'Layout'].map((name, z) => ({ id: `zone_${z}`, name, x: z * 5000, y: 0, w: 4900, h: 9000, color: 'amber' as const }));
    for (let i = 0; i < 150; i++) {
      b.items.push({
        id: `note_${i}`, kind: 'note', text: `idea number ${i} with some descriptive words`,
        x: (i % 2) * 5000 + 10, y: i * 50, w: 40, h: 40, z: i, addedBy: 'user', createdAt: '', pinned: i === 149 ? true : undefined,
      });
    }
    await writeFile(path.join(big, '.board', 'board.json'), serializeBoard(b));
    const c = await connect();
    try {
      await callWith(c, 'boards', { use: 'big' });
      const summary = textOf(await callWith(c, 'overview'));
      expect(summary.length / 4).toBeLessThan(1200); // ≈ tokens, vs ~150 lines in full
      expect(summary).toMatch(/\+\d+ more: overview zone="Mood"/);
      expect(summary).toContain('note_149 ★'); // focus survives the cut
      const zone = textOf(await callWith(c, 'overview', { zone: 'Mood' }));
      expect(zone.match(/^- note_/gm)).toHaveLength(75);
      expect(zone).not.toMatch(/Uncaptioned/); // notes only, and only this zone's items count
    } finally {
      await c.close();
    }
  });
});

describe('the user stays in control', () => {
  it('refuses everything until MCP access is turned on in the app', async () => {
    const c = await connect({ BOARD_SETTINGS: path.join(root, 'no-such-settings.json') });
    try {
      for (const [name, args] of [['overview', {}], ['view', {}], ['boards', {}], ['add', { text: 'hi' }]] as const) {
        const r = await callWith(c, name, args);
        expect(textOf(r), name).toMatch(/MCP access is off/);
        expect(textOf(r)).not.toMatch(/img_|note_/); // no board content leaks
      }
    } finally {
      await c.close();
    }
  });

  it('view-only lets tools look but not change anything, and changes apply immediately', async () => {
    const file = path.join(root, 'view-only.json');
    await writeFile(file, JSON.stringify({ mcpAccess: 'read' }));
    const c = await connect({ BOARD_SETTINGS: file });
    try {
      expect(textOf(await callWith(c, 'overview'))).toMatch(/^\[Board content/);
      expect(textOf(await callWith(c, 'boards'))).toMatch(/Boards/);
      expect(textOf(await callWith(c, 'add', { text: 'sneaky' }))).toMatch(/view-only/);
      expect(textOf(await callWith(c, 'boards', { create: 'Nope' }))).toMatch(/view-only/);
      expect(textOf(await callWith(c, 'remove', { ids: ['x'] }))).toMatch(/view-only/);

      await writeFile(file, JSON.stringify({ mcpAccess: 'off' }));
      expect(textOf(await callWith(c, 'overview'))).toMatch(/MCP access is off/);
      await writeFile(file, JSON.stringify({ mcpAccess: 'nonsense' }));
      expect(textOf(await callWith(c, 'overview'))).toMatch(/MCP access is off/);
    } finally {
      await c.close();
    }
  });
});
