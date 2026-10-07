#!/usr/bin/env node
// Builds the Board demo from docs/demo/shots.json: real clips where they exist,
// real stills (slow push-in) where they don't, captions in the app's own fonts.
// Writes a 16:9 and a 9:16 cut, an .srt sidecar and a contact sheet.
//
//   node docs/demo/stitch.mjs                 both cuts, clips from board-demo-clips/
//   node docs/demo/stitch.mjs --dry-run       show which source each shot will use
//   node docs/demo/stitch.mjs --help          all options
//
// Needs ffmpeg and ffprobe on PATH (or FFMPEG / FFPROBE env vars).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const CLIP_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.m4v'];

const W = 1920;
const H = 1080;
const VW = 1080;
const VH = 1920;
// The 9:16 cut shows a square window of the 16:9 frame at 1:1, with text above it.
// Shorts, Reels and X draw their own UI over roughly the bottom fifth, so nothing goes there.
const WIN_W = H;
const WIN_TOP = 600;
const V_MARK_Y = 200;
const V_CAP_Y = 290;
const BG = '0x121211';
const INK = '0xebe5d9';
const AMBER = '0xf5a524';

const HELP = `Usage: node docs/demo/stitch.mjs [options]

  --clips <dir>       folder with recorded takes (default: board-demo-clips)
  --out <dir>         output folder (default: docs/demo/out)
  --manifest <file>   shot list (default: docs/demo/shots.json)
  --format <f>        both | 16x9 | 9x16 (default: both)
  --stills-only       ignore clips, build the interim cut from stills
  --skip-optional     drop shots marked optional (the agent-add beat)
  --no-captions       render without burned-in captions (the .srt is still written)
  --vo <file>         voice-over audio to lay under the 16:9 and 9:16 cuts
  --serif <font>      caption font (default: Instrument Serif from app/node_modules)
  --mono <font>       small-label font (default: Martian Mono from app/node_modules)
  --keep              keep the intermediate per-shot renders
  --dry-run           print the plan and exit
`;

function parseArgs(argv) {
  const opts = { clips: 'board-demo-clips', out: 'docs/demo/out', manifest: 'docs/demo/shots.json', format: 'both' };
  const flags = new Set(['stills-only', 'skip-optional', 'no-captions', 'keep', 'dry-run', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (flags.has(key)) opts[key] = true;
    else if (['clips', 'out', 'manifest', 'format', 'vo', 'serif', 'mono'].includes(key) && argv[i + 1]) opts[key] = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}\n\n${HELP}`);
  }
  if (!['both', '16x9', '9x16'].includes(opts.format)) throw new Error('--format must be both, 16x9 or 9x16');
  return opts;
}

const fromRepo = (p) => path.resolve(repo, p);
const fromCwd = (p) => path.resolve(process.cwd(), p);
const rel = (p) => path.relative(repo, p).replaceAll('\\', '/') || '.';
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const f3 = (n) => Number(n.toFixed(4)).toString();

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new Error(`Couldn't run ${cmd}: ${res.error.message}. Install ffmpeg or set FFMPEG / FFPROBE.`);
  if (res.status !== 0) throw new Error(`${cmd} failed:\n${(res.stderr || '').split('\n').slice(-25).join('\n')}`);
  return res.stdout;
}

function probe(file) {
  const out = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]);
  const j = JSON.parse(out);
  const s = j.streams?.[0] ?? {};
  return { width: s.width, height: s.height, duration: Number(j.format?.duration) || 0 };
}

function findClip(dir, prefix) {
  if (!prefix || !existsSync(dir)) return null;
  const names = readdirSync(dir).filter((n) => CLIP_EXT.includes(path.extname(n).toLowerCase()));
  const exact = names.find((n) => path.parse(n).name.toLowerCase() === prefix.toLowerCase());
  const loose = names.filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase())).sort();
  const pick = exact ?? loose[0];
  return pick ? path.join(dir, pick) : null;
}

function findFont(explicit, candidates, label) {
  const list = explicit ? [fromCwd(explicit)] : candidates;
  const hit = list.find((p) => existsSync(p));
  if (!hit) throw new Error(`No ${label} font found. Run pnpm install (for the app's fonts) or pass --${label} <file.ttf>.`);
  return hit;
}

