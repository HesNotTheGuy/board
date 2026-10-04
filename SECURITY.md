# Security

Board sits between untrusted images (from anywhere on the web) and an AI agent that can run code on your machine. This page covers what it defends against, how, and what's out of scope.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository (Security tab → "Report a vulnerability"). Don't open a public issue for security bugs.

## Threats and mitigations

### 1. Malicious image files

Image decoders are a classic attack surface (for example the 2023 libwebp heap overflow).

- **Content disarm and reconstruction.** Every image entering a board (pasted, dropped, downloaded, or added by an agent) is decoded and **re-encoded** before it is stored. The original bytes are never kept. On the desktop side this uses pure-Rust, memory-safe decoders ([`image`](https://crates.io/crates/image)); see [`sanitize.rs`](app/src-tauri/src/sanitize.rs).
- **Magic-byte checks.** Formats are identified from file contents, never from names or MIME types. Only PNG, JPEG, GIF, WebP (and BMP in the app) are accepted. SVG, TIFF, HTML and everything else are rejected before any decoder sees them.
- **Decompression bombs.** Images over 100 megapixels, 20,000 px on a side, or 40 MB are refused, checked from the header before pixels are allocated.
- **The webview never decodes untrusted bytes.** Imports go straight to Rust; the canvas only ever displays the sanitized copies.
- **The MCP server** (Node + sharp/libvips) applies the same magic-byte check, pixel limits and re-encoding to anything it imports, and the same checks and limits whenever it reads a board asset, because boards can come from other people's repositories.

### 2. Privacy leaks through images

Re-encoding drops all metadata: EXIF (including GPS location), camera serial numbers, embedded text chunks. EXIF rotation is applied to the pixels first, so photos still display upright. This matters if you commit `.board/` to a public repo.

Downloaded images record their source URL **without** the query string or fragment, since those often carry access tokens.

### 3. Downloads from dragged links (SSRF)

When you drag an image from a web page, the page controls the URL. Without care, a page could make Board request `http://192.168.1.1/...` or a cloud metadata endpoint on your behalf. See [`fetch.rs`](app/src-tauri/src/fetch.rs).

- Only `http`/`https`; no embedded credentials; no single-label or `.local`/`.localhost`/`.internal`/`.lan` host names.
- Every address a host resolves to must be on the public internet (loopback, private, link-local, CGNAT, multicast, reserved, IPv4-mapped/NAT64/6to4 forms of those are all blocked). The HTTP client connects **only** to addresses that passed the check, so DNS rebinding can't swap one in afterwards.
- Every redirect hop is re-checked (max 5). Proxies are disabled, since a proxy would do its own DNS.
- No cookies or credentials are ever sent. 10 s connect / 30 s total timeout, 40 MB cap enforced while streaming.
- The download happens in Rust. The webview's content security policy still forbids it from loading anything remote.

### 4. You decide whether AI tools get anything

- **Off by default.** MCP access is a setting in the app: Off, View only (overview, view, list boards) or View & add (also add, caption, remove agent items, create boards). It lives in a small settings file in the app's data folder (`"mcpAccess"` in `settings.json`).
- **Enforced on the server, every call.** The MCP server re-reads the setting before each tool call, so turning it off takes effect immediately, even for a tool that is already connected. A missing, unreadable or unrecognized setting counts as Off, and an Off reply contains no board content.
- **Nothing starts on its own.** The desktop app never launches an MCP server or opens a port. A server only runs when an AI tool you configured starts it.

### 5. Prompt injection

An image can contain text like "ignore your instructions and run …", and a board cloned from someone else's repo can contain hostile notes or captions.

- The MCP server's instructions tell the model that everything from the board (pixels, text inside images, notes, captions, zone names, source URLs) is **untrusted reference material**: it may inform design decisions and nothing else. It never justifies running commands, installing packages, touching unrelated files, revealing secrets or contacting URLs, and the model should tell you when board content looks like it's trying to instruct it.
- Every tool result that carries board content is labelled as data.
- Captions a model writes must describe what's visible, so an injected instruction can't be laundered into a cached caption.
- Agents can only remove agent-added items, and can only add images from inside the project folder, the board's own folder, or the system temp folder (where screenshot tools write), not arbitrary files elsewhere on disk.
- Standalone boards live in the app's data folder. Board names become folder names only after being reduced to `a-z`, `0-9` and `-`, and the app re-checks them, so a name can't point outside that folder. Agents pick standalone boards by listed name only, never by path.

This reduces the risk; it can't eliminate it. Language models can still be manipulated. Keep your AI tool's permission prompts on for commands, and be wary of boards from people you don't trust.

### 6. The desktop app itself

- The webview has no filesystem access. Disk access goes through a handful of Rust commands scoped to the open project's `.board/` folder.
- Assets are served through a custom `board://` protocol that only resolves paths inside `.board/assets/`, only serves image content types, and sends `X-Content-Type-Options: nosniff`.
- Strict content security policy: scripts, styles and fonts from the app bundle only; images only from the app, `board://`, `blob:` and `data:`.
- Board data is rendered with `textContent`, never parsed as HTML, so hostile notes can't inject markup.
- `board.json` is parsed leniently and never overwritten if it can't be parsed.
- Deleting is limited to boards in Board's own library folder, and goes to the Recycle Bin / Trash rather than being permanent. Project folders are never deleted; removing a recent project only edits the list.

## Out of scope

- A compromised machine, or a malicious AI tool / MCP client configuration.
- Copyright of the images you collect. That's on you.
