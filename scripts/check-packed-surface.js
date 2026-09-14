#!/usr/bin/env node
// CI gate: assert the package surface that npm would actually publish.
//
// The step this replaces printed `npm pack --ignore-scripts --json` and asserted nothing,
// so a package whose entry points, licence or notice files had been removed -- or that had
// picked up internal evidence, build output or a machine-specific path -- still reported
// success. This gate consumes the same machine-readable pack report and fails on any of
// those outcomes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const PACKED_SURFACE_GATE = 'scripts/check-packed-surface.js';
export const EXPECTED_PACKED_MEMBERS = Object.freeze([
  'LICENSE',
  'NOTICE',
  'README.md',
  'SECURITY.md',
  'docs/current-core-read-binding.json',
  'package.json',
  'src/client.cjs',
  'src/client.d.ts',
  'src/client.mjs',
]);
export const PACK_CEILINGS = Object.freeze({
  tarballBytes: 131_072,
  unpackedBytes: 524_288,
});
// npm runs these on a consumer's machine (or on publish), so a published package must
// never acquire one silently. They stay in the manifest, not only in the pack report.
export const PACK_LIFECYCLE_SCRIPTS = Object.freeze([
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepack',
  'postpack',
]);
// Internal material, evidence, work-item identifiers, build output and machine paths must
// never become part of the published package, whatever route they arrive by.
export const FORBIDDEN_PACKED_PATHS = Object.freeze([
  [/(?:^|\/)docs\/audits\//u, 'internal audit material'],
  [/(?:^|\/)delivery\//u, 'internal delivery material'],
  [/(?:^|\/)evidence\//u, 'internal evidence material'],
  [/(?:^|\/)dist\//u, 'regenerable build output'],
  [/(?:^|\/)public-assets\//u, 'the CI reference-assets checkout'],
  [/(?:^|\/)\.github\//u, 'CI configuration'],
  [/(?:^|\/)node_modules\//u, 'installed dependencies'],
  [/\.log$/u, 'run logs'],
  [/\.tgz$/u, 'packed archives'],
  [/(?:^|\/)(?:AGENTS|WORKLOG)\.md$/u, 'private coordination files'],
  [/(?:^|\/)pd\d{2,}/iu, 'work-item identifiers'],
]);

function fail(message) {
  throw new Error(`packed surface: ${message}`);
}

/** Every path the package metadata promises to ship, as package-relative paths. */
export function declaredEntryPoints(pkg) {
  const declared = new Set();
  const collect = (value) => {
    if (typeof value === 'string') {
      declared.add(value);
      return;
    }
    if (value && typeof value === 'object') for (const nested of Object.values(value)) collect(nested);
  };
  collect(pkg.exports);
  collect(pkg.types);
  collect(pkg.main);
  return [...declared]
    .filter((value) => typeof value === 'string' && value.startsWith('./'))
    .map((value) => value.slice(2));
}

function assertMemberPath(member) {
  if (typeof member !== 'string' || member === '') fail('the pack report contains an empty member path');
  if (path.isAbsolute(member) || /^[A-Za-z]:[\\/]/u.test(member)) fail(`packed member is an absolute path: ${member}`);
  if (member.startsWith('./') || member.includes('\\')) fail(`packed member is not a plain package-relative path: ${member}`);
  if (member.split('/').includes('..')) fail(`packed member escapes the package root: ${member}`);
  if (/^\/(?:Users|home|private|tmp)\//u.test(member)) fail(`packed member is a machine path: ${member}`);
  for (const [pattern, label] of FORBIDDEN_PACKED_PATHS) {
    if (pattern.test(member)) fail(`packed member ${member} is ${label}`);
  }
}

/**
 * Pure assertion over one `npm pack --json` report plus the package metadata it came from.
 * Kept free of I/O so the hostile suite can drive it with mutated reports.
 */
/**
 * @param extracted every entry the real tarball produced, as
 *   `{ path, kind }` with `path` relative to the archive root and `kind` one of
 *   `file` / `directory` / `other`. The archive, not the pack report, is what a consumer
 *   actually receives, so the member list is only half the surface.
 */
export function assertPackedSurface({ report, pkg, extracted = [] }) {
  assert.ok(report && typeof report === 'object' && !Array.isArray(report), 'npm pack did not report one package');
  assert.equal(report.name, pkg.name, 'packed name drifted from package.json');
  assert.equal(report.version, pkg.version, 'packed version drifted from package.json');
  assert.ok(Array.isArray(report.files) && report.files.length > 0, 'the pack report lists no files');
  assert.equal(report.entryCount, report.files.length, 'entryCount disagrees with the member list');
  assert.ok(Array.isArray(report.bundled) && report.bundled.length === 0, 'the package unexpectedly bundles dependencies');
  for (const lifecycle of PACK_LIFECYCLE_SCRIPTS) {
    assert.equal(
      pkg.scripts?.[lifecycle],
      undefined,
      `the published manifest must not carry the ${lifecycle} lifecycle script`,
    );
  }

  const members = report.files.map((entry) => {
    assert.ok(entry && typeof entry === 'object', 'the pack report contains a non-object member');
    assertMemberPath(entry.path);
    return entry.path;
  });
  const sorted = [...members].sort();
  assert.deepEqual(
    sorted,
    [...EXPECTED_PACKED_MEMBERS].sort(),
    'the packed member list is not the reviewed public surface',
  );

  for (const required of ['LICENSE', 'NOTICE']) {
    assert.ok(sorted.includes(required), `the package must ship ${required}`);
  }
  for (const entryPoint of declaredEntryPoints(pkg)) {
    assert.ok(
      sorted.includes(entryPoint),
      `package.json publishes ${entryPoint} but the package does not contain it`,
    );
  }

  assert.ok(Number.isInteger(report.size) && report.size > 0, 'the pack report carries no tarball size');
  assert.ok(
    report.size <= PACK_CEILINGS.tarballBytes,
    `tarball ${report.size} B exceeds the ${PACK_CEILINGS.tarballBytes} B ceiling`,
  );
  assert.ok(Number.isInteger(report.unpackedSize) && report.unpackedSize > 0, 'the pack report carries no unpacked size');
  assert.ok(
    report.unpackedSize <= PACK_CEILINGS.unpackedBytes,
    `unpacked surface ${report.unpackedSize} B exceeds the ${PACK_CEILINGS.unpackedBytes} B ceiling`,
  );

  const allowlist = Array.isArray(pkg.files) ? pkg.files : [];
  assert.ok(allowlist.length > 0, 'package.json declares no files allowlist');
  for (const entry of allowlist) {
    if (typeof entry !== 'string') fail('package.json files allowlist contains a non-string entry');
    if (entry.startsWith('./') || entry.includes('\\') || path.isAbsolute(entry)) {
      fail(`package.json files allowlist entry is not a plain package-relative path: ${entry}`);
    }
    for (const [pattern, label] of FORBIDDEN_PACKED_PATHS) {
      if (pattern.test(entry)) fail(`package.json files allowlist entry ${entry} is ${label}`);
    }
  }

  assert.ok(Array.isArray(extracted) && extracted.length > 0, 'the packed archive was not inspected');
  const extractedFiles = [];
  for (const entry of extracted) {
    if (typeof entry?.path !== 'string' || entry.path === '') fail('the archive has an unnamed entry');
    if (path.isAbsolute(entry.path) || /^[A-Za-z]:[\\/]/u.test(entry.path)) {
      fail(`archive entry is an absolute path: ${entry.path}`);
    }
    if (entry.path.split('/').includes('..')) fail(`archive entry escapes the archive root: ${entry.path}`);
    if (!entry.path.startsWith('package/')) fail(`archive entry is outside the package root: ${entry.path}`);
    if (entry.kind === 'file') extractedFiles.push(entry.path.slice('package/'.length));
    else if (entry.kind !== 'directory') {
      fail(`archive entry is not a regular file or directory (${entry.kind}): ${entry.path}`);
    }
  }
  assert.deepEqual(
    [...extractedFiles].sort(),
    sorted,
    'the archive contents are not the reviewed public surface',
  );

  return { members: sorted, tarballBytes: report.size, unpackedBytes: report.unpackedSize };
}

/** Every entry the archive really contains, classified by what it is on disk. */
export function archiveEntries(archive, scratch) {
  execFileSync('tar', ['-xzf', archive, '-C', scratch], { stdio: ['ignore', 'pipe', 'pipe'] });
  const entries = [];
  const visit = (directory, prefix) => {
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      const relative = `${prefix}${name}`;
      if (stat.isDirectory()) {
        entries.push({ path: `${relative}/`, kind: 'directory' });
        visit(absolute, `${relative}/`);
      } else if (stat.isFile()) {
        entries.push({ path: relative, kind: 'file' });
      } else {
        entries.push({ path: relative, kind: 'other' });
      }
    }
  };
  visit(scratch, '');
  return entries;
}

export function packReport(root) {
  const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const report = JSON.parse(output)[0];
  const archive = path.join(root, report.filename);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kdna-packed-archive-'));
  try {
    const extracted = archiveEntries(archive, scratch);
    return { report, archiveStat: fs.statSync(archive), extracted };
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Compare realpaths, not raw URLs: a checkout reached through a symlinked prefix would
// otherwise silently skip the assertions this file exists to make.
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1]))
      === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { report, extracted } = packReport(root);
  console.log(JSON.stringify(report, null, 2));
  const verdict = assertPackedSurface({ report, pkg, extracted });
  console.log(
    `Packed surface passed: ${verdict.members.length} members, tarball ${verdict.tarballBytes} B `
      + `(ceiling ${PACK_CEILINGS.tarballBytes}), unpacked ${verdict.unpackedBytes} B `
      + `(ceiling ${PACK_CEILINGS.unpackedBytes}).`,
  );
}
