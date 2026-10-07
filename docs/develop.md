# Develop

This is a personal project. Forks are fine; pull requests are not taken.

```
packages/format   board.json types, lenient parser, 3-way merge (shared)
packages/mcp      MCP server (Node, sharp for image work)
app               Tauri desktop app (vanilla TS canvas + Rust shell)
docs/FORMAT.md    on-disk format and the concurrency protocol
```

```bash
pnpm test
pnpm typecheck
```

UI-only (plain browser at `http://localhost:1420`, in-memory, nothing saved). Add `?demo` for a sample board; `__boardDemo.agentAdds()` in the console simulates an agent adding an image:

```bash
pnpm dev
```

Windows installer from `pnpm app:build --bundles nsis` lands in `app/src-tauri/target/release/bundle/nsis/`.

## Should `.board/` be committed?

Your call. It’s plain JSON plus content-addressed images, so it diffs and merges reasonably. If your references are copyrighted or large, add `.board/` to the project’s `.gitignore`.

## PII guard

This repo is public. A git hook (`scripts/check-pii.mjs`, enabled by `pnpm install`) blocks commits that contain absolute home-directory paths, your OS username, or any email that isn’t a GitHub noreply address. Nothing personal is hardcoded in the script: it detects username and home folder at runtime. Extra private terms go in a gitignored `.pii-denylist` (see `.pii-denylist.example`). CI runs the same check on every push.

Compiled programs can leak too: Rust embeds source paths of dependencies. `pnpm app:build` goes through `scripts/build-app.mjs`, which remaps those paths and fails the build if the home folder or username still shows up in the binary.

## See also

[MCP](mcp.md) · [Using the board](using.md) · [Format](FORMAT.md) · [Roadmap](roadmap.md)
