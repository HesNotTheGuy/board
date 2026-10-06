# verify-board live proof

Public-safe summary of one end-to-end run of this skill. Screenshots and CDP dumps stay in the gitignored `evidence/` folder next to this file. Do not paste resolved home paths, tokens, emails, or private URLs here.

## What was proven

Mapped feature: **mcp-access** (`chip-settings`), via the helper one-shot `drive-mcp-access`.

Surface: UI-only Vite preview (`pnpm dev`) plus disposable Chrome CDP at `http://localhost:1420/?demo`. That is the real Board frontend (`app/src/*`) with the product's in-memory backend. Not a mock page.

Sequence:

1. **Launch** became ready. Title `demo-project · Board`. `body.dataset.host` was `browser`. Demo board open (`img_sunset` and zones Mood / Avoid present).
2. **Doctor** exited 0 after the drive (title, host, open board, live pids, CDP page on port 1420). Tour was already dismissed.
3. **Drive:** clicked `#ai-chip`, then Settings radio **View only**.
   - Before: `mcpMode` `off`, title `MCP access: Off`, settings closed.
   - After: `mcpMode` `read`, title `MCP access: View only`, **View only** `aria-checked`, toast `MCP: AI tools can now view your boards`.
4. **Cleanup** killed the Vite and Chrome process groups recorded at launch and deleted the run directory. Port 1420 stopped answering.

Survived cleanup: **yes**. Files still under `evidence/mcp-access/`: `before.json`, `after.json`, `after-view-only.png`, `proof.json`.

## Fallback

Tauri (`pnpm app`) was not used. This environment has Cargo but not WebKitGTK, so the desktop WebView cannot start here. The skill documents that skip; the live pass used the README's UI-only preview, as allowed when the WebView is unavailable.

## Not proven in this pass

Home/new board, paste/drop, Note for AI / Focus, zone create/rename, View & add, and real MCP stdio `add`. Those remain on the feature map for later runs.
