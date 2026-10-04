// Points git at the repo's .githooks folder so the PII guard runs on every commit.
// Safe to run outside a git checkout (e.g. a tarball install): it just does nothing.
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
} catch {
  // Not a git checkout; nothing to set up.
}
