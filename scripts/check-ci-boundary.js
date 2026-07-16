#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT_ACTION = 'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0';
export const SETUP_NODE_ACTION = 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38';
export const TESTED_NODE_RELEASES = Object.freeze(['20', '22', '24', '26']);
export const EXPECTED_PACKAGE_GATE = Object.freeze([
  'npm run ci:boundary',
  'npm run validators:check',
  'npm test',
  'npm run typecheck',
  'npm run lint',
  'npm run build',
  'npm run size',
  'npm run naming:check',
  'npm run package:runtime-check',
  'npm pack --dry-run --json',
]);
export const EXPECTED_BOUNDARY_GATE = [
  'node scripts/check-ci-boundary.js',
  'node scripts/test-ci-boundary-hostile.js',
  'node scripts/test-packed-runtime-boundary-hostile.js',
].join(' && ');
export const EXPECTED_CI_WORKFLOW = [
  'name: CI',
  '',
  'on:',
  '  push:',
  '    branches: [main]',
  '  pull_request:',
  '    branches: [main]',
  '',
  'permissions:',
  '  contents: read',
  '',
  'jobs:',
  '  test:',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 10',
  '    strategy:',
  '      fail-fast: true',
  '      matrix:',
  `        node: [${TESTED_NODE_RELEASES.map((release) => `'${release}'`).join(', ')}]`,
  '    steps:',
  `      - uses: ${CHECKOUT_ACTION}`,
  `      - uses: ${SETUP_NODE_ACTION}`,
  '        with:',
  '          node-version: ${{ matrix.node }}',
  '      - run: npm ci --ignore-scripts',
  '      - run: node scripts/check-ci-boundary.js',
  '      - run: npm run ci',
  '',
].join('\n');

export function loadCandidate(root) {
  return {
    workflow: fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'),
    pkg: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
    lock: JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')),
    allowlist: JSON.parse(fs.readFileSync(
      path.join(root, 'scripts/naming-integrity-allowlist.json'),
      'utf8',
    )),
  };
}

export function assertCiBoundary({ workflow, pkg, lock, allowlist }) {
  assert.equal(workflow, EXPECTED_CI_WORKFLOW, 'CI workflow is not the exact reviewed contract');
  assert.equal(pkg.engines?.node, '>=20', 'Node engine floor drifted');
  assert.deepEqual(
    pkg.scripts?.ci?.split(/\s*&&\s*/u),
    EXPECTED_PACKAGE_GATE,
    'package CI gate drifted',
  );
  assert.equal(pkg.scripts?.['ci:boundary'], EXPECTED_BOUNDARY_GATE, 'boundary gate drifted');
  assert.equal(
    pkg.scripts?.['package:runtime-check'],
    'node scripts/check-packed-runtime-boundary.js',
    'packed runtime command drifted',
  );
  assert.equal(lock.version, pkg.version, 'lock root version drifted');
  assert.equal(lock.packages?.['']?.version, pkg.version, 'lock package version drifted');
  assert.equal(allowlist.schema, 'kdna.naming-integrity-third-party-allowlist');
  assert.equal(allowlist.schema_version, '0.1.0');
  assert.ok(Array.isArray(allowlist.exceptions));
  assert.ok(
    allowlist.exceptions.every((entry) => entry.path !== '.github/workflows/ci.yml'),
    'CI workflow must not be exempted from naming integrity',
  );
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  assertCiBoundary(loadCandidate(root));
  console.log('Exact Web Client CI, package, lock, and allowlist boundary passed.');
}