function systemFonts(...names) {
  const dirs = [process.env.WINDIR && path.join(process.env.WINDIR, 'Fonts'), '/System/Library/Fonts/Supplemental', '/Library/Fonts', '/usr/share/fonts/truetype/dejavu'];
  return dirs.filter(Boolean).flatMap((d) => names.map((n) => path.join(d, n)));
}

/** Greedy word wrap for the 9:16 captions, where the column is narrow. */
function wrap(text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function plan(manifest, opts) {
  const clipsDir = fromCwd(opts.clips);
  const shots = manifest.shots.filter((s) => !(opts['skip-optional'] && s.optional));
  return shots
    .map((shot, i) => {
      const clip = opts['stills-only'] ? null : findClip(clipsDir, shot.clip);
      if (clip) return { shot, index: i, kind: 'clip', src: clip, v: shot.v ?? 0.5, crop: shot.crop ?? manifest.clipCrop ?? null };
      const still = (shot.stills ?? []).find((s) => existsSync(fromRepo(s.src)));
      if (still) return { shot, index: i, kind: 'still', src: fromRepo(still.src), still, v: still.v ?? shot.v ?? 0.5 };
      return { shot, index: i, kind: 'missing' };
    })
    .filter((p) => {
      if (p.kind !== 'missing') return true;
      console.warn(`! ${p.shot.id}: no clip or still found, skipping`);
      return false;
    });
}

function cropFilter(crop) {
  if (!crop) return '';
  const [x, y, w, h] = crop;
  return `crop=trunc(iw*${w}/2)*2:trunc(ih*${h}/2)*2:trunc(iw*${x}):trunc(ih*${y}),`;
}

/** Filter that turns one still into `n` frames of eased push-in at W x H. */
function stillFilter(p, fps) {
  const { still } = p;
  const info = probe(p.src);
  const [, , cw = 1, ch = 1] = still.crop ?? [0, 0, 1, 1];
  const srcW = info.width * cw;
  const srcH = info.height * ch;
  // Zoom on a 2x canvas so the pan moves in half-pixel steps instead of whole ones.
  const CW = W * 2;
  const CH = H * 2;
  const s = Math.min(CW / srcW, CH / srcH);
  const sw = even(srcW * s);
  const sh = even(srcH * s);
  const toFrame = ([cx, cy, z]) => [((CW - sw) / 2 + cx * sw) / CW, ((CH - sh) / 2 + cy * sh) / CH, Math.max(1, z)];
  const [x0, y0, z0] = toFrame(still.from ?? [0.5, 0.5, 1]);
  const [x1, y1, z1] = toFrame(still.to ?? still.from ?? [0.5, 0.5, 1]);
  const n = Math.round(p.shot.dur * fps);
  const t = `(on/${Math.max(1, n - 1)})`;
  const e = `(${t}*${t}*(3-2*${t}))`;
  const lerp = (a, b) => `(${f3(a)}+${f3(b - a)}*${e})`;
  const zx = `max(0,min(iw-iw/zoom,${lerp(x0, x1)}*iw-iw/zoom/2))`;
  const zy = `max(0,min(ih-ih/zoom,${lerp(y0, y1)}*ih-ih/zoom/2))`;
  return (
    `[0:v]${cropFilter(still.crop)}scale=${sw}:${sh}:flags=lanczos,pad=${CW}:${CH}:(ow-iw)/2:(oh-ih)/2:color=${BG},` +
    `zoompan=z='${lerp(z0, z1)}':x='${zx}':y='${zy}':d=${n}:s=${W}x${H}:fps=${fps},setsar=1,format=yuv420p[base]`
  );
}

function clipFilter(p, fps) {
  const speed = p.shot.speed ?? 1;
  return (
    `[0:v]${cropFilter(p.crop)}setpts=(PTS-STARTPTS)/${speed},fps=${fps},` +
    `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG},` +
    `tpad=stop_mode=clone:stop_duration=${p.shot.dur},trim=duration=${p.shot.dur},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[base]`
  );
}

const fadeIn = `alpha='min(1,max(0,(t-0.3)/0.35))'`;

function text(font, file, size, color, x, y, box) {
  const b = box ? `:box=1:boxcolor=${BG}@0.86:boxborderw=${box}` : '';
  return `drawtext=fontfile=${font}:textfile=${file}:expansion=none:fontsize=${size}:fontcolor=${color}:line_spacing=14${b}:x=${x}:y=${y}:${fadeIn}`;
}

function renderShot(p, ctx) {
  const { work, fps, fonts, captions, formats } = ctx;
  const id = String(p.index + 1).padStart(2, '0');
  const { caption, sub } = p.shot;
  const capFile = `cap-${id}.txt`;
  const subFile = `sub-${id}.txt`;
  const vcapFile = `vcap-${id}.txt`;
  writeFileSync(path.join(work, capFile), caption ?? '');
  writeFileSync(path.join(work, subFile), sub ?? '');
  const vlines = wrap(caption ?? '', 28);
  if (vlines.length > 3) console.warn(`! ${p.shot.id}: caption wraps to ${vlines.length} lines in 9:16; it may run into the picture`);
  writeFileSync(path.join(work, vcapFile), vlines.join('\n'));

  const input = p.kind === 'clip' ? ['-ss', String(p.shot.in ?? 0), '-t', String(p.shot.dur * (p.shot.speed ?? 1)), '-i', p.src] : ['-i', p.src];
  const parts = [p.kind === 'clip' ? clipFilter(p, fps) : stillFilter(p, fps), `[base]split=2[a][b]`];

  let wide = '[a]null';
  if (captions && caption) {
    wide += sub
      ? `,${text(fonts.serif, capFile, 54, INK, 96, 'h-250', 24)},${text(fonts.mono, subFile, 26, AMBER, 96, 'h-150', 16)}`
      : `,${text(fonts.serif, capFile, 54, INK, 96, 'h-190', 24)}`;
  }
  parts.push(`${wide}[wide]`);

  const [v0, v1] = Array.isArray(p.v) ? p.v : [p.v, p.v];
  const center = `(${f3(v0)}+${f3(v1 - v0)}*min(1,t/${p.shot.dur}))*${W}`;
  const winX = `'max(0,min(${W - WIN_W},${center}-${WIN_W / 2}))'`;
  let tall = `[b]crop=${WIN_W}:${H}:${winX}:0,pad=${VW}:${VH}:0:${WIN_TOP}:color=${BG}`;
  if (captions) {
    writeFileSync(path.join(work, 'mark.txt'), 'BOARD');
    tall += `,drawtext=fontfile=${fonts.mono}:textfile=mark.txt:expansion=none:fontsize=28:fontcolor=${AMBER}:x=80:y=${V_MARK_Y}`;
    if (caption) tall += `,${text(fonts.serif, vcapFile, 64, INK, 80, V_CAP_Y, 0)}`;
    if (sub) tall += `,${text(fonts.mono, subFile, 26, AMBER, 80, V_CAP_Y + vlines.length * 78 + 26, 0)}`;
  }
  parts.push(`${tall}[tall]`);

  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(fps), '-an'];
  const outs = {};
  const args = ['-v', 'error', '-y', ...input, '-filter_complex', parts.join(';')];
  if (formats.includes('16x9')) args.push('-map', '[wide]', ...enc, (outs['16x9'] = `seg-${id}-16x9.mp4`));
  if (formats.includes('9x16')) args.push('-map', '[tall]', ...enc, (outs['9x16'] = `seg-${id}-9x16.mp4`));
  if (!formats.includes('16x9')) args.push('-map', '[wide]', '-f', 'null', '-');
  if (!formats.includes('9x16')) args.push('-map', '[tall]', '-f', 'null', '-');
  run(FFMPEG, args, work);
  return outs;
}

