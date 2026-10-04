// Token and latency benchmark for the MCP server: what it costs a model.
// Text tokens ≈ characters / 4; image tokens ≈ width × height / 750.
// Run: pnpm --filter @board/mcp bench   (builds first)
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import sharp from 'sharp';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const tok = (s) => Math.round(s.length / 4);

async function makeBoard(root, count) {
  await mkdir(path.join(root, '.board', 'assets'), { recursive: true });
  const colors = ['#e0613a', '#2b1b4a', '#3ddc97', '#f3efe6', '#6cb6ff'];
  const assets = [];
  for (const [i, c] of colors.entries()) {
    const name = `assets/bench${i}.png`;
    await sharp({ create: { width: 1200, height: 750, channels: 3, background: c } }).png().toFile(path.join(root, '.board', name));
    assets.push(name);
  }
  const zones = ['Mood', 'Layout', 'Avoid'].map((name, z) => ({ id: `zone_${z}`, name, x: z * 3000, y: 0, w: 2900, h: 9000, color: 'amber', note: `what ${name} means` }));
  const items = Array.from({ length: count }, (_, i) => ({
    id: `img_${String(i).padStart(6, '0')}`, kind: 'image', asset: assets[i % assets.length], srcW: 1200, srcH: 750,
    x: (i % 3) * 3000 + (i % 8) * 340, y: Math.floor(i / 24) * 400, w: 320, h: 200, z: i, addedBy: 'user', createdAt: '',
    caption: 'Warm dusk gradient over a dark hill silhouette, flat shapes', ...(i % 5 ? {} : { note: 'keep this warmth, less purple' }), ...(i % 17 ? {} : { pinned: true }),
  }));
  await writeFile(path.join(root, '.board', 'board.json'), JSON.stringify({ format: 1, rev: 1, updatedAt: new Date().toISOString(), items, zones }));
  return items.map((i) => i.id);
}

async function cost(client, label, name, args = {}) {
  const t0 = performance.now();
  const r = await client.callTool({ name, arguments: args });
  const ms = Math.round(performance.now() - t0);
  let text = 0;
  let image = 0;
  for (const c of r.content) {
    if (c.type === 'text') text += tok(c.text);
    if (c.type === 'image') {
      const m = await sharp(Buffer.from(c.data, 'base64')).metadata();
      image += Math.round((m.width * m.height) / 750);
    }
  }
  return { call: label, text, image, total: text + image, ms };
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'board-bench-'));
try {
  const rows = [];
  for (const count of [5, 120]) {
    const root = path.join(tmp, `board-${count}`);
    const ids = await makeBoard(root, count);
    const client = new Client({ name: 'bench', version: '0' });
    await writeFile(path.join(tmp, 'settings.json'), JSON.stringify({ mcpAccess: 'write' }));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER, '--root', root], env: { ...process.env, BOARD_LIBRARY: path.join(tmp, 'library'), BOARD_SETTINGS: path.join(tmp, 'settings.json') } }));
    if (count === 5) {
      const { tools } = await client.listTools();
      const instr = tok(client.getInstructions() ?? '');
      const defs = tok(JSON.stringify(tools));
      console.log(`Fixed per session: ${instr + defs} tokens (instructions ${instr}, ${tools.length} tool definitions ${defs})\n`);
    }
    rows.push(await cost(client, `overview (${count} items)`, 'overview'));
    rows.push(await cost(client, `view board (${count} items)`, 'view'));
    rows.push(await cost(client, `view board again (${count}, cached)`, 'view'));
    if (count === 5) {
      rows.push(await cost(client, 'view 1 reference', 'view', { ids: ids.slice(0, 1) }));
      rows.push(await cost(client, 'view 3 references', 'view', { ids: ids.slice(0, 3) }));
    }
    await client.close();
  }
  console.table(rows);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
