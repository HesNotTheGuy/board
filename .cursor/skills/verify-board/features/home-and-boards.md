# Home and boards

The start screen is where a user begins a standalone board or opens a project folder. The logo (top left) brings it back. In the Vite preview, boards exist only in memory; the desktop app writes `.board/` under a library folder or a project.

## Sub-features

- `home-visible` shows **Start**, the new-board field, and **Open project folder**.
- `new-board` creates a standalone board from the name field and opens the canvas.
- `open-project` opens a project folder (desktop picker; memory preview always yields `demo-project`).
- `home-back` returns to an already-open board with **Back to board** or Escape.
- `browser-note` in the Vite preview explains that nothing is saved and links to `?demo`.

## How to get to it (user POV)

- Cold start without `?demo`: the welcome screen is shown (`app/src/main.ts` calls `home.show()`).
- Click the mark/logo `#home-button` (title **All boards**) from an open board.
- Submit **New board** (`#new-board`) after typing in `#new-board-name`.
- Click **Open project folder** (`#welcome-open`) or press Ctrl O (rebindable `openFolder`).
- With a board already open, press Escape on the home screen or click **Back to board**.

## Driving it with verify-board

Preconditions:

- Doctor is green on the instance this run launched.
- For a clean home screen, launch with `--home` (no `?demo`).
- Do not treat `?demo` as **New board**. Demo calls `openBoard('demo-project')` and skips home.

- **Show home.** Start without the demo query. Run `node .cursor/skills/verify-board/scripts/verify-board.mjs launch --home`. `#welcome` is not hidden. `#browser-note` is visible because `body.dataset.host` is `browser`. `#new-board-name` is focused.
- **Baseline snapshot.** Run `... snapshot --out .cursor/skills/verify-board/evidence/home-and-boards/before.json`. `open` is not `'true'`. `welcomeHidden` is false.
- **Name a board.** Type a title. Run `... fill --selector '#new-board-name' --value 'Verify board'`. The input shows that text.
- **Create it.** Choose **New board**. Run `... click --selector '#new-board button[type="submit"]'`. `body.dataset.open` is `true`. `#welcome` is hidden. `#board-name` reads `Verify board`. `#status` `data-state` is `memory`.
- **Return home.** Choose **All boards**. Run `... click --id home-button`. `#welcome` is shown again. `#home-back` is visible because a board is still open.
- **Demo shortcut.** The note's `?demo` link is a separate entry. Run `... launch` (default) instead of `--home`. `.item.image[data-id="img_sunset"]` exists. That is not **New board**.
- **Proof.** Screenshot home or the named board. Run `... screenshot --out .cursor/skills/verify-board/evidence/home-and-boards/after-new-board.png`. The title bar shows the board name or **Board**, plus **MCP**.

## Gotchas

- `pickFolder` in `MemoryBackend` always returns `demo-project`, which seeds the sample board. That does not prove the Tauri folder picker.
- `moveBoard` in the preview throws `Moving boards needs the desktop app`. **Move to project…** (`#move-board`) is only shown for library boards on desktop.
- Deleting a library board on desktop sends it to Trash/Recycle Bin. The **×** on a recent *project* only forgets the list entry (`forgetProject`); it does not delete the folder.
- Recents (`board.recents`) are stored in webview `localStorage` and only updated for Tauri non-library opens. The preview's recent-projects list stays empty.
- First open of a board starts the tour. Dismiss it before asserting `#toolbar` clicks.
