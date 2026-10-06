# Zones

Zones group references. AI tools see each item under the zone its center sits in, with the zone name and **What this zone means**. A zone named **Avoid** is treated as anti-references.

## Sub-features

- `zone-create` draws a zone around the selection, or a default rect at the view center if nothing is selected (`F` / Ctrl Alt G / toolbar **Zone**).
- `zone-select` opens the inspector (kind **Zone**, id `zone_…`).
- `zone-name` edits `#inspector [data-field="name"]`; the canvas `.zone-name` matches.
- `zone-avoid` names a zone `Avoid` (demo already has `zone_avoid`).
- `zone-meaning` writes **What this zone means** (`[data-field="meaning"]`, stored as `zone.note`).

## How to get to it (user POV)

- Click **Zone** on the toolbar or press `F` (also Ctrl Alt G) with or without a selection.
- Click a zone or its label (`.zone-label`) on the canvas.
- In the inspector, set **Name** (placeholder mentions Palette, Layout, Avoid) and **What this zone means**.
- **Select contents** selects items whose centers lie in the zone. Deleting a zone keeps the items.

## Driving it with verify-board

Preconditions:

- Doctor is green. Tour is dismissed.
- Demo launch already includes `zone_mood` (Mood) and `zone_avoid` (Avoid, rose, note `Anti-references`). Use those for Avoid; use toolbar **Zone** to prove create.

- **Select Avoid.** Click the demo anti-reference zone. Run `... click --selector '.zone[data-id="zone_avoid"]'`. The zone has class `selected`. `#inspector` kind is `Zone`. `[data-field="name"]` is `Avoid`. `[data-field="meaning"]` is `Anti-references`. `.zone[data-color="rose"]`.
- **Baseline snapshot.** Run `... snapshot --out .cursor/skills/verify-board/evidence/zones/before.json`. Zones list includes `{ id: 'zone_avoid', name: 'Avoid' }`.
- **Create a zone.** Deselect, then choose **Zone**. Run `... click --selector 'button.tool[data-tool="zone"]'`. A new `.zone` appears, selected. Inspector name starts with `Zone ` plus a number. The name field is focused (`onFocusField('name')`).
- **Rename.** Run `... fill --selector '#inspector [data-field="name"]' --value 'Palette'`. `.zone-name` on the selected zone reads `Palette`.
- **Proof.** Screenshot the named zone with inspector open. Run `... screenshot --out .cursor/skills/verify-board/evidence/zones/after-avoid.png`. Demo Avoid still reads **Avoid** if you selected it; a created zone reads **Palette**. Title bar still shows **MCP**.

## Gotchas

- Membership is spatial, not stored on the item. Dragging an image so its center leaves Avoid means it is no longer in Avoid, with no other field changing.
- Hint text in `index.html` still shows `kbd data-action="zone"` as `Z`; the default binding in `app/src/keys.ts` is `F` and `Ctrl+Alt+G`. Trust `keys.ts` and the live `kbd` chip, not the stale Z in the hint.
- Toolbar **Zone** around a multi-selection sizes to that selection plus padding (`addZone` in `view.ts`). With no selection it uses a 720×480 rect at the view center.
- Color swatches are `[role="radiogroup"][aria-label="Zone color"] button.swatch[data-color]`. Demo Avoid is `rose`.
- Arrange (`data-tool="arrange"` / Ctrl Alt T) packs per zone so items do not change zone. That is adjacent, not this feature's proof.
