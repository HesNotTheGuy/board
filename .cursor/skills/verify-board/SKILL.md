---
name: verify-board
description: Drive Board, the Tauri image-board desktop app in this repo (and its UI-only Vite preview), through the real canvas UI. Use when proving a Board UI change, capturing live evidence, or checking behavior against the project-local feature map.
---

# Verify Board

This skill is for the next agent that has to prove Board the way a user uses it. Read it cold. Do not import another app's driver, selectors, or paths.

Board is a **Tauri desktop image board** (`app/`: vanilla TS canvas + Rust shell) with shared format code in `packages/format` and an MCP server in `packages/mcp`. There is no login, no cloud, no telemetry. Vitest under `packages/*/test` is unit-only and does not drive the UI. `app/` has no UI tests yet.

**Primary verification surface** for this skill: the UI-only Vite preview (`pnpm dev` → `http://localhost:1420`) driven with disposable Chrome CDP. That is the real Board frontend (`app/src/*`) with the product's own in-memory backend (`MemoryBackend` in `app/src/backend.ts`). It is not a mock page. Nothing is persisted; `?demo` seeds a sample board. `__boardDemo.agentAdds()` is a preview-only stand-in for an MCP client adding an image.

**Secondary surface:** `pnpm app` (Tauri WebView). Same UI, disk-backed `.board/` JSON + images, real MCP settings file. Prefer it when the desktop shell, sanitizer, folder picker, or MCP chip persistence matters. Cloud/CI VMs often lack WebKit/GTK; if `pnpm app` cannot start, use the Vite+CDP surface and say so.

Keep the map honest with `/maintain-verification-skill` as the app changes.

## Launch

Documented start in `README.md` and the repo `package.json`: Node 20+, `pnpm install`, then either `pnpm app` (Tauri; needs Rust + platform WebView) or `pnpm dev` (UI-only browser). No env file. No auth.

Vite is **strict on port 1420** (`app/vite.config.ts`). Two previews cannot share that port. If 1420 is already taken by something this run did not start, refuse to drive it.

For verification, do not attach Chrome to a human profile. Start through the helper, which launches Vite (if needed), a disposable Chrome `--user-data-dir`, and a CDP port:

```bash
node .cursor/skills/verify-board/scripts/verify-board.mjs launch
```

That opens `http://localhost:1420/?demo`. For the home screen instead:

```bash
node .cursor/skills/verify-board/scripts/verify-board.mjs launch --home
```

