#!/usr/bin/env node
// Independent gate over the `web-server-integration` receipt mechanism.
//
// The receipt generator (scripts/run-web-server-integration-gate.mjs) is never trusted
// about its own verdict. This verifier re-derives, from the committed bytes, the
// unavailability codes the leg is allowed to report, then requires the gate's
// machine-readable receipt to agree: the leg name, the class, the registered reason and
// object, the code set in both directions, and the sha256 digests of the exact committed
// input files the receipt claims to have read.
//
// It also proves the not_run mechanism is not self-suppressing: it builds a sandbox in
// which both registered codes are gone (the public client admits the bytes, and the
// integration leg drives the package's published entry) and requires the gate to run the
// leg instead of printing not_run.
//
// usage: node scripts/verify-ci-leg-receipts.mjs [--root <tree>]
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  INTEGRATION_LEG_MODULE,
  LEGS,
  REGISTRY_PATH,
  entryExpired,
  loadLegRegistry,
  registrationFor,
  sameCodeSet,
  unavailabilityCodes,
} from './ci-leg-registry.mjs';
import { REFERENCE_ASSET_REGISTRY, loadRegistry } from './reference-asset-registry.mjs';

const NOT_RUN_PREFIX = 'KDNA-CI-NOT-RUN:';
const RECEIPT_PREFIX = 'KDNA-CI-RECEIPT:';
const LEG = 'web-server-integration';
const ASSET_ENV = 'KDNA_WEB_CLIENT_ASSET';
const DIGEST_INPUTS = [
  REGISTRY_PATH,
  REFERENCE_ASSET_REGISTRY,
  INTEGRATION_LEG_MODULE,
  'docs/current-core-read-binding.json',
  'package.json',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function digestOf(root, relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
}

function expectedDigests(root) {
  return Object.fromEntries(DIGEST_INPUTS.map((relative) => [relative, digestOf(root, relative)]));
}

function onlyLine(stdout, prefix) {
  const lines = stdout.split('\n').filter((line) => line.startsWith(prefix));
  assert.equal(lines.length, 1, `expected exactly one ${prefix} line, got ${lines.length}:\n${stdout}`);
  return lines[0];
}

function parseReceipt(stdout) {
  return JSON.parse(onlyLine(stdout, RECEIPT_PREFIX).slice(RECEIPT_PREFIX.length));
}

function runGate(root, environment) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'run-web-server-integration-gate.mjs')], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
  });
}

function registeredAssetBytes(root, assetRegistry) {
  const [entry] = assetRegistry.assets;
  return fs.readFileSync(path.join(root, entry.path));
}

function checkConfigMissing(root, findings) {
  const environment = { ...process.env };
  delete environment[ASSET_ENV];
  const result = runGate(root, environment);
  if (result.status !== 2) {
    findings.push({ check: 'config_missing_exit', detail: `expected exit 2, got ${result.status}` });
  }
  if (!result.stderr.includes(`KDNA-CI-CONFIG-MISSING: ${LEG} missing=`)) {
    findings.push({ check: 'config_missing_diagnostic', detail: result.stderr.trim() });
  }
  if (result.stdout.includes(RECEIPT_PREFIX) || result.stdout.includes(NOT_RUN_PREFIX)) {
    findings.push({ check: 'config_missing_emitted_receipt', detail: result.stdout.trim() });
  }
}

async function checkReceipt(root, findings) {
  const registry = loadLegRegistry(root);
  const registration = registrationFor(registry, LEG);
  if (!registration) {
    findings.push({ leg: LEG, check: 'leg_not_registered' });
    return undefined;
  }
  const assetRegistry = loadRegistry(root);
  const bytes = registeredAssetBytes(root, assetRegistry);
  const asset = assetRegistry.assets[0];
  const computed = await unavailabilityCodes({ root, bytes });
  const registeredCodes = new Set(registration.unavailable_codes ?? []);
  for (const code of computed.codes) {
    if (!registeredCodes.has(code)) findings.push({ leg: LEG, check: 'unregistered_unavailability_code', detail: code });
  }
  for (const code of registeredCodes) {
    if (!computed.codes.includes(code)) findings.push({ leg: LEG, check: 'registered_code_no_longer_true', detail: code });
  }
  if (typeof registration.trigger !== 'string' || registration.trigger.length < 64) {
    findings.push({ leg: LEG, check: 'registration_without_trigger' });
  }
  if (entryExpired(registration)) {
    findings.push({ leg: LEG, check: 'registration_expired', detail: registration.review_by });
  }
  const environment = { ...process.env, [ASSET_ENV]: asset.path };
  const result = runGate(root, environment);
  if (result.error) throw result.error;
  if (!(result.pid > 0)) findings.push({ leg: LEG, check: 'gate_not_spawned' });

  let receipt;
  try {
    receipt = parseReceipt(result.stdout);
  } catch (error) {
    findings.push({ leg: LEG, check: 'receipt_unreadable', detail: `${error.message} | status=${result.status}` });
    return undefined;
  }
  if (receipt.leg !== LEG) findings.push({ leg: LEG, check: 'receipt_leg', detail: String(receipt.leg) });
  try {
    assert.deepEqual(receipt.inputs, expectedDigests(root));
  } catch {
    findings.push({
      leg: LEG,
      check: 'receipt_input_digest',
      detail: 'the receipt is not bound to the sha256 digests of the committed input files',
    });
  }

  const expected = sameCodeSet(computed.codes, registration.unavailable_codes ?? []) ? 'not_run' : 'run';
  if (expected === 'not_run') {
    if (result.status !== 0) findings.push({ leg: LEG, check: 'not_run_exit', detail: String(result.status) });
    try {
      onlyLine(result.stdout, NOT_RUN_PREFIX);
    } catch (error) {
      findings.push({ leg: LEG, check: 'not_run_line', detail: error.message });
    }
    if (receipt.class !== 'not_run') findings.push({ leg: LEG, check: 'not_run_class', detail: String(receipt.class) });
    if (receipt.reason !== registration.reason) findings.push({ leg: LEG, check: 'not_run_reason', detail: String(receipt.reason) });
    if (receipt.object !== LEGS[LEG].object) findings.push({ leg: LEG, check: 'not_run_object', detail: String(receipt.object) });
    if (!sameCodeSet(receipt.unavailable_codes ?? [], registration.unavailable_codes ?? [])) {
      findings.push({ leg: LEG, check: 'not_run_codes', detail: (receipt.unavailable_codes ?? []).join(',') });
    }
    return receipt;
  }

  const legRun = spawnSync(LEGS[LEG].command[0], LEGS[LEG].command.slice(1), {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  });
  if (receipt.class !== 'run') findings.push({ leg: LEG, check: 'run_class', detail: String(receipt.class) });
  if (receipt.status !== result.status) findings.push({ leg: LEG, check: 'run_status', detail: String(receipt.status) });
  if (result.status !== legRun.status) {
    findings.push({ leg: LEG, check: 'run_not_the_leg', detail: `gate=${result.status} leg=${legRun.status}` });
  }
  return receipt;
}

