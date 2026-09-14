#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  REFERENCE_ASSET_REGISTRY,
  assertRegistryShape,
} from './reference-asset-registry.mjs';

export const CHECKOUT_ACTION = 'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0';
export const SETUP_NODE_ACTION = 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38';
export const TESTED_NODE_RELEASES = Object.freeze([
  '22.23.1', '24.18.0',
]);
export const ASSET_REPOSITORY = 'aikdna/kdna-assets';
export const ASSET_REF = '2dd1e2844fd8b8deff8ea0e2620fd946e5c9544f';
export const ASSET_CHECKOUT_PATH = 'public-assets';
export const REFERENCE_ASSET = 'public-assets/references/public/laozi-wuwei/laozi-wuwei-0.1.1.kdna';
export const WEB_SERVER_INTEGRATION_SCRIPT = 'node --test tests/web-server-integration.test.js';
export const WEB_SERVER_INTEGRATION_GATE = 'scripts/run-web-server-integration-gate.mjs';
export const LEG_REGISTRY_MODULE = 'scripts/ci-leg-registry.mjs';
export const VERIFY_LEG_RECEIPTS_SCRIPT = 'scripts/verify-ci-leg-receipts.mjs';
export const WEB_SERVER_DEPENDENCY = 'file:vendor/aikdna-kdna-web-server-0.5.0-rc.component-semantics.1.tgz';
export const WEB_SERVER_VERSION = '0.5.0-rc.component-semantics.1';
export const PACKED_SURFACE_GATE = 'scripts/check-packed-surface.js';
export const PACKED_SURFACE_HOSTILE = 'scripts/test-packed-surface-hostile.js';
export const REFERENCE_ASSET_SUITE = 'scripts/test-reference-asset-gate.mjs';
export const PACKED_SURFACE_COMMAND = `node ${PACKED_SURFACE_GATE}`;
export const REFERENCE_ASSET_SUITE_COMMAND = `node ${REFERENCE_ASSET_SUITE}`;
// The leg runner is itself an asserted object: a runner that never asks the public client
// and never spawns the real command could print any receipt it liked and stay green. The
// runner delegates the admission verdict and the unavailability recomputation to the
// committed leg registry module, so the two files are asserted together: a runner that
// kept its own shape while the module stopped consulting the public client is the same
// bypass one file later.
export const RUNNER_REQUIRED_SOURCE = Object.freeze([
  [/from '\.\/reference-asset-registry\.mjs'/u, 'bind the committed reference-asset registry'],
  [/matchRegisteredAsset\(/u, 'compare the observation against the registry'],
  [/from '\.\/ci-leg-registry\.mjs'/u, 'bind the committed CI leg registry'],
  [/await unavailabilityCodes\(/u, 'recompute the leg unavailability codes from the committed bytes'],
  [/require\(path\.join\(root, 'src', 'client\.cjs'\)\)/u, 'load the committed public client entry'],
  [/selectKDNA\(/u, 'ask the public client for the admission verdict'],
  [/const \[command, \.\.\.commandArgs\] = DEFINITION\.command/u, 'take the reviewed command from the committed leg definition'],
  [/spawnSync\(command, commandArgs/u, 'spawn the real integration command with an explicit argv'],
  [/process\.exit\(result\.status/u, 'adopt the real command exit code as the leg exit code'],
]);
export const EXPECTED_PACKAGE_GATE = Object.freeze([
  'npm run ci:boundary',
  'npm test',
  'npm run typecheck',
  'npm run lint',
  'npm run build',
  'npm run size',
  'npm run check:current-graph',
  'npm run public:check',
  'npm run naming:check',
  'npm run test:http',
  'npm run pack:check',
  'npm run test:reference-asset-gate',
]);
export const EXPECTED_BOUNDARY_GATE = [
  'node scripts/check-ci-boundary.js',
  'node scripts/test-ci-boundary-hostile.js',
  'node scripts/test-packed-surface-hostile.js',
].join(' && ');
export const EXPECTED_CI_WORKFLOW = [
  'name: CI',
  'on:',
  '  push:',
  '    branches: [main]',
  '  pull_request:',
  'permissions:',
  '  contents: read',
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
  `      - uses: ${CHECKOUT_ACTION}`,
  '        with:',
  `          repository: ${ASSET_REPOSITORY}`,
  `          ref: ${ASSET_REF}`,
  `          path: ${ASSET_CHECKOUT_PATH}`,
  `      - uses: ${SETUP_NODE_ACTION}`,
  '        with:',
  '          node-version: ${{ matrix.node }}',
  '          check-latest: false',
  '      - run: npm ci --ignore-scripts --no-audit --no-fund',
  '      - run: node scripts/check-ci-boundary.js',
  '      - run: npm run ci',
  '      - name: Exercise the pinned Web Server with the published reference asset',
  '        env:',
      `          KDNA_WEB_CLIENT_ASSET: ${REFERENCE_ASSET}`,
      `        run: node ${WEB_SERVER_INTEGRATION_GATE}`,
      '      # The receipt generator is never trusted about its own verdict: this step re-derives',
      "      # the leg's unavailability codes from the committed bytes, requires the receipt, the",
      '      # registration and the recomputation to agree in both directions, and proves the',
      '      # not_run disappears once its registered codes are gone.',
      '      - name: Verify the CI leg receipt against the committed bytes',
      '        env:',
      `          KDNA_WEB_CLIENT_ASSET: ${REFERENCE_ASSET}`,
      `        run: node ${VERIFY_LEG_RECEIPTS_SCRIPT}`,
      '',
].join('\n');

export function loadCandidate(root) {
  for (const artifact of [
    WEB_SERVER_INTEGRATION_GATE,
    LEG_REGISTRY_MODULE,
    VERIFY_LEG_RECEIPTS_SCRIPT,
    REFERENCE_ASSET_REGISTRY,
    PACKED_SURFACE_GATE,
    PACKED_SURFACE_HOSTILE,
    REFERENCE_ASSET_SUITE,
    'docs/current-core-read-binding.json',
  ]) {
    assert.ok(
      fs.existsSync(path.join(root, artifact)),
      `a required CI gate artifact is missing: ${artifact}`,
    );
  }
  return {
    workflow: fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'),
    pkg: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
    lock: JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')),
    allowlist: JSON.parse(fs.readFileSync(
      path.join(root, 'scripts/naming-integrity-allowlist.json'),
      'utf8',
    )),
    runnerSource: fs.readFileSync(path.join(root, WEB_SERVER_INTEGRATION_GATE), 'utf8'),
    legRegistrySource: fs.readFileSync(path.join(root, LEG_REGISTRY_MODULE), 'utf8'),
    registry: JSON.parse(fs.readFileSync(path.join(root, REFERENCE_ASSET_REGISTRY), 'utf8')),
    binding: JSON.parse(fs.readFileSync(path.join(root, 'docs/current-core-read-binding.json'), 'utf8')),
  };
}

export function assertCiBoundary({ workflow, pkg, lock, allowlist, runnerSource, legRegistrySource, registry, binding }) {
  assert.equal(workflow, EXPECTED_CI_WORKFLOW, 'CI workflow is not the exact reviewed contract');
  // The secondary asset checkout exists only to feed the reference-asset leg;
  // a checkout with no consumer is the defect this boundary exists to catch.
  assert.ok(
    workflow.includes(`          path: ${ASSET_CHECKOUT_PATH}\n`)
      && workflow.includes(`          KDNA_WEB_CLIENT_ASSET: ${REFERENCE_ASSET}\n`),
    'the secondary asset checkout must stay consumed by the reference-asset leg',
  );
  assert.equal(pkg.engines?.node, '>=22', 'Node engine floor drifted');
  assert.deepEqual(
    pkg.scripts?.ci?.split(/\s*&&\s*/u),
    EXPECTED_PACKAGE_GATE,
    'package CI gate drifted',
  );
  assert.equal(pkg.scripts?.['ci:boundary'], EXPECTED_BOUNDARY_GATE, 'boundary gate drifted');
  assert.equal(
    pkg.scripts?.['public:check'],
    'node scripts/check-public-surface.js',
    'public-surface command drifted',
  );
  assert.equal(
    pkg.scripts?.['naming:check'],
    'node scripts/check-naming-integrity.js',
    'naming command drifted',
  );
  assert.equal(
    pkg.scripts?.['test:web-server-integration'],
    WEB_SERVER_INTEGRATION_SCRIPT,
    'real Web Server integration command drifted',
  );
  assert.equal(pkg.scripts?.['pack:check'], PACKED_SURFACE_COMMAND, 'packed-surface gate command drifted');
  assert.equal(
    pkg.scripts?.['test:reference-asset-gate'],
    REFERENCE_ASSET_SUITE_COMMAND,
    'reference-asset gate suite command drifted',
  );
  assert.equal(
    pkg.devDependencies?.['@aikdna/kdna-web-server'],
    WEB_SERVER_DEPENDENCY,
    'Web Server integration dependency drifted',
  );
  assert.equal(
    lock.packages?.['node_modules/@aikdna/kdna-web-server']?.version,
    WEB_SERVER_VERSION,
    'Web Server integration lock drifted',
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

  // Gap B: the leg runner is an asserted object, not a trust anchor. Whatever it prints,
  // it must have bound the registry, asked the public client, and owned a real spawn.
  assert.ok(typeof runnerSource === 'string' && runnerSource.length > 0, 'the leg runner has no source');
  assert.ok(
    typeof legRegistrySource === 'string' && legRegistrySource.length > 0,
    'the committed CI leg registry module has no source',
  );
  assert.match(
    runnerSource,
    /from '\.\/ci-leg-registry\.mjs'/u,
    'the leg runner must bind the committed CI leg registry',
  );
  const legSource = `${runnerSource}\n${legRegistrySource}`;
  for (const [pattern, requirement] of RUNNER_REQUIRED_SOURCE) {
    assert.match(legSource, pattern, `the leg runner must ${requirement}`);
  }

  // Gap A: the published reference asset the leg may treat as ground truth lives in one
  // committed registry, and the path the workflow invokes the leg with must be registered.
  const assets = assertRegistryShape(registry, REFERENCE_ASSET_REGISTRY);
  const registered = assets.filter((entry) => entry.path === REFERENCE_ASSET);
  assert.equal(registered.length, 1, 'the leg must be invoked with a path the registry publishes');
  const boundCoreVersion = binding?.packages
    ?.find((entry) => entry?.name === '@aikdna/kdna-core')?.version ?? null;
  assert.ok(boundCoreVersion, 'the committed dependency binding declares no public Core version');
  assert.equal(
    registered[0].core_version,
    boundCoreVersion,
    'the registry Core version must be the committed dependency binding Core version',
  );
  assert.equal(
    registered[0].integration_script,
    'test:web-server-integration',
    'the registry must name the reviewed integration command',
  );
}

/**
 * Behavioural half of the runner gate: the runner must refuse an asset that is not the
 * registered published one. A replacement that always prints a plausible receipt and
 * exits 0 is caught here even if it reuses the same constants, because it cannot refuse.
 */
export function assertRunnerRefusesUnregisteredAsset(root) {
  const runner = path.join(root, WEB_SERVER_INTEGRATION_GATE);
  const scratch = fs.mkdtempSync(path.join(tmpdir(), 'kdna-boundary-runner-'));
  const foreign = path.join(scratch, 'unregistered.kdna');
  try {
    fs.writeFileSync(foreign, Buffer.from('KDNA-CI-BOUNDARY-PROBE-NOT-A-PUBLISHED-ASSET'));
    const probe = spawnSync(process.execPath, [runner], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, KDNA_WEB_CLIENT_ASSET: foreign, GITHUB_STEP_SUMMARY: '' },
    });
    const observed = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
    assert.equal(
      probe.status,
      1,
      'the leg runner must fail hard on an asset that is not the registered published asset',
    );
    assert.equal(
      observed.includes('KDNA-CI-NOT-RUN:'),
      false,
      'the leg runner must emit no receipt for an asset that is not the registered published asset',
    );
    assert.equal(
      observed.includes('KDNA-CI-RECEIPT:'),
      false,
      'the leg runner must emit no receipt at all for an asset that is not the registered published asset',
    );
    assert.equal(
      observed.includes('"class":"run"'),
      false,
      'the leg runner must not claim a run for an asset that is not the registered published asset',
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Comparing raw URLs is not enough: a checkout reached through a symlinked prefix (/var,
// /tmp) has a different import.meta.url than process.argv[1], and the gate would silently
// do nothing -- the exact "looks green, verified nothing" failure this file exists to stop.
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
  assertCiBoundary(loadCandidate(root));
  assertRunnerRefusesUnregisteredAsset(root);
  console.log('Exact Web Client CI, package, lock, and allowlist boundary passed.');
}
