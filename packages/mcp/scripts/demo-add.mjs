// Adds one image to a board over MCP, the same way an assistant or image pipeline would:
// `overview` to find the focused reference, then `add` with `near` set to it.
// Used to film the agent-add beat of the demo against the desktop app (no keys needed).
//
//   pnpm --filter @board/mcp build
//   node packages/mcp/scripts/demo-add.mjs --root /path/to/project --image attempt.png
//
// Options: --near <item id> (default: the first focus pin), --caption <text>,
// --name <label shown on the board> (default "Image agent"), --replaces <earlier agent image id>.
// MCP access in the app must be "View & add".
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js');

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`Expected --option value, got ${argv[i]}`);
  args[argv[i].slice(2)] = argv[i + 1];
}
if (!args.root || !args.image) {
  console.error('Usage: node packages/mcp/scripts/demo-add.mjs --root <project folder> --image <file> [--near id] [--caption text] [--name label] [--replaces id]');
  process.exit(1);
}

const text = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER, '--root', path.resolve(args.root)],
  env: { ...process.env, BOARD_AGENT_NAME: args.name ?? 'Image agent' },
  stderr: 'inherit',
});
const client = new Client({ name: 'board-demo-add', version: '0.1.0' });
await client.connect(transport);

try {
  const overview = text(await client.callTool({ name: 'overview', arguments: {} }));
  console.log(overview);
  const near = args.near ?? /★ focus: (\S+)/.exec(overview)?.[1]?.replace(/,$/, '');
  const add = {
    path: path.resolve(args.image),
    ...(near && { near }),
    ...(args.caption && { caption: args.caption }),
    ...(args.replaces && { replaces: args.replaces }),
  };
  console.log(`\nadd ${path.basename(add.path)}${near ? ` near ${near}` : ''}`);
  console.log(text(await client.callTool({ name: 'add', arguments: add })));
} finally {
  await client.close();
}
