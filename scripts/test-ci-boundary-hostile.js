#!/usr/bin/env node
// Hostile mutations for the CI boundary.
//
// Every assertion the boundary makes has to be falsifiable, including the assertions about
// the reference-asset leg runner itself. A runner that never asks the public client and
// never spawns the real command could print any receipt it liked; that exact replacement is
// a standing regression case here, run both in memory and end to end in a disposable copy.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_CHECKOUT_PATH,
  ASSET_REF,
  ASSET_REPOSITORY,
  CHECKOUT_ACTION,
  REFERENCE_ASSET,
  SETUP_NODE_ACTION,
  WEB_SERVER_INTEGRATION_GATE,
  VERIFY_LEG_RECEIPTS_SCRIPT,
  EXPECTED_CI_WORKFLOW,
  assertCiBoundary,
  loadCandidate,
} from './check-ci-boundary.js';
import { REFERENCE_ASSET_REGISTRY } from './reference-asset-registry.mjs';
import { makeTempCandidate, removeTempCandidate } from './lib/temp-candidate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const valid = loadCandidate(root);
assertCiBoundary(valid);

function replaceOnce(value, expected, replacement) {
  assert.equal(value.split(expected).length - 1, 1, `fixture fragment count drifted: ${expected}`);
  return value.replace(expected, replacement);
}

function copy(overrides = {}) {
  return {
    workflow: overrides.workflow ?? valid.workflow,
    pkg: overrides.pkg ?? structuredClone(valid.pkg),
    lock: overrides.lock ?? structuredClone(valid.lock),
    allowlist: overrides.allowlist ?? structuredClone(valid.allowlist),
    runnerSource: overrides.runnerSource ?? valid.runnerSource,
    legRegistrySource: overrides.legRegistrySource ?? valid.legRegistrySource,
    registry: overrides.registry ?? structuredClone(valid.registry),
    binding: overrides.binding ?? structuredClone(valid.binding),
  };
}

const mutableCheckout = ['actions/checkout@', 'v', '7'].join('');
const workflowMutations = new Map([
  ['paths-ignore bypass', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    '    branches: [main]\n  pull_request:',
    "    branches: [main]\n    paths-ignore:\n      - 'CHANGELOG.md'\n  pull_request:",
  )],
  ['job condition', replaceOnce(EXPECTED_CI_WORKFLOW, '  test:\n', '  test:\n    if: false\n')],
  ['step condition', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    '      - run: npm run ci\n',
    '      - if: false\n        run: npm run ci\n',
  )],
  ['job permission override', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    '  test:\n',
    '  test:\n    permissions:\n      contents: write\n',
  )],
  ['matrix exclusion', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    "        node: ['22.23.1', '24.18.0']\n",
    "        node: ['22.23.1', '24.18.0']\n        exclude:\n          - node: '20.20.2'\n",
  )],
  ['matrix inclusion', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    "        node: ['22.23.1', '24.18.0']\n",
    "        node: ['22.23.1', '24.18.0']\n        include:\n          - node: '28.0.0'\n",
  )],
  ['extra action', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    `      - uses: ${SETUP_NODE_ACTION}\n`,
    `      - uses: ${SETUP_NODE_ACTION}\n      - uses: ${SETUP_NODE_ACTION}\n`,
  )],
  ['mutable action', replaceOnce(EXPECTED_CI_WORKFLOW, SETUP_NODE_ACTION, mutableCheckout)],
  ['continue on error', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    '      - run: npm run ci\n',
    '      - run: npm run ci\n        continue-on-error: true\n',
  )],
  ['shell override', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    '      - run: npm run ci\n',
    '      - run: npm run ci\n        shell: bash\n',
  )],
  ['extra job', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    'jobs:\n',
    'jobs:\n  bypass:\n    runs-on: ubuntu-latest\n    steps: []\n',
  )],
  ['direct boundary removal', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    '      - run: node scripts/check-ci-boundary.js\n',
    '',
  )],
  ['dependency lifecycle enabled', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    '      - run: npm ci --ignore-scripts --no-audit --no-fund\n',
    '      - run: npm ci\n',
  )],
  ['reference-asset leg removed', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    `      - name: Exercise the pinned Web Server with the published reference asset\n`
      + `        env:\n          KDNA_WEB_CLIENT_ASSET: ${REFERENCE_ASSET}\n`
      + `        run: node ${WEB_SERVER_INTEGRATION_GATE}\n`,
    '',
  )],
  ['secondary asset checkout dropped', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    `      - uses: ${CHECKOUT_ACTION}\n        with:\n`
      + `          repository: ${ASSET_REPOSITORY}\n          ref: ${ASSET_REF}\n`
      + `          path: ${ASSET_CHECKOUT_PATH}\n`,
    '',
  )],
  ['reference asset swapped', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    `          KDNA_WEB_CLIENT_ASSET: ${REFERENCE_ASSET}\n        run: node ${WEB_SERVER_INTEGRATION_GATE}\n`,
    '          KDNA_WEB_CLIENT_ASSET: public-assets/references/public/laozi-wuwei/laozi-wuwei-0.1.0.kdna\n'
      + `        run: node ${WEB_SERVER_INTEGRATION_GATE}\n`,
  )],
  ['leg receipt verification step removed', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    `        run: node ${VERIFY_LEG_RECEIPTS_SCRIPT}\n`,
    '',
  )],
  ['leg runner replaced by a no-op', replaceOnce(
    EXPECTED_CI_WORKFLOW,
    `        run: node ${WEB_SERVER_INTEGRATION_GATE}\n`,
    '        run: node -e "process.exit(0)"\n',
  )],
]);

