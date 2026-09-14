#!/usr/bin/env node
// Permanent suite for the reference-asset leg (gap A).
//
// The leg may report `not_run` only for the exact published bytes at the exact registered
// path under the exact registered public Core version. Every way of losing that identity --
// damaged bytes, truncation, an empty or missing file, an unset binding, a wrong path, a
// renamed copy of the same bytes, a drifted registry expectation -- has to fail hard with
// no receipt at all, and the registered asset itself has to produce exactly one receipt
// and exit 0.
//
// Everything runs inside a disposable copy of the candidate, so the repository under review
// is never written to and the CI reference-assets checkout is never corrupted. The four
// observed values are exercised with a synthetic registration as well as the published one,
// which keeps each comparison falsifiable even when the checkout is absent.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { makeTempCandidate, removeTempCandidate } from './lib/temp-candidate.mjs';
import { REFERENCE_ASSET_REGISTRY, loadRegistry } from './reference-asset-registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = 'scripts/run-web-server-integration-gate.mjs';
const NOT_RUN_PREFIX = 'KDNA-CI-NOT-RUN:';
const RECEIPT_PREFIX = 'KDNA-CI-RECEIPT:';
const RUN_CLASS_MARKER = '"class":"run"';
const CONFIG_MISSING_PREFIX = 'KDNA-CI-CONFIG-MISSING:';
const ASSET_ENV = 'KDNA_WEB_CLIENT_ASSET';
const CORE_PACKAGE = '@aikdna/kdna-core';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const registry = loadRegistry(root);
const entry = registry.assets[0];
const installedCoreVersion = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules', ...CORE_PACKAGE.split('/'), 'package.json'), 'utf8'),
).version;

const checkoutAsset = path.join(root, entry.path);
let publishedBytes = null;
if (fs.existsSync(checkoutAsset)) {
  const bytes = fs.readFileSync(checkoutAsset);
  const observed = sha256(bytes);
  if (observed !== entry.sha256 || bytes.length !== entry.bytes) {
    console.error(
      `reference-asset gate suite: the checkout at ${entry.path} does not match ${entry.id} in `
        + `the registry (observed ${observed}, ${bytes.length} bytes; registered ${entry.sha256}, `
        + `${entry.bytes} bytes). Reconcile the registry or the checkout before trusting this leg.`,
    );
    process.exit(1);
  }
  publishedBytes = bytes;
}

const copy = makeTempCandidate(root);
const scratch = path.join(copy, 'suite-scratch');
fs.mkdirSync(scratch, { recursive: true });
// Every registry mutation below happens inside the disposable copy. The repository under
// review is never written to, and the guard makes that structural rather than a convention.
const registryFile = path.join(copy, REFERENCE_ASSET_REGISTRY);
assert.ok(!copy.startsWith(`${root}${path.sep}`), 'the disposable copy must live outside the repository under review');
assert.ok(registryFile.startsWith(`${copy}${path.sep}`), 'the registry under test must live inside the copy');
const registeredPath = path.join(copy, entry.path);
fs.mkdirSync(path.dirname(registeredPath), { recursive: true });

let passed = 0;
let failed = 0;
let skipped = 0;

function report(verdict, name, detail) {
  console.log(`${verdict} ${name}: ${detail}`);
  if (verdict === 'FAIL') failed += 1;
  else if (verdict === 'SKIP') skipped += 1;
  else passed += 1;
}

function runLeg(assetValue) {
  const env = { ...process.env, GITHUB_STEP_SUMMARY: '' };
  if (assetValue === undefined) delete env.KDNA_WEB_CLIENT_ASSET;
  else env.KDNA_WEB_CLIENT_ASSET = assetValue;
  const probe = spawnSync(process.execPath, [path.join(copy, RUNNER)], {
    cwd: copy,
    encoding: 'utf8',
    env,
  });
  const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  const lines = output.split('\n');
  return {
    status: probe.status,
    output,
    receipts: lines.filter((line) => line.startsWith(NOT_RUN_PREFIX)).length,
    // A run is a receipt whose class is `run`; the leg must never claim one while it is
    // refusing the supplied bytes.
    runs: lines.filter((line) => line.startsWith(RECEIPT_PREFIX) && line.includes(RUN_CLASS_MARKER)).length,
  };
}

