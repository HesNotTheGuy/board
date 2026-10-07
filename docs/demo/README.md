# Board demo

A short product demo of Board (about 30 s), built only from real app footage and real screenshots, in a 16:9 cut and a 9:16 cut.

| File | What it is |
| --- | --- |
| [`STORYBOARD.md`](STORYBOARD.md) | Shot list, captions, voice-over script, 9:16 plan, export settings |
| [`CAPTURE.md`](CAPTURE.md) | How to film the takes (Windows desktop app first; browser preview on Linux) |
| [`shots.json`](shots.json) | The cut: per shot, its take name, timing, caption, still fallbacks, vertical framing |
| [`stitch.mjs`](stitch.mjs) | Builds both cuts, an `.srt` and a contact sheet from `shots.json` with ffmpeg |
| [`capture-preview.mjs`](capture-preview.mjs) | Films all seven takes in the browser preview (Linux + X11) |
| [`preview/`](preview/) | Draft renders made with `capture-preview.mjs` takes, for review |
| [`../../packages/mcp/scripts/demo-add.mjs`](../../packages/mcp/scripts/demo-add.mjs) | A real MCP `add` next to the Focus pin, for the agent-add take |

## Render

Needs Node 20+ and ffmpeg/ffprobe on PATH (Windows: `winget install Gyan.FFmpeg`). Run `pnpm install` first so the captions can use the app's own fonts (Instrument Serif and Martian Mono).

```bash
node docs/demo/stitch.mjs --dry-run       # which take or still each shot will use
node docs/demo/stitch.mjs                 # takes from board-demo-clips/ → docs/demo/out/
```

Output in `docs/demo/out/` (gitignored): `board-demo-16x9.mp4`, `board-demo-9x16.mp4`, `board-demo.srt`, `board-demo-sheet-16x9.png`.

Useful options: `--clips <dir>`, `--stills-only` (ignore takes), `--skip-optional` (drop the agent-add shot), `--vo vo.wav`, `--format 16x9|9x16`, `--no-captions`. `--help` lists them all.

Each shot uses the first source it finds: a take in the clips folder, then the stills listed for it in `shots.json`. The stills are real captures: the launch shots in `board-launch-shots/` if present, then the README images in `docs/images/`. So the cut always renders, and gets better as takes land.

## Status

- The cut, captions, VO script and both aspect ratios are done and tested on Linux with ffmpeg 6.1.
- `preview/` holds a full draft cut from browser-preview takes of the demo board (the title bar shows *Preview, not saved*). It's for judging pacing and framing, not for publishing.
- The launch cut needs the desktop takes from `CAPTURE.md`, in `board-demo-clips/`. Once they're in, re-check `in` / `speed` / `dur` and the vertical `v` per shot with `--dry-run` and a render.
- The still crops for `board-launch-shots/*.png` in `shots.json` were set from the shared captures and haven't been rendered yet; check them with `--stills-only` once those files are in the repo.
