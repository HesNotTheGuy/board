// Builds the release app without baking this machine's folders into it.
//
// Rust keeps the source path of every dependency in the binary (for panic messages), and
// those live under your home folder, so a plain build puts your OS username into every
// installer you share. Here the paths are found at build time and remapped to neutral
// names; nothing machine-specific is written into the repo. Afterwards the binary is
// checked, and the build fails if your home folder still shows up.
//
// Usage: pnpm app:build [-- extra tauri build args, e.g. --bundles nsis]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const home = os.homedir();
const cargoHome = process.env.CARGO_HOME ?? path.join(home, '.cargo');
const rustupHome = process.env.RUSTUP_HOME ?? path.join(home, '.rustup');

// rustc applies the last matching prefix, so the broad home folder goes first.
const remaps = [
  [home, '~'],
  [cargoHome, '/cargo'],
  [rustupHome, '/rustup'],
  [root, '/board'],
];
const flags = remaps.map(([from, to]) => `--remap-path-prefix=${from}=${to}`);
// CARGO_ENCODED_RUSTFLAGS (0x1f-separated) survives spaces in paths; RUSTFLAGS doesn't.
const existing = process.env.CARGO_ENCODED_RUSTFLAGS
  ? process.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f')
  : (process.env.RUSTFLAGS ?? '').split(/\s+/).filter(Boolean);
const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: [...existing, ...flags].join('\x1f') };
delete env.RUSTFLAGS;

const tauri = path.join(appDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
// `pnpm app:build -- --bundles nsis` can pass the `--` through; tauri would hand what follows to cargo.
const extra = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
const run = spawnSync(process.execPath, [tauri, 'build', ...extra], { cwd: appDir, env, stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);

// Check what's about to be handed out.
const release = path.join(appDir, 'src-tauri', 'target', 'release');
const binary = [path.join(release, 'board.exe'), path.join(release, 'board')].find(existsSync);
if (!binary) {
  console.error('build-app: built binary not found; skipped the path check.');
  process.exit(1);
}
const user = os.userInfo().username;
const needles = [home, home.replaceAll('\\', '/'), `\\${user}\\`, `/${user}/`];
const bytes = readFileSync(binary);
const leaks = needles.filter((n) => bytes.includes(Buffer.from(n, 'utf8')) || bytes.includes(Buffer.from(n, 'utf16le')));
if (leaks.length > 0) {
  console.error(`build-app: ${path.basename(binary)} still contains your home folder or username. Don't share this build.`);
  process.exit(1);
}
console.log(`build-app: ${path.basename(binary)} contains no local home folder or username.`);