/** Crossfades the per-shot renders together and adds audio (voice-over or silence). */
function joinSegments(segs, durs, xf, out, ctx) {
  const total = durs.reduce((a, b) => a + b, 0) - xf * (durs.length - 1);
  const args = ['-v', 'error', '-y', ...segs.flatMap((s) => ['-i', s])];
  const chain = [];
  let label = '[0:v]';
  let acc = durs[0];
  for (let k = 1; k < segs.length; k++) {
    const next = `[x${k}]`;
    chain.push(`${label}[${k}:v]xfade=transition=fade:duration=${xf}:offset=${f3(acc - xf)}${next}`);
    label = next;
    acc += durs[k] - xf;
  }
  chain.push(`${label}fade=t=in:st=0:d=0.4,fade=t=out:st=${f3(total - 0.6)}:d=0.6,format=yuv420p[v]`);
  const audioIndex = segs.length;
  if (ctx.vo) args.push('-i', ctx.vo);
  else args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  chain.push(`[${audioIndex}:a]apad,atrim=duration=${f3(total)}[a]`);
  args.push(
    '-filter_complex', chain.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(ctx.fps),
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', f3(total), out,
  );
  run(FFMPEG, args, ctx.work);
  return total;
}

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

function writeSrt(steps, xf, file) {
  let start = 0;
  const cues = steps.map((p, k) => {
    const last = k === steps.length - 1;
    const from = start + 0.3;
    const to = start + p.shot.dur - (last ? 0.6 : xf / 2);
    start += p.shot.dur - xf;
    const lines = [p.shot.caption, p.shot.sub].filter(Boolean).join('\n');
    return `${k + 1}\n${srtTime(from)} --> ${srtTime(to)}\n${lines}\n`;
  });
  writeFileSync(file, cues.join('\n'));
}