let rejected = 0;
for (const [name, workflow] of workflowMutations) {
  assert.throws(() => assertCiBoundary(copy({ workflow })), undefined, name);
  rejected += 1;
}

const packageMutations = new Map();
const noBoundaryStep = structuredClone(valid.pkg);
noBoundaryStep.scripts.ci = noBoundaryStep.scripts.ci.replace('npm run ci:boundary && ', '');
packageMutations.set('boundary step omitted', noBoundaryStep);
const noNaming = structuredClone(valid.pkg);
noNaming.scripts.ci = noNaming.scripts.ci.replace(' && npm run naming:check', '');
packageMutations.set('naming gate omitted', noNaming);
const noHttp = structuredClone(valid.pkg);
noHttp.scripts.ci = noHttp.scripts.ci.replace(' && npm run test:http', '');
packageMutations.set('actual-HTTP leg omitted', noHttp);
const noSize = structuredClone(valid.pkg);
noSize.scripts.ci = noSize.scripts.ci.replace(' && npm run size', '');
packageMutations.set('size gate omitted', noSize);
const noHostile = structuredClone(valid.pkg);
noHostile.scripts['ci:boundary'] = 'node scripts/check-ci-boundary.js';
packageMutations.set('hostile gates omitted', noHostile);
const publicNoOp = structuredClone(valid.pkg);
publicNoOp.scripts['public:check'] = 'node -e "process.exit(0)"';
packageMutations.set('public-surface no-op', publicNoOp);
const namingNoOp = structuredClone(valid.pkg);
namingNoOp.scripts['naming:check'] = 'node -e "process.exit(0)"';
packageMutations.set('naming no-op', namingNoOp);
const packNoOp = structuredClone(valid.pkg);
packNoOp.scripts['pack:check'] = 'node -e "process.exit(0)"';
packageMutations.set('packed-surface no-op', packNoOp);
const packOmitted = structuredClone(valid.pkg);
packOmitted.scripts.ci = packOmitted.scripts.ci.replace(' && npm run pack:check', '');
packageMutations.set('packed-surface gate omitted', packOmitted);
const assetSuiteNoOp = structuredClone(valid.pkg);
assetSuiteNoOp.scripts['test:reference-asset-gate'] = 'node -e "process.exit(0)"';
packageMutations.set('reference-asset suite no-op', assetSuiteNoOp);
const assetSuiteOmitted = structuredClone(valid.pkg);
assetSuiteOmitted.scripts.ci = assetSuiteOmitted.scripts.ci.replace(' && npm run test:reference-asset-gate', '');
packageMutations.set('reference-asset suite omitted', assetSuiteOmitted);
const packedHostileOmitted = structuredClone(valid.pkg);
packedHostileOmitted.scripts['ci:boundary'] = 'node scripts/check-ci-boundary.js && node scripts/test-ci-boundary-hostile.js';
packageMutations.set('packed-surface hostile suite omitted', packedHostileOmitted);
const noIntegration = structuredClone(valid.pkg);
delete noIntegration.scripts['test:web-server-integration'];
packageMutations.set('real integration omitted', noIntegration);
const rangedServer = structuredClone(valid.pkg);
rangedServer.devDependencies['@aikdna/kdna-web-server'] = '^0.5.0-rc.component-semantics.1';
packageMutations.set('Web Server range dependency', rangedServer);
const olderEngine = structuredClone(valid.pkg);
olderEngine.engines.node = '>=20';
packageMutations.set('engine floor weakened', olderEngine);
for (const [name, pkg] of packageMutations) {
  assert.throws(() => assertCiBoundary(copy({ pkg })), undefined, name);
  rejected += 1;
}

