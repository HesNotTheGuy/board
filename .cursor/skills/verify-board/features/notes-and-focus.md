# Notes and focus

A selected image opens the inspector. **Note for AI** tells models what to take from that reference. **Focus** pins the ones that matter most (overview marks them with a star). Crop and flip live on the same inspector row.

## Sub-features

- `select-image` opens the inspector with kind **Reference** and the item id.
- `note-for-ai` writes `#inspector [data-field="note"]` and shows a Note badge when non-empty.
- `focus-pin` toggles `.item.pinned` and a Focus badge (toolbar pin, inspector toggle, or key `P`).
- `crop-mode` enters non-destructive crop (`C` or **Crop**); Enter applies, Escape cancels; **Reset crop** restores the full image.
- `flip` mirrors via **Flip H** / **Flip V** or Shift H / Shift V; the `.img-frame` transform reflects it.

## How to get to it (user POV)

- Click an image on the canvas (demo: `img_sunset`, `img_card`, `img_grid`, `img_busy`).
- Type in **Note for AI**. Cached **Caption** is editable; tags are comma-separated.
- Click **Focus** in the inspector or the toolbar pin, or press `P` while the canvas is focused.
- Press `C` or click **Crop**. Drag edges, Enter to apply, Esc to cancel.
- Click **Flip H** / **Flip V**.

## Driving it with verify-board

Preconditions:

- Doctor is green on a demo launch. Tour is dismissed.
- You are proving inspector fields and toolbar/keys, not `item.note = ...` via eval.
- Demo `img_sunset` already has `pinned: true` and a note. Use `img_card` when you need an unfocused image with no note.

- **Select an unfocused image.** Click the card. Run `... click --selector '.item.image[data-id="img_card"]'`. `#inspector` is not hidden. `.insp-kind` reads `Reference`. `.insp-id` reads `img_card`. `[data-toggle="pinned"]` `aria-pressed` is `false`.
- **Baseline snapshot.** Run `... snapshot --out .cursor/skills/verify-board/evidence/notes-and-focus/before.json`. That item's `pinned` is false. `noteField` is empty.
- **Write a note.** Focus **Note for AI**. Run `... fill --selector '#inspector [data-field="note"]' --value 'This type, more air'`. The field holds that text. After blur, the image shows `.badge.has-note`.
- **Pin focus.** Choose **Focus**. Run `... click --selector '#inspector [data-toggle="pinned"]'`. The item has class `pinned`. `aria-pressed` is `true`. A `.badge.focus` reads `Focus`.
- **Keyboard sibling.** Deselect, re-select `img_card`, press `P` after focusing `#viewport`. Run `... click --id viewport` then `... press --key p`. Same pinned class (toggle: a second `P` unpins).
- **Crop (optional).** With one image selected, run `... press --key c`. The item has class `cropping`. `#overlay .crop-win` exists. Escape cancels (`press --key Escape`).
- **Proof.** Snapshot and screenshot after the note+focus. Run `... snapshot --out .cursor/skills/verify-board/evidence/notes-and-focus/after.json` and `... screenshot --out .cursor/skills/verify-board/evidence/notes-and-focus/after-focus.png`. Inspector still shows `img_card`. Focus toggle is pressed.

## Gotchas

- A single selected *note* does not open the side inspector; it edits on the canvas (`.note-text`). Toolbar **Note** (`data-tool="note"` or `N`) creates a note, it does not fill **Note for AI**.
- Inspector rebuilds when the selection key changes. Type via `fill` (input events), not by setting `HTMLTextAreaElement.value` without an `input` event — `Inspector` listens for `input`.
- Shortcuts are ignored while an input/textarea is focused (`isEditableTarget`). Blur before `P`, `C`, or `N`.
- Demo sunset is already focused. Toggling it *off* is not the same as proving you can pin `img_card`.
- Crop is non-destructive (`item.crop` fractions). **Reset crop** only appears when a crop exists.
