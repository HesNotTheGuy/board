# Capturing the demo takes

Every frame in the demo is the real app. This page covers how to film the seven takes in `STORYBOARD.md` so `stitch.mjs` can cut them without further editing.

## Naming and where takes go

Put takes in `board-demo-clips/` at the repo root (gitignored). A take is matched by its beat number at the start of the file name, so `03-zones.mp4`, `03-palette-take2.mov` and `07-end.webm` all count, and `00-…` files (assembled cuts) are ignored. If a number has several takes, the first alphabetically wins.

| File | Beat |
| --- | --- |
| `01-open` | open a board |
| `02-paste-drop` | paste / drop references and place them |
| `03-zones` | make a zone, name it, give it a meaning |
| `04-focus-note` | Focus pin + Note for AI |
| `05-mcp-view-only` | MCP chip → View only |
| `06-agent-add` | an AI tool adds an image (optional) |
| `07-fit-all` | Shift 1 to the whole board, hold |

Any missing take falls back to a still (see `shots.json`), so a partial set still renders. Run `node docs/demo/stitch.mjs --dry-run` to see which source each shot will use.

Takes can run long: `in` (seconds to skip), `speed` and `dur` in `shots.json` trim each one. A take shorter than its slot holds its last frame.

## Windows (primary): the desktop app

1. **Board.** Build and install the app (`pnpm app:build --bundles nsis`) or run `pnpm app`. Prepare one board in advance with the references from `board-launch-assets/` for the paste beat, plus a second, already-arranged board to cut to if a take goes wrong. Close the first-run tour before filming (it shows once; **Show the tour** in Settings brings it back if needed).
2. **Window.** Maximize Board on a 1920x1080 display, or 2560x1440 if you want room for the MCP chip push-in. Turn off Windows notifications (Focus assist) and hide desktop icons. Keep **Keep on top** off.
3. **Recorder.** OBS: Window Capture of Board (Windows 10 1903+ capture method), canvas = output = the window size, 30 fps, recording format MP4 (or MKV, then remux), encoder x264 CRF 16 or NVENC CQ 18, cursor capture on. The built-in Snipping Tool recorder also works for single takes.
4. **Settings to show.** Start with MCP access **Off** so the chip is grey for shot 5.
5. **Pace.** Move the mouse slowly and in straight lines; pause half a second before each click and after each result. Start every take with 1 s of stillness and end with 1.5 s; the stitcher trims and crossfades.
6. **Cursor between takes.** The cursor jumps at each crossfade if one take ends where the next doesn't start. End each take with the cursor parked near where the next one begins (shot 5 ends near the bottom left, where shot 6's toast appears), or move it off the canvas at both ends.
7. **Retakes are cheap.** Record each beat as its own file. Ctrl Z restores the board between attempts.

### An honest agent-add (shot 6)

This shows a real MCP call landing in the open app. No API keys or accounts are involved: it's a local stdio client talking to Board's MCP server.

1. Build the server once: `pnpm --filter @board/mcp build`.
2. In the app, open the board's **project folder** (Ctrl O), so the board lives in `<project>/.board/`. Set MCP access to **View & add**.
3. Pick the image to add: a real second attempt at the focused reference (a re-grade, a later screenshot, an image you generated earlier). Don't use an image you'd be uncomfortable presenting as the tool's output.
4. Start recording, then in a terminal (off screen, or on screen if you want to show the call):

   ```bash
   node packages/mcp/scripts/demo-add.mjs --root <project folder> --image <attempt.png> --caption "v2: warmer key light"
   ```

   It calls `overview`, picks the first Focus pin, and calls `add` with `near` set to it. The image appears beside the reference, outlined in mint and labelled **Image agent** (change it with `--name`). Click **Show** on the toast.

With MCP set to View only, the same command is refused ("MCP access is view-only…"), which is also a fair thing to show if you want shot 5 to prove the setting.

Alternatively, ask a real assistant that's connected to Board (Claude Code, Cursor, …) to add an image; its client name becomes the label.

## Browser preview (Linux, VMs, CI)

The Tauri app needs WebKitGTK on Linux, which cloud VMs often lack. `pnpm dev` serves the same UI in a browser at `localhost:1420` with an in-memory backend: the title bar says *Preview, not saved*, and `?demo` opens a sample board. It's the real interface, so takes from it are fine for drafts and for testing the cut.

`docs/demo/capture-preview.mjs` films all seven beats there with real mouse and keyboard input:

```bash
pnpm dev                                         # terminal 1
node docs/demo/capture-preview.mjs               # terminal 2: takes land in board-demo-clips-preview/
node docs/demo/stitch.mjs --clips board-demo-clips-preview
```

It needs Linux with X11, `google-chrome` (or `CHROME=…`), `ffmpeg`, `xdotool` and `xclip`, and a display of at least 1920x1080 with nothing drawn over its top-left corner (set desktop panels to auto-hide). It runs Chrome fullscreen at 1.5x scale so the UI is legible at 1080p.

Its agent-add take uses the preview's built-in simulation (`__boardDemo.agentAdds()`), labelled "Demo Agent", because the in-memory backend can't receive MCP calls. For a launch cut, replace it with a desktop take as above.

To film the preview by hand instead (any OS): open Chrome with `--app=http://localhost:1420/?demo` so there's no tab strip or address bar, and record just that window. If a take does include browser chrome, set `clipCrop` (or a shot's `crop`) in `shots.json` to cut it off, e.g. `[0, 0.072, 1, 0.928]` drops the top 7.2%.

## Before anything is published

Board is public, so check every take, still and the final cuts frame by frame for:

- usernames, home folders or project paths (window titles, the **Recent** list on the home screen, terminal prompts, Explorer breadcrumbs);
- email addresses, notifications, other windows or tabs;
- tokens or keys in any terminal shown on screen;
- references you don't have the right to show.

`board-demo-clips/` and `docs/demo/out/` are gitignored; `pnpm check:pii` covers text files but not pixels.