const lock = structuredClone(valid.lock);
lock.packages[''].version = '0.0.0';
assert.throws(() => assertCiBoundary(copy({ lock })), undefined, 'lock drift');
rejected += 1;

const allowlist = structuredClone(valid.allowlist);
allowlist.exceptions.push({
  path: '.github/workflows/ci.yml',
  token: 'bypass',
  count: 1,
  reason: 'Third-party hostile fixture.',
});
assert.throws(() => assertCiBoundary(copy({ allowlist })), undefined, 'workflow allowlist bypass');
rejected += 1;

// The reference-asset leg runner is an asserted object. A replacement that keeps printing a
// plausible receipt without consulting the public client or spawning the real command is the
// exact bypass this gate exists to stop.
const fakeReceiptStub = [
  '#!/usr/bin/env node',
  'console.log(\'KDNA-CI-NOT-RUN: {"leg":"web-server-integration","status":"not_run",'
    + '"reason":"READ_CORE_INVALID","reason_class":"public_core_rejected_registered_reference_asset"}\');',
  'process.exit(0);',
  '',
].join('\n');
const runnerMutations = new Map([
  ['leg runner replaced by a fake-receipt stub', { runnerSource: fakeReceiptStub }],
  ['leg registry stops consulting the public client', {
    legRegistrySource: replaceOnce(valid.legRegistrySource, 'selectKDNA(', 'inspectBytesInstead('),
  }],
  ['leg registry stops loading the committed client entry', {
    legRegistrySource: replaceOnce(
      valid.legRegistrySource,
      "require(path.join(root, 'src', 'client.cjs'))",
      "require(path.join(root, 'src', 'index.js'))",
    ),
  }],
  ['leg runner stops recomputing the unavailability codes', {
    runnerSource: replaceOnce(
      valid.runnerSource,
      'await unavailabilityCodes({ root, bytes })',
      'await Promise.resolve({ codes: [], detail: {} })',
    ),
  }],
  ['leg runner stops binding the committed leg registry', {
    runnerSource: replaceOnce(
      valid.runnerSource,
      "from './ci-leg-registry.mjs'",
      "from './some-other-registry.mjs'",
    ),
  }],
  ['leg runner stops spawning the reviewed command', {
    runnerSource: replaceOnce(
      valid.runnerSource,
      'spawnSync(command, commandArgs',
      "spawnSync('npm', ['run', 'test:not-the-reviewed-suite']",
    ),
  }],
  ['leg runner stops adopting the real exit code', {
    runnerSource: replaceOnce(
      valid.runnerSource,
      'process.exit(result.status ?? 1)',
      'process.exit(0)',
    ),
  }],
  ['leg runner stops binding the registry', {
    runnerSource: replaceOnce(
      valid.runnerSource,
      'matchRegisteredAsset(',
      'trustAnyAsset(',
    ),
  }],
])
for (const [name, overrides] of runnerMutations) {
  assert.throws(() => assertCiBoundary(copy(overrides)), undefined, name);
  rejected += 1;
}

// The registry is the single reviewable statement of which bytes are the published asset.
function mutateRegistry(name, mutate) {
  const registry = structuredClone(valid.registry);
  mutate(registry);
  return [name, registry];
}

const registryMutations = new Map([
  mutateRegistry('registry stops publishing the CI leg path', (registry) => {
    registry.assets[0].path = 'public-assets/references/public/somewhere-else.kdna';
  }),
  mutateRegistry('registry publishes an absolute path', (registry) => {
    registry.assets[0].path = '/opt/kdna/reference.kdna';
  }),
  mutateRegistry('registry binds a Core version the binding does not declare', (registry) => {
    registry.assets[0].core_version = '0.0.0-not-the-bound-core';
  }),
  mutateRegistry('registry drops its format marker', (registry) => {
    registry.format = 'something-else';
  }),
  mutateRegistry('registry registers no asset', (registry) => {
    registry.assets = [];
  }),
  mutateRegistry('registry presents a malformed digest', (registry) => {
    registry.assets[0].sha256 = 'not-a-digest';
  }),
  mutateRegistry('registry invents an extra entry key', (registry) => {
    registry.assets[0].skip_verification = true;
  }),
  mutateRegistry('registry unpins the upstream revision', (registry) => {
    registry.assets[0].ref = 'main';
  }),
]);
for (const [name, registry] of registryMutations) {
  assert.throws(() => assertCiBoundary(copy({ registry })), undefined, name);
  rejected += 1;
}

