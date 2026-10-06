# Board verification map

This directory is the maintained source for verifying user-facing behavior of Board, the Tauri image board (vanilla TS canvas + Rust) in this repo. Read this index, then the matching feature file, before you drive the UI.

## Baseline preconditions

- Launch with `node .cursor/skills/verify-board/scripts/verify-board.mjs launch` so Chrome uses `$BOARD_VERIFY_DIR/chrome-profile` (default: OS temp dir plus `board-verify/chrome-profile`) and Vite serves `http://localhost:1420/?demo`.
- Run `doctor` and require title `Board` (or `… · Board`), `body.dataset.host === 'browser'`, a live Chrome pid that owns that user-data dir, and `body.dataset.open === 'true'` on a demo session.
- Dismiss `#tour` with `dismiss-tour` (**Skip tour**) before clicking other controls. Demo open starts the tour after 400ms when `board.tourDone` is unset.
- Never drive a Chrome or Vite process this run did not start.
- Port 1420 is exclusive (`strictPort`). If it is busy with a foreign process, stop; do not hijack it.

## Driving conventions

- Start every recipe from the baseline unless the feature file says otherwise (`launch --home` for the start screen).
- Click real ids and data attributes from `app/index.html` and `app/src/*`. Do not assign `document.body.dataset` or MCP `data-mode` by hand. Do not call `window.__boardDemo.agentAdds()` unless the recipe's agent-preview path says to.
- Treat helper flags as literal.
- Restore nothing that lives in the disposable Chrome profile or the in-memory backend. Those die on cleanup.
- Leave `evidence/<feature-id>/` in place. Do not commit that folder; summarize in `../PROOF.md` without home paths, emails, or tokens.

## Proof and skip reporting

- Capture the action and the resulting state, not only the last screenshot.
- UI proof includes `snapshot` JSON and a PNG where the title bar chip **MCP** is visible.
- A skipped entry point is not verified by a different path. Say which handle you used.
- An unreachable path needs the command you ran and the unmet precondition (port 1420 taken, no display, Tauri WebView missing, desktop-only `fetchImage` / Move to project).

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line each.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify-board` starts with `Preconditions:` and uses labeled bullets that pair a user action with a helper command and an observable result.
4. `Gotchas` lists traps that waste or invalidate a run.

## Features

- [Home and boards](./home-and-boards.md) covers the start screen, **New board**, **Open project folder**, and returning via the logo.
- [Canvas ingest](./canvas-ingest.md) covers paste/drop of images (and text notes), plus the empty-canvas hint.
- [Notes and focus](./notes-and-focus.md) covers **Note for AI**, Focus pins, crop, and flip on a selected image.
- [Zones](./zones.md) covers creating a zone, naming it (including **Avoid**), and membership by center.
- [MCP access](./mcp-access.md) covers the title-bar **MCP** chip: Off / View only / View & add, and the preview-only agent-add helper.
