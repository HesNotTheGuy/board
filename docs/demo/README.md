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

## Captions and VO for an assembled cut

If the cut was already put together elsewhere (for example `board-demo-clips/00-demo-16x9.mp4` and `00-demo-9x16.mp4` next to the beat takes `01-…` to `07-…`), `stitch.mjs` can caption it without re-cutting:

```bash
node docs/demo/stitch.mjs --onto board-demo-clips/00-demo-16x9.mp4 --dry-run   # print the cue sheet
node docs/demo/stitch.mjs --onto board-demo-clips/00-demo-16x9.mp4             # → docs/demo/out/00-demo-16x9.srt
node docs/demo/stitch.mjs --onto board-demo-clips/00-demo-16x9.mp4 --burn      # also 00-demo-16x9-captioned.mp4
node docs/demo/stitch.mjs --onto board-demo-clips/00-demo-9x16.mp4 --burn
```

There's one cue per shot, with the captions from `shots.json`. The timing comes from the lengths of the beat takes, scaled to the cut's length. That's exact when the cut is the takes back to back, and close when they were trimmed or crossfaded. When it isn't close enough, pass the real shot starts: `--starts 0,5.8,12.1,18.4,24.9,31.2,37.5`. `--burn` uses the same layout as the stitched cuts: lower-left box for 16:9, text in the top band for 9:16. If the 9:16 cut already has something in its top band, upload the `.srt` instead of burning. `--vo vo.wav` swaps in a voice-over (script in `STORYBOARD.md`, 44 s version).

## Status

- **Board's real capture is done:** a 44 s 16:9 cut, a 9:16 cut and beat takes `01` to `07`, assembled outside this repo. They aren't committed here. The remaining step is captions and VO for those cuts, using `--onto` above. I tested it on stand-in cuts built the same way, but not on Board's files.
- The stitcher, captions, VO scripts (30 s and 44 s) and both aspect ratios work and were tested on Linux with ffmpeg 6.1. Use it to re-cut from the beat takes, e.g. a tighter 30 s version.
- `preview/` holds a draft cut from browser-preview takes of the demo board (the title bar shows *Preview, not saved*). It's for comparing pacing, not for publishing.
- The still crops for `board-launch-shots/*.png` in `shots.json` haven't been rendered. They only matter if a beat take is missing.
