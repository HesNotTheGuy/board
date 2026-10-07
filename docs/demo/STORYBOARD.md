# Board demo: storyboard and script

About 30 seconds (or about 44 for an assembled cut), seven shots, real app footage only: the v2 capture, with the reference images from `board-demo-refs/` pasted into the app. Each shot has one job and one caption. Timings below are what `shots.json` produces with its 0.35 s crossfades; change `dur` there and the cut, the captions and the `.srt` all follow.

The one idea to get across: **you arrange references the way you think about them, and your AI tools read that arrangement.**

## Shot list

| # | Take (matched by number) | In → out | On screen | Caption (burned in) |
| --- | --- | --- | --- | --- |
| 1 | `01-open` | 0.0 → 3.8 | Home screen, click into a board. The board appears already fitted. | An image board on an infinite canvas. |
| 2 | `02-paste-drop` | 3.5 → 8.7 | Ctrl V a mood image, then drop the palette and layout refs in from Explorer. Drag them into place. | Paste or drop references: mood, palette, layout. |
| 3 | `03-zones` | 8.3 → 12.9 | Select the mood refs, press F, type the zone name and its one-line meaning. An Avoid zone with the anti-reference is visible on the board. | Group them into zones. Avoid holds what you don't want. |
| 4 | `04-focus-note` | 12.6 → 17.8 | Click the key reference, press P (FOCUS badge appears), type a Note for AI in the inspector. | Pin the ones that matter with Focus, and leave a note for the AI. |
| 5 | `05-mcp-view-only` | 17.4 → 22.4 | Click the grey MCP chip, choose View only, chip turns blue, toast confirms. Esc. | MCP access is off until you turn it on: view only, or view and add. |
| 6 | `06-agent-add` *(optional)* | 22.1 → 27.1 | An image arrives next to the focused reference, outlined in mint with the tool's name. Click Show on the toast. | A connected tool can put its attempt next to the reference it aimed for. |
| 7 | `07-end` | 26.7 → 31.5 | Esc, Shift 1. The camera eases out to the whole board. Hold. | Plain files on your machine. No account. `github.com/HesNotTheGuy/board` |

Without shot 6 (`--skip-optional`) the cut is about 27 s.

### Framing notes per shot

1. **Open.** Start on the home screen so the first frame is calm. Don't show a file picker; use a board from **Your boards** or the demo board.
2. **Paste / drop.** Two or three refs from `board-demo-refs/` are enough: one mood image pasted, then the palette and layout dropped from Explorer (keep the Explorer window tidy and its path bar out of frame). Leave them in empty canvas, not on top of each other.
3. **Zones.** The zone label (italic serif, colored) is the payoff; make sure it's on screen when the name finishes typing. The inspector opens on the right, so keep the selection in the left two thirds.
4. **Focus + note.** Type the note at a readable pace (about 4 to 5 characters per second). End with the cursor off the text.
5. **MCP chip.** The chip is small. If the take is at 1080p, consider a 1.3x push-in on this shot (record at 1440p or larger, or crop in the editor). Hold a beat after the chip turns blue.
6. **Agent add.** Only use footage of a real add: either the desktop app receiving an MCP `add` (see `CAPTURE.md`) or the browser preview's simulation, which labels the item "Demo Agent". Never retouch a label to name a real assistant.
7. **Fit all.** Let the fit animation finish and hold at least 1.5 s on the full board: zones, notes, the Focus badge and the mint outline all in one frame. This is the thumbnail frame.

## Voice-over (optional)

Plain and unhurried, about 2.5 words a second. Each line fits inside its shot. There are two versions: one for the ~30 s stitched cut, and a slightly fuller one for a ~44 s cut where each beat runs about 6 s.

For any cut, the cue times come from the `.srt` that `stitch.mjs` writes (`--onto` for a cut assembled elsewhere, see the README). Start each line on its cue.

### ~30 s cut

| Shot | Starts | Line |
| --- | --- | --- |
| 1 | 0.0 | This is Board, an image board for AI references. |
| 2 | 3.5 | Paste or drop what you're working from: mood images, a palette, a layout. |
| 3 | 8.3 | Group them into zones. Avoid holds what you don't want. |
| 4 | 12.6 | Pin what matters with Focus, and leave the model a short note. |
| 5 | 17.4 | AI tools get nothing until you turn MCP access on. |
| 6 | 22.1 | With view and add, a tool can put its attempt beside yours. |
| 7 | 26.7 | It's plain files on your machine. Board is open source, on GitHub. |

### ~44 s cut

About 15 words a beat, still one thought each.

| Shot | Line |
| --- | --- |
| 1 | This is Board: an image board for the references you give an AI. |
| 2 | Paste or drop whatever you're working from, mood images, a palette, a rough layout, and put it where it makes sense. |
| 3 | Group references into zones and say in a line what each one is for. Avoid holds what you don't want. |
| 4 | Pin the ones that matter most with Focus, and leave the model a short note. |
| 5 | AI tools get nothing until you turn MCP access on. View only lets them read the board. |
| 6 | With view and add, a tool can put its attempt right next to the reference it was aiming for. |
| 7 | It's plain files on your machine, with no account. Board is open source, on GitHub. |

Record as one WAV, then `node docs/demo/stitch.mjs --vo vo.wav` (or `--onto <cut> --vo vo.wav` for an assembled cut). If a line runs long, raise that shot's `dur` rather than speeding up the read; for an assembled cut, trim the line instead.

No music is required. If you add some, keep it under the VO (around -24 LUFS for the bed) and mix it before passing the file to `--vo`.

## Caption rules

- One sentence per shot, says what the viewer is looking at. No adjectives doing the selling ("powerful", "seamless", "supercharge").
- Don't describe the references as photos, screenshots or anyone's own work; they're generated images, so captions and VO call them references, mood images, a palette, a layout.
- Name only what's on screen. The agent shot says "a connected tool", not a product name, unless that product's name is the label in the take.
- Captions are burned into both cuts and also written to `board-demo.srt` for players that prefer sidecar captions (X, YouTube).

## 9:16 cut

The vertical cut is built from the same takes; nothing is re-filmed.

- Frame: 1080x1920. The caption sits at the top (from y = 290), a square 1080x1080 window of the 16:9 frame sits below it (y = 600 to 1680) at 1:1, so it's as sharp as the source. The bottom 240 px stay empty because Shorts, Reels and X draw their own controls there.
- Each shot's `v` picks where the square window sits horizontally (0 = left edge, 1 = right edge), or `[start, end]` to pan during the shot. Defaults follow the action: the inspector and the MCP chip are on the right (0.78 to 0.86), the agent's toast is bottom left (pans 0.25 → 0.42).
- Captions are re-wrapped to about 28 characters a line; the script warns if one needs more than three lines.

## Export

| | 16:9 | 9:16 |
| --- | --- | --- |
| Size | 1920x1080 | 1080x1920 |
| Video | H.264 High, yuv420p, 30 fps, CRF 18 | same |
| Audio | AAC 160 kb/s, 48 kHz stereo (silence if no VO) | same |
| Container | MP4 with `+faststart` | same |
| For | X timeline, YouTube, README / release page | X vertical, YouTube Shorts, Reels |

Both stay well inside X's limits (2:20, 512 MB) and Shorts' 60 s. Upload the `.srt` alongside on platforms that take one, and use the last shot's held frame for the thumbnail.