Ready signal, observed over CDP on the Board page (not a chrome:// target):

- `document.title` is `Board` or ends with ` · Board`
- `document.body.dataset.host === 'browser'`
- demo launch: `document.body.dataset.open === 'true'` and `.item.image[data-id="img_sunset"]` exists
- home launch: `#welcome` is not hidden

The helper also waits until `http://localhost:1420/` returns HTTP 200. Launch prints JSON with `vitePid`, `chromePid`, `cdpPort`, and `appUrl`. Session file: `$BOARD_VERIFY_DIR/session.json` (default: the OS temp directory plus `board-verify`). Do not copy a resolved home path from that JSON into committed files.

Linux Chromium flags the helper adds, verification-only, removed when the process dies:

- `--no-sandbox` and `--disable-dev-shm-usage` so a container can boot Chrome
- `--remote-debugging-port` and `--remote-allow-origins=*` so CDP works
- `--user-data-dir` under the run directory so `localStorage` keys (`board.tourDone`, `board.recents`, `board.last`, `board.keys`, `board.cam.*`, `board.opacity`, `board.onTop`) never touch a human profile

If `DISPLAY` and `WAYLAND_DISPLAY` are both unset on Linux, wrap **the same launch command** with `xvfb-run -a` and record that xvfb pid for cleanup. Do not kill a display you did not start.

First demo open starts the product tour after 400ms (`app/src/main.ts` + `app/src/tour.ts`). A tour overlay does not fail launch. Dismiss it before clicking other chrome:

```bash
node .cursor/skills/verify-board/scripts/verify-board.mjs dismiss-tour
```

That clicks **Skip tour**, not **Next**.

Teardown is the helper's `cleanup` command. See Cleanup.

Desktop alternative (not the helper default): `pnpm app` after `pnpm install`. Ready when the WebView window title is `Board` (or `Name · Board`). There is no CDP port on the Tauri WebView unless you add one; do not pretend `localhost:1420` is the WebView. If Tauri deps are missing, record that blocker and stay on Vite+CDP.

## Doctor

Read-only. Run it before the first drive, after any failed drive, and whenever the window looks wrong.

```bash
node .cursor/skills/verify-board/scripts/verify-board.mjs doctor
```

Worth driving only when all of these hold:

- Session `vitePid` and `chromePid` are alive.
- `http://localhost:1420/` answers.
- On Linux, `/proc/<chromePid>/cmdline` contains this run's `--user-data-dir`.
- CDP `/json` has a page whose URL is the Board preview (`localhost:1420` or `127.0.0.1:1420`), not `chrome://`.
- `document.title` is `Board` or ends with ` · Board`, and `body.dataset.host` is `browser`.
- Demo sessions: `body.dataset.open === 'true'`. Home sessions: `#welcome` visible.

A first-run tour (`#tour` not hidden, `body.dataset.tour === 'true'`) does not fail doctor. Dismiss it before clicking the canvas or title bar. Never drive a Chrome or Vite process this run did not launch.

## Drive

There is no Playwright/Cypress project in this repo. Do not call `window.__boardDemo.agentAdds()` unless the feature file's agent-add preview path says to; it is not paste, drop, or MCP.

Drive with the helper, which talks CDP to the live preview. Prefer `#id`, `[data-id]`, `[data-tool]`, `[data-field]`, and ARIA names from this checkout. `element.click()` fires the same listeners the user click does.

```bash
node .cursor/skills/verify-board/scripts/verify-board.mjs click --id ai-chip
node .cursor/skills/verify-board/scripts/verify-board.mjs click --selector '#settings button.segment' --text 'View only'
node .cursor/skills/verify-board/scripts/verify-board.mjs snapshot --out .cursor/skills/verify-board/evidence/mcp-access/after.json
node .cursor/skills/verify-board/scripts/verify-board.mjs screenshot --out .cursor/skills/verify-board/evidence/mcp-access/after-view-only.png
```

Stable handles from this checkout:

| Control | Handle | Result |
| --- | --- | --- |
| Home / all boards | `#home-button` | `#welcome` shown; `body.dataset.home === 'true'` |
| New board | `#new-board-name`, submit `#new-board` | `body.dataset.open === 'true'`; `#board-name` shows the title |
| Open project folder | `#welcome-open` or Ctrl O | Desktop: folder picker. Memory preview: always opens `demo-project` |
| MCP chip | `#ai-chip` | `data-mode` is `off` / `read` / `write`; title `MCP access: Off` / `View only` / `View & add` |
| Settings | `#open-settings` | `#settings` not hidden; gear `aria-expanded="true"` |
| MCP radios | `#settings [role="radiogroup"][aria-label="MCP access"] button.segment` | clicked radio `aria-checked="true"`; chip mode matches (`off` / `read` / `write`) |
| Toolbar | `button.tool[data-tool="note"\|"zone"\|"pin"\|"arrange"\|"delete"\|"fit"\|"gray"\|"undo"\|"redo"]` | Note/Zone/Focus/Arrange/Delete/Fit/Grayscale/Undo/Redo |
| Canvas item | `.item[data-id="img_sunset"]` (demo ids in `MemoryBackend.seed`) | `.selected`; `#inspector` shown for images/zones |
| Canvas zone | `.zone[data-id="zone_avoid"]` | `.selected`; inspector kind `Zone` |
| Note for AI | `#inspector [data-field="note"]` | image `note` updates; `.badge.has-note` when non-empty |
| Focus | `#inspector [data-toggle="pinned"]` or `data-tool="pin"` or key `P` | `.item.pinned`; badge `Focus`; `aria-pressed` |
| Zone name / meaning | `#inspector [data-field="name"]`, `[data-field="meaning"]` | label `.zone-name` matches name |
| Crop | inspector **Crop** or key `C` | `.item.cropping`; overlay `.crop-win` |
| Skip tour | `#tour button.tour-skip` | `#tour` hidden |

`eval --expr` is for reading state, not for assigning `store.doc` or flipping `dataset.mode` by hand. If you set internals, you did not drive the user path.

Feature recipes: `features/README.md`.

## Evidence

Write proof under `.cursor/skills/verify-board/evidence/<feature-id>/`. That directory is gitignored on purpose (public-repo PII guard: no home paths, OS usernames, or non-noreply emails in commits). Cleanup deletes the run directory only, never `evidence/`.

Committed summary of a proof belongs in `.cursor/skills/verify-board/PROOF.md`: what was driven, what changed, relative evidence filenames. No resolved home paths, tokens, emails, or private URLs.

Minimum for a UI claim:

1. A real user path (click, key, submit, paste/drop harness) from the table above.
2. State before the action and state after (`before.json` / `after.json` from `snapshot`).
3. A screenshot of the window after the action (`Page.captureScreenshot`). The title bar must show **Board** or the board name, and the **MCP** chip.
4. Side effects the action is supposed to cause. MCP radio: `#ai-chip[data-mode="read"]` and the **View only** segment `aria-checked="true"`. Focus: `.item.pinned` and a Focus badge. New board: `#welcome` hidden and `#board-name` text. In the Vite preview, disk is in-memory — do not demand a `.board/` folder. On Tauri, a saved board is `.board/board.json` plus `assets/` under the project or library root (see `docs/FORMAT.md`).

Mocks of the canvas are not allowed. Do not treat `pnpm test` / `pnpm typecheck` as UI proof. Do not treat files under `docs/images/` as proof of this run.

The in-memory backend is the product's browser preview, not a test double. It does skip desktop-only work: image re-encode lives in Rust, `fetchImage` throws, `moveBoard` throws. When the recipe needs those, you need Tauri — or report the skip with the unmet precondition.

## Cleanup

```bash
node .cursor/skills/verify-board/scripts/verify-board.mjs cleanup
```

Sends `SIGTERM` to the process groups recorded at launch (`session.vitePgid`, `session.chromePgid`), then `SIGKILL` if those pids are still alive. Then deletes the whole run directory (session JSON, Chrome user-data, Vite log). Does not stop a `pnpm dev` this run did not start. Does not touch port 1420 unless our Vite owns it.

Never `pkill chrome`, `pkill node`, or kill by process name. That can destroy a developer's own Board preview. Never delete `evidence/` or `PROOF.md`. After cleanup, `ls` the named evidence path and confirm the files are still there.

If this run started `xvfb-run`, kill that xvfb pid the same way, by pid, not by name.

## Helpers

`scripts/verify-board.mjs` is executable. Invoke it with `node` from the repo root as shown in Launch, Doctor, Drive, and Cleanup.

One-shot proof of the mapped **mcp-access** feature (demo board, skip tour, open the MCP chip, choose **View only**, write evidence):

```bash
node .cursor/skills/verify-board/scripts/verify-board.mjs drive-mcp-access
```

Isolation: Vite `strictPort: 1420` — one preview at a time. Each Chrome must have its own `--user-data-dir` and `--remote-debugging-port` (`BOARD_VERIFY_DIR` per run). Do not attach to the default Chrome profile. Shared `localStorage` keys if you forget `--user-data-dir` include `board.tourDone`, `board.recents`, `board.last`, `board.keys`.