// Build a sandbox whose committed bytes satisfy no registered code, and require the gate
// to run the leg instead of printing not_run.
function checkNotRunIsFalsifiable(root, findings) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kdna-web-client-ci-leg-'));
  try {
    const assetRegistry = loadRegistry(root);
    const asset = assetRegistry.assets[0];
    const packageJson = readJson(path.join(root, 'package.json'));
    // The leg command is shimmed: this check is about the gate's decision, not about
    // driving a real Web Server.
    packageJson.scripts = {
      ...packageJson.scripts,
      [LEGS[LEG].command.slice(1).join(' ')]: 'node -e "process.exit(0)"',
    };
    const files = [
      REGISTRY_PATH,
      REFERENCE_ASSET_REGISTRY,
      'docs/current-core-read-binding.json',
      asset.path,
    ];
    for (const relative of files) {
      fs.mkdirSync(path.dirname(path.join(sandbox, relative)), { recursive: true });
      fs.copyFileSync(path.join(root, relative), path.join(sandbox, relative));
    }
    fs.writeFileSync(path.join(sandbox, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    fs.mkdirSync(path.join(sandbox, 'scripts'), { recursive: true });
    for (const name of ['run-web-server-integration-gate.mjs', 'ci-leg-registry.mjs', 'reference-asset-registry.mjs']) {
      fs.copyFileSync(path.join(root, 'scripts', name), path.join(sandbox, 'scripts', name));
    }
    // 1. The integration leg drives the package's published entry.
    fs.mkdirSync(path.join(sandbox, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, INTEGRATION_LEG_MODULE),
      "import { createKDNAWebClient } from '../src/client.cjs';\nvoid createKDNAWebClient;\n",
    );
    // 2. The public client admits the bytes, and the installed Core reports the version
    //    the reference-asset registry names.
    fs.mkdirSync(path.join(sandbox, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'src', 'client.cjs'),
      "'use strict';\nmodule.exports = { selectKDNA: async () => ({ status: 'selected', states: {} }) };\n",
    );
    fs.mkdirSync(path.join(sandbox, 'node_modules', '@aikdna', 'kdna-core'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'node_modules', '@aikdna', 'kdna-core', 'package.json'),
      `${JSON.stringify({ name: '@aikdna/kdna-core', version: asset.core_version }, null, 2)}\n`,
    );
    const environment = { ...process.env, [ASSET_ENV]: asset.path };
    const result = runGate(sandbox, environment);
    if (result.stdout.includes(NOT_RUN_PREFIX)) {
      findings.push({
        leg: LEG,
        check: 'not_run_is_permanent',
        detail: 'both registered codes were removed and the gate still refused to run the leg',
      });
      return;
    }
    let receipt;
    try {
      receipt = parseReceipt(result.stdout);
    } catch (error) {
      findings.push({
        leg: LEG,
        check: 'falsification_receipt',
        detail: `${error.message} | status=${result.status} stderr=${result.stderr.trim()}`,
      });
      return;
    }
    if (receipt.class !== 'run') findings.push({ leg: LEG, check: 'falsification_class', detail: String(receipt.class) });
  } catch (error) {
    findings.push({ leg: LEG, check: 'falsification_error', detail: error.message });
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

export async function verify(root) {
  const findings = [];
  checkConfigMissing(root, findings);
  const receipt = await checkReceipt(root, findings);
  checkNotRunIsFalsifiable(root, findings);
  return { findings, receipts: receipt ? [receipt] : [] };
}

async function main(argv) {
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex === -1 ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') : path.resolve(argv[rootIndex + 1]);
  const { findings, receipts } = await verify(root);
  if (findings.length > 0) {
    console.log(`KDNA-CI-LEG-RECEIPTS: findings=${findings.length} root=${root} ${JSON.stringify(findings)}`);
    return 1;
  }
  const classes = receipts.map((entry) => `${entry.leg}=${entry.class}`).join(',');
  console.log(`KDNA-CI-LEG-RECEIPTS: ok root=${root} legs=${receipts.length} ${classes}`);
  return 0;
}

// Resolve both sides: invoked through a symlink or a differently spelled path, the gate must
// still run rather than quietly do nothing.
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2));
}