console.log(`CI boundary hostile mutations rejected: ${rejected}/${rejected}.`);

// --- end-to-end regressions in disposable copies ---------------------------------------------

// 1. The bypass itself: replace the leg runner with a fake-receipt stub and the whole
//    boundary check has to go red -- in the tree, not only in the in-memory assertion.
{
  const stubCopy = makeTempCandidate(root);
  const reason = [];
  try {
    // Control first: in the pristine copy the boundary check must really run and pass. Without
    // this, a gate that silently did nothing would "catch" the stub by doing nothing at all.
    const control = spawnSync(process.execPath, [path.join(stubCopy, 'scripts/check-ci-boundary.js')], {
      cwd: stubCopy,
      encoding: 'utf8',
    });
    assert.equal(control.status, 0, 'the boundary check must pass in the pristine disposable copy');
    assert.match(
      control.stdout ?? '',
      /boundary passed/u,
      'the boundary check must actually execute in the disposable copy instead of silently no-oping',
    );
    fs.writeFileSync(path.join(stubCopy, WEB_SERVER_INTEGRATION_GATE), fakeReceiptStub);
    const probe = spawnSync(process.execPath, [path.join(stubCopy, 'scripts/check-ci-boundary.js')], {
      cwd: stubCopy,
      encoding: 'utf8',
    });
    const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
    assert.equal(probe.status, 1, 'a fake-receipt leg runner must turn the boundary check red');
    assert.match(output, /leg runner/u, 'the boundary check must say the leg runner is the defect');
    reason.push(`pristine rc=${control.status}, stub runner -> boundary rc=${probe.status}`);
  } finally {
    removeTempCandidate(stubCopy);
  }
  console.log(`E2E: ${reason.join('; ')}.`);
}

// 2. The other half: when the registry does publish the supplied bytes and the current public
//    Core admits them, the leg must actually spawn `npm run test:web-server-integration` and
//    adopt its exit code -- not print a receipt and call it a day.
{
  const acceptedCopy = makeTempCandidate(root);
  const reason = [];
  try {
    const fixture = path.join(root, 'tests/components/fixtures/independent-mechanisms.kdna');
    const bytes = fs.readFileSync(fixture);
    const registeredPath = 'public-assets/references/public/gate-accepted.kdna';
    const target = path.join(acceptedCopy, registeredPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    const installedCoreVersion = JSON.parse(fs.readFileSync(
      path.join(root, 'node_modules', '@aikdna', 'kdna-core', 'package.json'),
      'utf8',
    )).version;
    const registryFile = path.join(acceptedCopy, REFERENCE_ASSET_REGISTRY);
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    registry.assets = [{
      id: 'gate-accepted-fixture',
      repository: valid.registry.assets[0].repository,
      ref: valid.registry.assets[0].ref,
      path: registeredPath,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      core_version: installedCoreVersion,
      integration_script: 'test:web-server-integration',
    }];
    fs.writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
    const probe = spawnSync(process.execPath, [path.join(acceptedCopy, WEB_SERVER_INTEGRATION_GATE)], {
      cwd: acceptedCopy,
      encoding: 'utf8',
      env: { ...process.env, KDNA_WEB_CLIENT_ASSET: registeredPath, GITHUB_STEP_SUMMARY: '' },
    });
    const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
    assert.match(
      output,
      /KDNA-CI-RECEIPT: .*"class":"run"/u,
      'an admitted registered asset must be reported as a run',
    );
    assert.match(
      output,
      /test:web-server-integration/u,
      'the admitted leg must actually spawn the real integration command',
    );
    assert.equal(
      probe.status,
      1,
      'the leg exit code must be the spawned suite exit code: the historical suite pins the '
        + 'Laozi asset identity, so an admitted non-Laozi fixture fails with 1',
    );
    reason.push(`admitted asset -> real spawn observed, leg rc=${probe.status}`);
  } finally {
    removeTempCandidate(acceptedCopy);
  }
  console.log(`E2E: ${reason.join('; ')}.`);
}

console.log('CI boundary end-to-end hostile regressions passed: 2/2.');
