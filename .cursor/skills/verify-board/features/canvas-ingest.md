# Canvas ingest

Paste and drop are how images (and leftover text) land on the open canvas. A new image is selected. The empty-board hint (`#hint`) hides once any item or zone exists.

## Sub-features

- `paste-image` adds a raster file from the clipboard via the document `paste` listener.
- `paste-text` adds a note when the clipboard is plain text (not an image URL).
- `drop-files` adds dropped image files at the pointer (drop veil `#drop-veil`).
- `empty-hint` shows **Paste or drop images** only while the open board has no items and no zones.

## How to get to it (user POV)

- Open a board (demo or **New board**), then paste with Ctrl V while focus is not in an input, textarea, or contenteditable.
- Drag image files from the desktop, or an image from a web page, onto `#viewport`. The veil reads **Drop to add**.
- Paste an `https://` image URL: desktop downloads it (`fetchImage`); the Vite preview throws `Downloading web images needs the desktop app` and may fall back to a text note.

## Driving it with verify-board

Preconditions:

- Doctor is green. Tour is dismissed.
- A board is open (`body.dataset.open === 'true'`). For a truly empty canvas, use `launch --home` then **New board**, not `?demo` (demo already has items, so `#hint` is hidden).
- Drive the `paste` / `drop` listeners in `app/src/ingest.ts`. Do not `store.commit` items by eval.

- **Empty board (optional).** From a new board with no items, snapshot. `#hint` is not hidden. `#hint .hint-big` mentions paste or drop.
- **Paste a PNG.** Run `... paste-png`. That dispatches a `paste` event with a File, the same listener Ctrl V uses (CDP cannot fill the OS clipboard with a File here). A new `.item.image` appears and is `.selected`. `#hint` hides.
- **Paste text.** On a board, run `... paste-text --value 'No drop shadows'`. A `.item.note` is selected. `.note-text` contains that string (or the canvas editor is open on it).
- **Proof.** Snapshot and screenshot. Run `... snapshot --out .cursor/skills/verify-board/evidence/canvas-ingest/after.json` and `... screenshot --out .cursor/skills/verify-board/evidence/canvas-ingest/after-paste.png`. Count of `.item.image` increased by one for `paste-png`. Title bar still shows **MCP**.

## Gotchas

- Paste is ignored when the target or `document.activeElement` is editable (`isEditableTarget`). Blur the inspector note field first.
- Images over 40 MB are rejected (`MAX_BYTES` in ingest and the Rust sanitizer).
- The preview does not re-encode or strip GPS; that is desktop `import_asset`. `fetchImage` is desktop-only.
- Demo launch is a bad empty-hint check: seed items already hide `#hint`.
- `__boardDemo.agentAdds()` is not ingest. It is the MCP-arrival preview; see [MCP access](./mcp-access.md).
