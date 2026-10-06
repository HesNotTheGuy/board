# MCP access

The title-bar **MCP** chip is how a user decides what AI tools may do: **Off**, **View only**, or **View & add**. Access stays off until they change it. The chip always reflects the current mode. In the Vite preview the setting lives only in that page's memory; on desktop it is `settings.json` and the MCP server re-reads it on every call.

## Sub-features

- `chip-idle` shows **MCP** with `data-mode="off"` and title `MCP access: Off` on a fresh session.
- `open-settings` opens `#settings` from the chip or the gear (`#open-settings`).
- `mode-read` chooses **View only**; chip becomes `data-mode="read"`; title `MCP access: View only`.
- `mode-write` chooses **View & add**; chip becomes `data-mode="write"`; title `MCP access: View & add`.
- `mode-off` chooses **Off** again; chip returns to `off`.
- `agent-preview` (Vite only) runs `__boardDemo.agentAdds()` so a mint-outlined agent image appears; that is not the MCP `add` tool.

## How to get to it (user POV)

- Click the **MCP** chip (`#ai-chip`) or the settings gear (`#open-settings`, top right).
- In **Settings**, use the **MCP access** segmented radios (`aria-label="MCP access"`): **Off**, **View only**, **View & add**.
- Read the chip color/mode without opening settings: grey off, blue view only, green view and add (`app/src/styles.css` plus `data-mode`).
- Desktop: connect an MCP client to `packages/mcp` as in the README, then change this setting; the next tool call honors it. The app never starts an MCP server by itself.

## Driving it with verify-board

Preconditions:

- Doctor is green on the instance this run launched (demo or home).
- Tour is dismissed (`dismiss-tour`) so the chip is clickable.
- You are proving the settings radios, not `chip.dataset.mode = 'read'`.
- Memory preview: `getMcpAccess` starts `'off'` every session. Do not expect a `settings.json` file.

- **Baseline snapshot.** Record off as the factory default. Run `... snapshot --out .cursor/skills/verify-board/evidence/mcp-access/before.json`. `mcpMode` is `off`. `mcpTitle` is `MCP access: Off`. `settingsOpen` is false.
- **Open from the chip.** Choose **MCP**. Run `... click --id ai-chip`. `#settings` is not hidden. `#open-settings` has `aria-expanded="true"`. Three `.segment` buttons: Off (checked), View only, View & add.
- **View only.** Choose **View only**. Run `... click --selector '#settings button.segment' --text 'View only'`. That radio `aria-checked="true"`. `#ai-chip` `data-mode` is `read`. Title is `MCP access: View only`. A toast mentions that AI tools can view (wording from `TitleBar.setAccess`).
- **Resulting state.** Snapshot again. Run `... snapshot --out .cursor/skills/verify-board/evidence/mcp-access/after.json`. `mcpMode` is `read`. `settingsLabels` has View only checked.
- **View & add sibling.** Choose **View & add**. Run `... click --selector '#settings button.segment' --text 'View & add'`. Chip `data-mode` is `write`. Title `MCP access: View & add`.
- **One-shot.** The helper encodes the View-only click recipe. Run `... drive-mcp-access`. It writes `evidence/mcp-access/proof.json`, `before.json`, `after.json`, and `after-view-only.png`.
- **Agent-add preview (optional, not MCP).** After View & add, run `... eval --expr 'window.__boardDemo.agentAdds()'`. A new `.item.image.agent` appears; toast from `store.onArrivals`. This does not speak stdio MCP. Real `add` needs the desktop app, **View & add**, and a client running `packages/mcp`.
- **Proof.** Screenshot after View only. Run `... screenshot --out .cursor/skills/verify-board/evidence/mcp-access/after-view-only.png`. Settings panel still open. **View only** is the lit segment. Chip still reads **MCP**.

## Gotchas

- Chip text stays the word `MCP`; mode is `data-mode` and `title`, not the label.
- `MemoryBackend.setMcpAccess` does not write disk. Restarting the preview returns to Off. Tauri uses `set_mcp_access` → `settings.json` (`mcpAccess`: `off` | `read` | `write`).
- MCP tools `overview` / `view` / `add` / `caption` / `remove` / `boards` live in `packages/mcp`. `pnpm --filter @board/mcp test` is not this feature. A chip set to Off makes the server answer that access is off; proving that needs a real stdio client and the desktop settings file.
- Keep-on-top (`#pin-window`, key `T`) is hidden in the browser host (`body[data-host=browser]`). Do not fail MCP proof if the pin is missing.
- Clicking the chip opens settings; it does not cycle modes by itself.