function contactSheet(video, steps, xf, out, work) {
  let start = 0;
  steps.forEach((p, k) => {
    const mid = start + p.shot.dur * 0.6;
    start += p.shot.dur - xf;
    run(FFMPEG, ['-v', 'error', '-y', '-ss', f3(mid), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', `sheet-${String(k + 1).padStart(2, '0')}.png`], work);
  });
  const cols = Math.min(4, steps.length);
  const rows = Math.ceil(steps.length / cols);
  run(FFMPEG, ['-v', 'error', '-y', '-start_number', '1', '-i', 'sheet-%02d.png', '-vf', `tile=${cols}x${rows}:padding=8:margin=8:color=${BG}`, '-frames:v', '1', out], work);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  const manifest = JSON.parse(readFileSync(fromCwd(opts.manifest), 'utf8'));
  const fps = manifest.fps ?? 30;
  const xf = manifest.crossfade ?? 0.35;
  const steps = plan(manifest, opts);
  if (!steps.length) throw new Error('Nothing to render.');

  console.log('Plan:');
  let t = 0;
  for (const p of steps) {
    console.log(`  ${f3(t).padStart(5)}s  ${p.shot.id.padEnd(14)} ${p.kind.padEnd(5)} ${rel(p.src)}`);
    t += p.shot.dur - xf;
  }
  console.log(`  total ≈ ${f3(t + xf)}s`);
  if (opts['dry-run']) return;

  const out = fromCwd(opts.out);
  const work = path.join(out, '.work');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const fontDir = (pkg) => fromRepo(`app/node_modules/@fontsource/${pkg}/files`);
  const serif = findFont(opts.serif, [path.join(fontDir('instrument-serif'), 'instrument-serif-latin-400-normal.woff'), ...systemFonts('Georgia.ttf', 'georgia.ttf', 'DejaVuSerif.ttf')], 'serif');
  const mono = findFont(opts.mono, [path.join(fontDir('martian-mono'), 'martian-mono-latin-400-normal.woff'), ...systemFonts('consola.ttf', 'Menlo.ttc', 'DejaVuSansMono.ttf')], 'mono');
  const fonts = { serif: `serif${path.extname(serif)}`, mono: `mono${path.extname(mono)}` };
  copyFileSync(serif, path.join(work, fonts.serif));
  copyFileSync(mono, path.join(work, fonts.mono));

  const formats = opts.format === 'both' ? ['16x9', '9x16'] : [opts.format];
  const ctx = { work, fps, fonts, formats, captions: !opts['no-captions'], vo: opts.vo ? fromCwd(opts.vo) : null };
  const segs = steps.map((p) => {
    process.stdout.write(`  rendering ${p.shot.id}…\n`);
    return renderShot(p, ctx);
  });

  const durs = steps.map((p) => p.shot.dur);
  for (const f of formats) {
    const file = path.join(out, `board-demo-${f}.mp4`);
    const total = joinSegments(segs.map((s) => s[f]), durs, xf, file, ctx);
    console.log(`→ ${rel(file)} (${f3(total)}s)`);
  }
  writeSrt(steps, xf, path.join(out, 'board-demo.srt'));
  console.log(`→ ${rel(path.join(out, 'board-demo.srt'))}`);
  const sheetFrom = path.join(out, `board-demo-${formats[0]}.mp4`);
  contactSheet(sheetFrom, steps, xf, path.join(out, `board-demo-sheet-${formats[0]}.png`), work);
  console.log(`→ ${rel(path.join(out, `board-demo-sheet-${formats[0]}.png`))}`);
  if (!opts.keep) rmSync(work, { recursive: true, force: true });
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
