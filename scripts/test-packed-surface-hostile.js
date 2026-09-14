#!/usr/bin/env node
// Hostile mutations for the packed-surface gate.
//
// Every assertion in `assertPackedSurface` has to be falsifiable by a mutation a real
// deliverable could plausibly acquire: an entry point that dropped out of the allowlist,
// internal evidence pushed into the package, a licence file that disappeared, build
// output, machine paths or work-item identifiers. Each mutation must be rejected.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_PACKED_MEMBERS,
  PACK_CEILINGS,
  assertPackedSurface,
  packReport,
} from './check-packed-surface.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { report: pristine, extracted: pristineArchive } = packReport(root);
assertPackedSurface({ report: pristine, pkg, extracted: pristineArchive });

function copy(overrides = {}) {
  return {
    report: overrides.report ?? structuredClone(pristine),
    pkg: overrides.pkg ?? structuredClone(pkg),
    extracted: overrides.extracted ?? structuredClone(pristineArchive),
  };
}

function mutation(name, mutate, { syncEntryCount = true } = {}) {
  const candidate = copy();
  mutate(candidate);
  if (syncEntryCount) candidate.report.entryCount = candidate.report.files.length;
  return [name, candidate];
}

const mutations = new Map([
  mutation('entry point dropped from the package', (candidate) => {
    candidate.report.files = candidate.report.files.filter((entry) => entry.path !== 'src/client.cjs');
    candidate.pkg.files = candidate.pkg.files.filter((entry) => entry !== 'src/client.cjs');
  }),
  mutation('internal audit material packed', (candidate) => {
    candidate.report.files.push({ path: 'docs/audits/synthetic-packed-entry.json', size: 100, mode: 420 });
  }),
  mutation('internal evidence material packed', (candidate) => {
    candidate.report.files.push({ path: 'evidence/run-01.txt', size: 100, mode: 420 });
  }),
  mutation('internal delivery material packed', (candidate) => {
    candidate.report.files.push({ path: 'delivery/handoff.md', size: 100, mode: 420 });
  }),
  mutation('run log packed', (candidate) => {
    candidate.report.files.push({ path: 'ci-run.log', size: 100, mode: 420 });
  }),
  mutation('work-item identifier packed', (candidate) => {
    candidate.report.files.push({ path: `docs/${['p', 'd'].join('')}${100}-synthetic.md`, size: 100, mode: 420 });
  }),
  mutation('build output packed', (candidate) => {
    candidate.report.files.push({ path: 'dist/client.js', size: 100, mode: 420 });
  }),
  mutation('machine path packed', (candidate) => {
    candidate.report.files.push({ path: '/opt/kdna/notes.md', size: 100, mode: 420 });
  }),
  mutation('coordination file packed', (candidate) => {
    candidate.report.files.push({ path: 'WORKLOG.md', size: 100, mode: 420 });
  }),
  mutation('LICENSE removed', (candidate) => {
    candidate.report.files = candidate.report.files.filter((entry) => entry.path !== 'LICENSE');
    candidate.pkg.files = candidate.pkg.files.filter((entry) => entry !== 'LICENSE');
  }),
  mutation('NOTICE removed', (candidate) => {
    candidate.report.files = candidate.report.files.filter((entry) => entry.path !== 'NOTICE');
    candidate.pkg.files = candidate.pkg.files.filter((entry) => entry !== 'NOTICE');
  }),
  mutation('published entry point missing from the package', (candidate) => {
    candidate.report.files = candidate.report.files.filter((entry) => entry.path !== 'src/client.mjs');
  }),
  mutation('exports repointed outside the package surface', (candidate) => {
    candidate.pkg.exports['.'].import = './src/not-shipped.mjs';
  }),
  mutation('tarball above the size ceiling', (candidate) => {
    candidate.report.size = PACK_CEILINGS.tarballBytes + 1;
  }),
  mutation('unpacked surface above the size ceiling', (candidate) => {
    candidate.report.unpackedSize = PACK_CEILINGS.unpackedBytes + 1;
  }),
  mutation('silently bundled dependencies', (candidate) => {
    candidate.report.bundled = [{ name: 'left-pad', version: '1.0.0' }];
  }),
  mutation('install lifecycle script added to the published manifest', (candidate) => {
    candidate.pkg.scripts.postinstall = 'node -e "process.exit(0)"';
  }),
  mutation('entryCount disagrees with the member list', (candidate) => {
    candidate.report.entryCount = candidate.report.files.length + 1;
  }, { syncEntryCount: false }),
  mutation('files allowlist acquires internal material', (candidate) => {
    candidate.pkg.files.push('docs/audits/');
  }),
  mutation('a symlink ships inside the archive', (candidate) => {
    candidate.extracted.push({ path: 'package/src/linked.cjs', kind: 'other' });
    candidate.report.files.push({ path: 'src/linked.cjs', size: 0, mode: 511 });
  }),
  mutation('an archive entry escapes the package root', (candidate) => {
    candidate.extracted.push({ path: 'package/../../escape.txt', kind: 'file' });
  }),
  mutation('the archive carries an entry the report never listed', (candidate) => {
    candidate.extracted.push({ path: 'package/src/unreviewed.cjs', kind: 'file' });
  }),
]); 

let rejected = 0;
for (const [name, candidate] of mutations) {
  assert.throws(() => assertPackedSurface(candidate), undefined, name);
  rejected += 1;
}

// This mutation must reach the identifier rule, not merely the package allowlist.
assert.throws(
  () => assertPackedSurface(mutations.get('work-item identifier packed')),
  /work-item identifiers/u,
  'the work-item rule itself must reject the synthetic member',
);

const control = copy();
control.pkg.files = [...pkg.files].sort();
assertPackedSurface(control);
assert.equal(EXPECTED_PACKED_MEMBERS.length, pristine.files.length, 'the reviewed surface drifted');

console.log(`Packed surface hostile mutations rejected: ${rejected}/${rejected}.`);