function expectHardFailure(name, assetValue, { mentions = [] } = {}) {
  const result = runLeg(assetValue);
  const detail = `rc=${result.status} receipts=${result.receipts} runs=${result.runs}`;
  const silent = result.status === 1 && result.receipts === 0 && result.runs === 0;
  const explained = mentions.every((fragment) => result.output.includes(fragment));
  report(silent && explained ? 'PASS' : 'FAIL', name, explained ? detail : `${detail} (missing diagnostic)`);
  if (!(silent && explained)) console.log(`--- ${name} output ---\n${result.output}--- end ${name} ---`);
  return silent && explained;
}

/**
 * Missing or blank configuration is a distinguishable hard failure with its own exit code:
 * the leg cannot be asked to judge an asset it was never given, and the workflow sets the
 * variable explicitly, so its absence must never be reported as a not_run.
 */
function expectConfigMissing(name, assetValue) {
  const result = runLeg(assetValue);
  const detail = `rc=${result.status} receipts=${result.receipts} runs=${result.runs}`;
  const silent = result.status === 2 && result.receipts === 0 && result.runs === 0
    && !result.output.includes(RECEIPT_PREFIX);
  const explained = result.output.includes(CONFIG_MISSING_PREFIX)
    && result.output.includes(`missing=${ASSET_ENV}`);
  report(silent && explained ? 'PASS' : 'FAIL', name, explained ? detail : `${detail} (missing diagnostic)`);
  if (!(silent && explained)) console.log(`--- ${name} output ---\n${result.output}--- end ${name} ---`);
  return silent && explained;
}

function writeSibling(name, bytes) {
  const target = path.join(scratch, name);
  fs.writeFileSync(target, bytes);
  return target;
}

function withRegistry(assets, name, assetValue, options) {
  const original = fs.readFileSync(registryFile, 'utf8');
  fs.writeFileSync(registryFile, `${JSON.stringify({ ...registry, assets }, null, 2)}\n`);
  try {
    expectHardFailure(name, assetValue, options);
  } finally {
    fs.writeFileSync(registryFile, original);
  }
}

// --- negatives that need no registered bytes ------------------------------------------------
expectConfigMissing('env unset', undefined);
expectConfigMissing('env blank', '');
expectHardFailure('missing file', path.join(scratch, 'missing.kdna'), { mentions: ['cannot read'] });
expectHardFailure('wrong path over a readable file', path.join(copy, 'package.json'), {
  mentions: ['no registered asset is published at'],
});
expectHardFailure('empty file at a foreign path', writeSibling('empty.kdna', Buffer.alloc(0)), {
  mentions: ['is empty'],
});
expectHardFailure('garbage bytes at a foreign path', writeSibling('garbage.kdna', crypto.randomBytes(13)), {
  mentions: ['no registered asset is published at'],
});
expectHardFailure('directory instead of a file', scratch, { mentions: ['cannot read'] });

// --- the registered path, with everything but the published bytes ---------------------------
fs.writeFileSync(registeredPath, crypto.randomBytes(13));
expectHardFailure('garbage bytes at the registered path', entry.path, { mentions: ['sha256'] });
fs.writeFileSync(registeredPath, Buffer.alloc(0));
expectHardFailure('empty file at the registered path', entry.path, { mentions: ['is empty'] });
fs.rmSync(registeredPath, { force: true });
expectHardFailure('registered path removed after the registry was read', entry.path, {
  mentions: ['cannot read'],
});

// --- the four observed values, isolated with a synthetic registry ---------------------------
const probePath = 'public-assets/references/public/gate-probe.kdna';
const probeBlob = crypto.randomBytes(64);
const probeEntry = {
  id: 'gate-probe',
  repository: entry.repository,
  ref: entry.ref,
  path: probePath,
  sha256: sha256(probeBlob),
  bytes: probeBlob.length,
  core_version: installedCoreVersion,
  integration_script: 'test:web-server-integration',
};
fs.mkdirSync(path.dirname(path.join(copy, probePath)), { recursive: true });
fs.writeFileSync(path.join(copy, probePath), probeBlob);

