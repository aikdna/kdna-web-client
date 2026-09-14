// A disposable copy of the candidate repository for behavioural experiments.
//
// Hostile gates have to be allowed to break things -- replace the leg runner, corrupt the
// registered asset, rewrite the registry -- without ever touching the repository under
// review. The copy carries the committed metadata and scripts and borrows the installed
// dependencies through a symlink, so a copy costs megabytes rather than a second install.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CANDIDATE_SURFACE = Object.freeze([
  '.github',
  'docs',
  'fixtures',
  'package-lock.json',
  'package.json',
  'scripts',
  'src',
  'tests',
]);

export function makeTempCandidate(root, { surface = CANDIDATE_SURFACE } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kdna-candidate-'));
  for (const entry of surface) {
    const source = path.join(root, entry);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(tempRoot, entry), { recursive: true });
  }
  const nodeModules = path.join(tempRoot, 'node_modules');
  fs.symlinkSync(path.join(root, 'node_modules'), nodeModules, 'dir');
  return tempRoot;
}

/**
 * Removes a copy without ever following the dependency symlink. The link is unlinked while
 * it is still known to be a link; only then is the remainder deleted recursively.
 */
export function removeTempCandidate(tempRoot) {
  const nodeModules = path.join(tempRoot, 'node_modules');
  if (fs.existsSync(nodeModules) && fs.lstatSync(nodeModules).isSymbolicLink()) {
    fs.unlinkSync(nodeModules);
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 });
}
