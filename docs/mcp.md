# MCP

Board’s MCP server is stdio. The app never starts it; a client you configure runs `packages/mcp/dist/index.js`. Access stays **off** until you set **View only** or **View & add** in the app (gear, top right). The **MCP** chip in the title bar shows the current state. The server re-reads that setting on every call.

<img src="images/access.webp" width="280" alt="Settings: MCP access set to View and add">

```bash
pnpm --filter @board/mcp build
```

Most clients take an entry like this (path is wherever you cloned the repo; check the client’s docs for the file):

```json
{
  "mcpServers": {
    "board": {
      "command": "node",
      "args": ["/path/to/board/packages/mcp/dist/index.js", "--root", "/path/to/your/project"]
    }
  }
}
```

Claude Code example (it starts servers in the project, so `--root` is not needed):

```bash
claude mcp add board --scope user -- node /path/to/board/packages/mcp/dist/index.js
```

**Finding the board:** `--root <dir>`, then `BOARD_ROOT`, then the nearest ancestor of the working directory that has a `.board/` (like git). Coding tools usually start in the project; desktop chat apps usually need `--root`.

**Naming:** agent-added items are labelled with the name the client reports at handshake. Set `BOARD_AGENT_NAME` in the server environment to override it.

Then in the app: **New board**, or **Open project folder** (Ctrl O). Paste or drop references. Ask the assistant for visual work, or say “check the board”.

## Tools

| Tool | What it does |
| --- | --- |
| `overview` | Text manifest: zones, item ids, your notes, focus pins, cached captions. Big boards are summarized per zone; `zone` lists one in full. |
| `view` | Pixels. No ids: the whole board (or a zone) as one image with ids stamped on. With ids: those references. |
| `add` | Puts an image (`path`) or a note (`text`) on the board, optionally `near` a reference or `replaces` an earlier version. |
| `caption` | Caches short captions so later sessions and text-only models can skip the pixels. |
| `remove` | Removes agent-added items. It can’t remove yours. |
| `boards` | Lists this project’s board and standalone ones; `use` switches, `create` starts a standalone board. |

The server also sends short instructions on when to look and how to weigh focus pins, notes and zones.

`overview` for the board in the README hero (about 300 tokens):

```text
# Neon alley: 6 images, 2 notes, 5 zones · updated just now
★ focus: img_alley01
## Mood (zone_mood01, 3) · "Level 3 at night: rain, one warm light source per street."
- img_alley01 ★ "Rain-soaked alley at night: an orange sign and a sodium lamp reflected on wet asphalt, cold blue wa…" · user's note: "This light, but less fog. The orange sign is the only warm thing." · #lighting #rain #night
- img_vnk1eb [by Image agent] "v2: warmer lamp, less fog"
- note_mood01 note: "Wet asphalt everywhere. One warm light source per street."
## Palette (zone_pal001, 1) · "Stick to these. Orange is for interactables only."
- img_pal001 (no caption)
## Avoid (zone_avoid1, 1) · "Anti-references."
- img_noisy1 (no caption) · user's note: "Too busy. Two hues max."
...
```

`view` is the same board as one image, ids stamped on:

<p align="center">
  <img src="images/ai-view.jpg" width="760" alt="The board rendered as a single image, zones outlined and every item labelled with its id">
</p>

![An agent-added image outlined in mint, labelled Image agent, next to the reference](images/agent.webp)

An agent can drop a screenshot or a generated image next to the reference it was aiming for. It shows up live, outlined in mint and labelled with the tool’s name. The next iteration can `replaces` it.

## Image models

Image generators don’t speak MCP. The agent or script driving them can:

1. `overview` for notes, captions and zones; `view` with ids for the reference pixels.
2. Generate with whatever model you use.
3. `add` with `near` set to the reference, and `replaces` on the next pass.

## Token budget

Measured with `pnpm --filter @board/mcp bench` (text ≈ characters / 4, images ≈ width × height / 750):

| | Tokens |
| --- | --- |
| Fixed per session (instructions + 6 tool definitions) | ~820 |
| `overview`, small board | ~170 |
| `overview`, 120 items (summarized per zone) | ~1,100 |
| `view`, whole board (any shape) | ≤ ~880 |
| `view`, one reference (768 px) | ~540 |

Tool definitions are hand-written and minimal (strict validation is on the server). Images are sized for the job (`max_edge` up to 1568 when detail matters). Captions let later sessions skip pixels. Whole-board renders run in parallel with a tile cache.

## See also

[Using the board](using.md) · [Format](FORMAT.md) · [Develop](develop.md)
