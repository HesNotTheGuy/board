#!/usr/bin/env node
// Blocks commits that would leak personal info into this public repo.
//
// Nothing personal is hardcoded here. Personal terms come from the machine at
// runtime (OS username, home directory, non-noreply git email) and from the
// optional, gitignored `.pii-denylist` file (one term per line, `#` comments).
//
// Usage:
//   node scripts/check-pii.mjs --staged      files staged for commit (pre-commit hook)
//   node scripts/check-pii.mjs --all         every tracked + untracked, non-ignored file
//   node scripts/check-pii.mjs --msg <file>  a commit message (commit-msg hook)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ALLOWED_EMAIL = [
  /@users\.noreply\.github\.com$/i,
  /@example\.(com|org|net)$/i,
  /@\d+x\.(png|jpe?g|webp|gif|svg|avif)$/i, // retina asset names like icon@2x.png
];
// Usernames too generic to be identifying (CI runners, containers).
const GENERIC_USERS = new Set(['root', 'runner', 'user', 'admin', 'administrator', 'node', 'vscode', 'codespace']);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const HOME_PATH_RES = [
  { re: /\b[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[^\\/\s'"`]+/g, why: 'absolute Windows home path' },
  { re: /(?<![\w.])\/Users\/[^/\s'"`]+/g, why: 'absolute macOS home path' },
  { re: /(?<![\w.])\/home\/[^/\s'"`]+/g, why: 'absolute Linux home path' },
];

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function personalTerms() {
  const terms = [];
  const { username } = os.userInfo();
  if (username && username.length >= 3 && !GENERIC_USERS.has(username.toLowerCase())) {
    terms.push({ re: new RegExp(`\\b${escapeRe(username)}\\b`, 'i'), why: 'OS username' });
  }
  const home = os.homedir();
  if (home) {
    for (const variant of new Set([home, home.replaceAll('\\', '/'), home.replaceAll('\\', '\\\\')])) {
      terms.push({ re: new RegExp(escapeRe(variant), 'i'), why: 'home directory' });
    }
  }
  const email = git(['config', 'user.email']).trim();
  if (email && !ALLOWED_EMAIL.some((re) => re.test(email))) {
    terms.push({ re: new RegExp(escapeRe(email), 'i'), why: 'git user.email (not a noreply address)' });
  }
  const denylist = path.join(process.cwd(), '.pii-denylist');
  if (existsSync(denylist)) {
    for (const raw of readFileSync(denylist, 'utf8').split(/\r?\n/)) {
      const term = raw.trim();
      if (term && !term.startsWith('#')) terms.push({ re: new RegExp(escapeRe(term), 'i'), why: '.pii-denylist term' });
    }
  }
  return terms;
}

function scan(label, text, terms) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const where = `${label}:${i + 1}`;
    for (const { re, why } of terms) {
      if (re.test(line)) findings.push(`${where}  ${why}`);
    }
    for (const { re, why } of HOME_PATH_RES) {
      re.lastIndex = 0;
      if (re.test(line)) findings.push(`${where}  ${why}`);
    }
    for (const match of line.matchAll(EMAIL_RE)) {
      if (!ALLOWED_EMAIL.some((re) => re.test(match[0]))) findings.push(`${where}  email address (only GitHub noreply allowed)`);
    }
  });
  return findings;
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

function main() {
  const args = process.argv.slice(2);
  const mode = args[0] ?? '--staged';
  const terms = personalTerms();
  const findings = [];

  if (mode === '--msg') {
    const file = args[1];
    if (!file) throw new Error('--msg needs a file path');
    // Strip comment lines git adds to the message template.
    const text = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n');
    findings.push(...scan('commit message', text, terms));
  } else {
    const files =
      mode === '--all'
        ? git(['ls-files', '--cached', '--others', '--exclude-standard'])
        : git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
    for (const file of files.split('\n').filter(Boolean)) {
      let buf;
      try {
        buf = mode === '--all' ? readFileSync(file) : execFileSync('git', ['show', `:${file}`], { maxBuffer: 64 * 1024 * 1024 });
      } catch {
        continue;
      }
      if (isBinary(buf)) continue;
      findings.push(...scan(file, buf.toString('utf8'), terms));
    }
  }

  if (findings.length) {
    console.error('\nPII guard: possible personal info found. Nothing was committed.\n');
    for (const f of findings) console.error(`  ${f}`);
    console.error('\nUse runtime paths (cwd, env vars, OS app-data APIs) and placeholders like /path/to/project.\n');
    process.exit(1);
  }
  if (mode === '--all') console.log('PII guard: clean.');
}

main();