withRegistry([{ ...probeEntry, sha256: 'f'.repeat(64) }], 'registry expects different bytes', probePath, {
  mentions: ['sha256'],
});
withRegistry([{ ...probeEntry, bytes: probeEntry.bytes + 1 }], 'registry expects a different byte length', probePath, {
  mentions: ['byte length'],
});
withRegistry(
  [{ ...probeEntry, core_version: `${installedCoreVersion}-not-installed` }],
  'registry expects a different public Core version',
  probePath,
  { mentions: [`installed ${CORE_PACKAGE}`] },
);
withRegistry(
  [{ ...probeEntry, path: 'public-assets/references/public/somewhere-else.kdna' }],
  'registry no longer publishes the invoked path',
  probePath,
  { mentions: ['no registered asset is published at'] },
);

// Control for the probe registry: a fully matching registration reaches the receipt path
// (exactly one receipt, rc=0) and never spawns the integration suite.
{
  const original = fs.readFileSync(registryFile, 'utf8');
  fs.writeFileSync(registryFile, `${JSON.stringify({ ...registry, assets: [probeEntry] }, null, 2)}\n`);
  try {
    const result = runLeg(probePath);
    const detail = `rc=${result.status} receipts=${result.receipts} runs=${result.runs}`;
    const clean = result.status === 0 && result.receipts === 1 && result.runs === 0;
    report(clean ? 'PASS' : 'FAIL', 'synthetic registration reaches exactly one receipt', detail);
    if (!clean) console.log(`--- synthetic registration output ---\n${result.output}--- end ---`);
  } finally {
    fs.writeFileSync(registryFile, original);
  }
}

// --- the published asset itself --------------------------------------------------------------
function requirePublishedBytes(name) {
  if (publishedBytes !== null) return true;
  report(
    'SKIP',
    name,
    `the registered asset ${entry.id} is not checked out at ${entry.path}; the CI job's `
      + 'reference-asset leg consumes the checkout and fails hard when it is missing',
  );
  return false;
}

if (requirePublishedBytes('published asset at the registered path')) {
  fs.writeFileSync(registeredPath, publishedBytes);
  const positive = runLeg(entry.path);
  const detail = `rc=${positive.status} receipts=${positive.receipts} runs=${positive.runs}`;
  const clean = positive.status === 0 && positive.receipts === 1 && positive.runs === 0;
  report(clean ? 'PASS' : 'FAIL', 'published asset at the registered path', detail);
  if (!clean) {
    console.log(`--- published asset output ---\n${positive.output}--- end ---`);
    if (positive.runs === 1) {
      console.log(
        'note: the current public Core admitted the registered asset, so the leg ran the real '
          + 'suite. Reconcile this expectation and the registry in the same reviewed change.',
      );
    }
  }
}

if (requirePublishedBytes('truncated published bytes')) {
  fs.writeFileSync(registeredPath, publishedBytes.subarray(0, Math.floor(publishedBytes.length / 2)));
  expectHardFailure('truncated published bytes at the registered path', entry.path, { mentions: ['byte length'] });
  fs.writeFileSync(registeredPath, publishedBytes);
}

if (requirePublishedBytes('renamed copy of the published bytes')) {
  const renamed = writeSibling('laozi-wuwei-0.1.1-copy.kdna', publishedBytes);
  expectHardFailure('renamed copy of the published bytes', renamed, {
    mentions: ['no registered asset is published at'],
  });
}

removeTempCandidate(copy);

console.log(
  `Reference-asset gate cases: ${passed} passed, ${failed} failed, ${skipped} skipped `
    + `(registry ${REFERENCE_ASSET_REGISTRY}, published asset ${entry.id}).`,
);
assert.ok(passed > 0, 'the reference-asset gate suite asserted nothing');
if (failed > 0) process.exit(1);
