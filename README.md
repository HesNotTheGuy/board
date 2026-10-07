# Board

![A board for a game level: Mood, Palette, Avoid, Layout and HUD zones, with an image agent's second take sitting next to the reference it was aiming for](docs/images/hero.webp)

An image board on an infinite canvas, with an MCP server so your AI tools can see it too.

Early (v0.1). Windows first; macOS and Linux should work.

## Quick start

Node 20+, pnpm, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (Rust + platform WebView).

```bash
git clone https://github.com/HesNotTheGuy/board.git
cd board && pnpm install
pnpm app
```

Installer: `pnpm app:build --bundles nsis` (Windows; skips MSI).

[Connect an AI tool](docs/mcp.md).

MIT © HesNotTheGuy
