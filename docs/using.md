# Using the board

Paste, drop and arrange references. Start a board for an idea, or keep one inside a project folder.

Select an image to give it a **Note for AI**. Mark the ones that matter most with **Focus**. Group references into named **zones** with a line about what each zone means. Name one *Avoid* and models treat what’s inside as anti-references. An item belongs to the zone its center sits in. Captions written by a vision model are cached on the board, so text-only models and later sessions can skip the pixels.

![The inspector for a focused image: a note for AI, a cached caption and tags](images/notes.webp)

## Crop, flip, shortcuts

Crop is non-destructive: **C**, drag the edges, **Enter** to apply, **Esc** to cancel. **Reset crop** brings the whole image back. Flips, duplicate, layer order and zoom use the bindings most image and design tools use.

Every shortcut can be rebound in **Settings → Keyboard shortcuts**: click one, press the new keys.

<img src="images/shortcuts.webp" width="300" alt="The keyboard shortcuts sheet">

<img src="images/crop.webp" width="440" alt="Crop mode: a crop window with eight handles over the full image">

All rebindable except paste, arrow-key nudging, wheel zoom and middle-drag pan:

| Action | Keys |
| --- | --- |
| All boards, new board, open a project | Click the logo (top left) |
| Paste image, image link, or text (→ note) | Ctrl V |
| Add from a browser | Drag the image onto the canvas |
| Pan | Space + drag, or middle mouse |
| Zoom | Wheel / pinch, Ctrl + / Ctrl − |
| Select / add to selection | Click / Shift-click, drag on empty canvas |
| Resize | Drag a corner mark (Shift = free aspect) |
| Crop (then drag edges; Enter applies, Esc cancels) | C |
| Flip horizontally / vertically | Shift H / Shift V |
| Duplicate | Ctrl D |
| Bring to front / send to back | Ctrl Shift ] / Ctrl Shift [ |
| New note | N |
| Zone (around the selection) | F or Ctrl Alt G |
| Arrange (tidy up, per zone) | Ctrl Alt T |
| Focus pin (AI tools weigh these most) | P |
| Fit everything / zoom to selection / 100% | Shift 1 / Shift 2 / Shift 0 |
| Grayscale view (value check) | G |
| Keep on top (also the pin, top right) | T |
| Undo / redo | Ctrl Z / Ctrl Shift Z or Ctrl Y |

## Boards without a project

**New board** on the home screen creates a standalone board in the app’s data folder. AI tools reach it through the `boards` tool. When the project exists, **Move to project…** in the top bar moves the board into that folder.

To delete a board, click the logo (top left) and use the trash button next to it under **Your boards**. It asks first, then moves the board to the Recycle Bin / Trash. The **×** next to a recent project only removes it from the list; Board never deletes anything inside your project folders.

## Local and private

No accounts, no cloud, no telemetry. Boards are plain JSON and images in `.board/`. The only network request the app makes is downloading an image you drag in from a web page. The MCP server talks over stdin/stdout without opening a port.

A slim title bar instead of the system frame, **keep on top** (T), and **canvas opacity** that fades only the background so you can trace over whatever is behind the window. Pastes and new notes appear at a size that matches your current zoom. A short tour on first launch points out the controls.

## See also

[MCP](mcp.md) · [Format](FORMAT.md) · [Develop](develop.md)
