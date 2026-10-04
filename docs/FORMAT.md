# Board format (v1)

A board lives in the project it belongs to, or, before there is a project, in the app's library (`<OS app data>/com.hesnottheguy.board/boards/<name>/`, overridable with `BOARD_LIBRARY`). Both use the same layout, and **Move to project…** just moves the `.board/` folder:

```
your-project/            (or <library>/<name>/)
  .board/
    board.json        the board
    assets/           sanitized images (re-encoded png/jpg), named by content hash: <sha256[0:16]>.<ext>
    board.lock        exists only while someone is writing
```

Types are defined in [`packages/format/src/types.ts`](../packages/format/src/types.ts); this file explains the intent.

## board.json

```jsonc
{
  "format": 1,
  "title": "Neon alley mood",      // optional display name; defaults to the folder name
  "rev": 42,                       // bumped on every write
  "updatedAt": "2026-09-30T12:00:00.000Z",
  "items": [
    {
      "id": "img_k3j9x2",
      "kind": "image",
      "asset": "assets/3f2a9c01d4e5b6a7.png",
      "srcW": 1920, "srcH": 1080,  // source pixels
      "x": 0, "y": 0, "w": 640, "h": 360,  // world-space rect
      "z": 3,                      // stacking order
      "addedBy": "user",           // or "agent" (then "agent": "Cursor", the client's name)
      "createdAt": "…",
      "pinned": true,              // focus: agents weigh these first
      "flipX": false,
      "note": "this lighting, but warmer",   // the user's instruction
      "caption": "Dusk street, sodium lights", // an agent's cached description
      "tags": ["lighting"],
      "source": "https://…"
    },
    { "id": "note_a8d0q1", "kind": "note", "text": "No drop shadows", "x": 0, "y": 400, "w": 300, "h": 180, "z": 4, "addedBy": "user", "createdAt": "…" }
  ],
  "zones": [
    { "id": "zone_p0c2m9", "name": "Avoid", "note": "anti-references", "color": "rose", "x": 900, "y": 0, "w": 600, "h": 400 }
  ]
}
```

- An item belongs to the innermost zone that contains its center. Membership is spatial, not stored.
- Optional fields are omitted rather than set to empty values, which keeps diffs small.
- The parser is lenient: unknown fields are dropped and broken entries are skipped, but invalid JSON is an error. Writers never overwrite a file they couldn't parse.

## Concurrency

The desktop app and the MCP server can write at the same moment (you drag an image while an agent adds a screenshot). The rules:

1. **Lock.** A writer exclusively creates `board.lock`, retries every 25 ms for up to 3 s, and treats a lock older than 10 s as stale.
2. **Atomic replace.** Write `board.json.tmp-*`, then rename it over `board.json`.
3. **MCP server:** under the lock it does a fresh read, modify, write with `rev + 1`.
4. **App:** it holds edits in memory and saves with compare-and-swap. The write only lands if the disk is still at the `rev` the app last saw. Otherwise it gets the newer board back, 3-way merges, and retries. A file watcher triggers the same merge when an agent writes.

### Merge rules (`mergeById`)

Per item or zone, by id:

- added on either side → kept
- deleted on either side → deleted (deletion beats a concurrent edit)
- edited on both sides → merged field by field; when the same field changed on both, the local side wins

Undo and redo reuse the same merge (`merge(after, before, current)`), so undoing your move never removes an image an agent added in the meantime.
