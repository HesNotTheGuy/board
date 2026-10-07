# Board demo

A short product demo of Board (30 to 45 s), built from real app footage, in a 16:9 cut and a 9:16 cut.

The footage is the v2 capture: the real app, with the reference images from `board-demo-refs/` (mood, palette, avoid, layout) pasted onto a board. Takes and an assembled cut go in `board-demo-clips-v2/`. Both folders are gitignored, so nothing lands in the repo by accident.

| File | What it is |
| --- | --- |
| [`STORYBOARD.md`](STORYBOARD.md) | Shot list, captions, voice-over script, 9:16 plan, export settings |
| [`CAPTURE.md`](CAPTURE.md) | How to film the takes (Windows desktop app first; browser preview on Linux) |
| [`shots.json`](shots.json) | The cut: per shot, its take number, timing, caption, still fallbacks, vertical framing |
| [`stitch.mjs`](stitch.mjs) | Builds both cuts, an `.srt` and a contact sheet with ffmpeg, or captions a cut made elsewhere |
| [`capture-preview.mjs`](capture-preview.mjs) | Films the seven beats in the browser preview (Linux + X11), for testing the cut |
| [`../../packages/mcp/scripts/demo-add.mjs`](../../packages/mcp/scripts/demo-add.mjs) | A real MCP `add` next to the Focus pin, for the agent-add take |

## Render

Needs Node 20+ and ffmpeg/ffprobe on PATH (Windows: `winget install Gyan.FFmpeg`). Run `pnpm install` first so the captions can use the app's own fonts (Instrument Serif and Martian Mono).

```bash
node docs/demo/stitch.mjs --dry-run       # which take or still each shot will use
node docs/demo/stitch.mjs                 # takes from board-demo-clips-v2/ → docs/demo/out/
```

Output in `docs/demo/out/` (gitignored): `board-demo-16x9.mp4`, `board-demo-9x16.mp4`, `board-demo.srt`, `board-demo-sheet-16x9.png`.

Useful options: `--clips <dir>` (another take folder), `--stills-only` (ignore takes), `--skip-optional` (drop the agent-add shot), `--vo vo.wav`, `--format 16x9|9x16`, `--no-captions`. `--help` lists them all.

Takes are matched by beat number (`01-…` to `07-…`); `00-…` files are ignored. Each shot uses its take if there is one, otherwise the real screenshots listed for it in `shots.json`, so a partial set still renders.

When the takes land, run `--dry-run`, then a render, and set each shot's `in` (seconds to skip), `speed` and `dur` in `shots.json` so the action fits its slot. They start neutral: from 0 s, at normal speed.

## Captions and VO for an assembled cut

If the v2 cut was put together elsewhere (for example `board-demo-clips-v2/00-demo-16x9.mp4` and `00-demo-9x16.mp4` next to the beat takes), `stitch.mjs` can caption it without re-cutting:

```bash
node docs/demo/stitch.mjs --onto board-demo-clips-v2/00-demo-16x9.mp4 --dry-run   # print the cue sheet
node docs/demo/stitch.mjs --onto board-demo-clips-v2/00-demo-16x9.mp4             # → docs/demo/out/00-demo-16x9.srt
node docs/demo/stitch.mjs --onto board-demo-clips-v2/00-demo-16x9.mp4 --burn      # also 00-demo-16x9-captioned.mp4
node docs/demo/stitch.mjs --onto board-demo-clips-v2/00-demo-9x16.mp4 --burn
```

There's one cue per shot, with the captions from `shots.json`. Cue timing comes from the lengths of the beat takes, scaled to the cut's length. That's exact when the cut is the takes back to back, and close when they were trimmed or crossfaded. When it isn't close enough, pass the real shot starts: `--starts 0,5.8,12.1,18.4,24.9,31.2,37.5`.

`--burn` uses the same layout as the stitched cuts: a lower-left box for 16:9 (top for the two toast shots), and the top band for 9:16. If the 9:16 cut already has something in its top band, upload the `.srt` instead. `--vo vo.wav` swaps in a voice-over; the script is in `STORYBOARD.md`.

## Status

- **Waiting on the v2 capture.** Nothing in `board-demo-clips-v2/` has been rendered yet. The v1 takes and the draft renders made from browser-preview takes were dropped as not good enough to show.
- The stitcher, `--onto` captioning, the VO scripts (30 s and 44 s) and both aspect ratios were tested on Linux with ffmpeg 6.1, using stand-in takes and cuts.
- The still crops for `board-launch-shots/*.png` in `shots.json` haven't been rendered. They only matter if a beat take is missing.
