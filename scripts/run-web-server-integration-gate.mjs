#!/usr/bin/env node
// CI leg gate for `web-server-integration`.
//
// Exactly three outcomes are allowed, and they are distinguishable:
//   * required configuration missing  -> `KDNA-CI-CONFIG-MISSING` on stderr, exit 2, and
//     no receipt is printed;
//   * the leg is registered in fixtures/ci-leg-registry.json AND the unavailability codes
//     recomputed from the committed bytes are exactly the registered codes -> exactly one
//     `KDNA-CI-NOT-RUN:` line plus one machine-readable `KDNA-CI-RECEIPT:` line, exit 0;
//   * otherwise -> the real leg command runs and its exit status becomes this process's
//     exit status, with one `run` receipt.
//
// The gate cannot invent a not_run out of a condition of its own. Three properties are
// required before any receipt at all:
//
//   1. Asset identity. The observed path, the sha256 of the bytes actually read, their
//      byte length and the installed public Core version must all match one entry of the
//      committed reference-asset registry (docs/reference-asset-registry.json). A damaged,
//      truncated, renamed or unregistered asset is a hard failure with no receipt, so
//      corrupt bytes can never borrow the receipt that belongs to a published asset.
//   2. Registry authority. A not_run needs the leg to be named in
//      fixtures/ci-leg-registry.json, with a reason, the recomputed codes, a trigger and a
//      review_by expiry that has not passed.
//   3. Code agreement. The recomputed code set must equal the registered set in both
//      directions. scripts/verify-ci-leg-receipts.mjs re-derives the same codes and
//      refuses a receipt that disagrees or is not bound to the committed input digests.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  INTEGRATION_LEG_MODULE,
  LEGS,
  REGISTRY_PATH,
  entryExpired,
  installedCoreVersion,
  loadLegRegistry,
  registrationFor,
  sameCodeSet,
  unavailabilityCodes,
} from './ci-leg-registry.mjs';
import {
  REFERENCE_ASSET_REGISTRY,
  loadRegistry,
  matchRegisteredAsset,
} from './reference-asset-registry.mjs';

const NOT_RUN_PREFIX = 'KDNA-CI-NOT-RUN:';
const RECEIPT_PREFIX = 'KDNA-CI-RECEIPT:';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEG = 'web-server-integration';
const ASSET_ENV = 'KDNA_WEB_CLIENT_ASSET';
const DEFINITION = LEGS[LEG];
const DIGEST_INPUTS = Object.freeze([
  REGISTRY_PATH,
  REFERENCE_ASSET_REGISTRY,
  INTEGRATION_LEG_MODULE,
  'docs/current-core-read-binding.json',
  'package.json',
]);

function digestInputs() {
  return Object.fromEntries(DIGEST_INPUTS.map((relative) => [
    relative,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex'),
  ]));
}

function hardFail(message, evidence = []) {
  console.error(`${LEG} gate: ${message}`);
  for (const line of evidence) console.error(`${LEG} gate: ${line}`);
  console.error(`${LEG} gate: this condition is a failure, not a not_run receipt.`);
  process.exit(1);
}

function receipt(payload) {
  return `${RECEIPT_PREFIX} ${JSON.stringify(payload)}`;
}

let registry;
try {
  registry = loadLegRegistry(root);
} catch (error) {
  hardFail(`the committed CI leg registry is not usable (${REGISTRY_PATH}): ${error.message}`);
}

let assetRegistry;
try {
  assetRegistry = loadRegistry(root);
} catch (error) {
  hardFail(`cannot read the committed reference-asset registry (${REFERENCE_ASSET_REGISTRY}): ${error.message}`);
}

let binding;
try {
  binding = JSON.parse(fs.readFileSync(path.join(root, 'docs/current-core-read-binding.json'), 'utf8'));
} catch (error) {
  hardFail(`cannot read the committed dependency binding (docs/current-core-read-binding.json): ${error.message}`);
}

let coreVersion;
try {
  coreVersion = installedCoreVersion(root);
} catch (error) {
  hardFail(`cannot read the installed public Core identity: ${error.message}`);
}
const boundCoreVersion = binding?.packages?.find((entry) => entry?.name === '@aikdna/kdna-core')?.version ?? null;

const registration = registrationFor(registry, LEG);

const requested = process.env[ASSET_ENV];
if (typeof requested !== 'string' || requested.trim() === '') {
  console.error(
    `KDNA-CI-CONFIG-MISSING: ${LEG} missing=${ASSET_ENV} ` +
      '(the leg must name the published reference asset it exercises; the workflow sets it explicitly)',
  );
  process.exit(2);
}
const assetPath = path.isAbsolute(requested) ? requested : path.resolve(root, requested);
let bytes;
try {
  bytes = new Uint8Array(fs.readFileSync(assetPath));
} catch (error) {
  hardFail(`cannot read the supplied reference asset ${assetPath}: ${error.message}`);
}
if (bytes.byteLength === 0) hardFail(`the supplied reference asset ${assetPath} is empty`);
const assetSha256 = crypto.createHash('sha256').update(bytes).digest('hex');

const identity = matchRegisteredAsset(assetRegistry, {
  root,
  observedPath: requested,
  observedSha256: assetSha256,
  observedBytes: bytes.byteLength,
  coreVersion,
});
if (!identity.matched) {
  hardFail(
    'the observed asset does not match any registered public reference asset',
    [
      `observed path:              ${JSON.stringify(requested)}`,
      `observed sha256:            ${assetSha256}`,
      `observed byte length:       ${bytes.byteLength}`,
      `observed @aikdna/kdna-core: ${coreVersion}`,
      ...identity.reasons.map((reason) => `mismatch: ${reason}`),
      `registered (${REFERENCE_ASSET_REGISTRY}): ${assetRegistry.assets
        .map((entry) => `${entry.id} path=${entry.path} sha256=${entry.sha256} bytes=${entry.bytes} @aikdna/kdna-core=${entry.core_version}`)
        .join(' | ')}`,
    ],
  );
}
const registered = identity.entry;

let computed;
try {
  computed = await unavailabilityCodes({ root, bytes });
} catch (error) {
  hardFail(error.message);
}

const registeredCodes = registration?.unavailable_codes ?? [];
const canBeNotRun =
  Boolean(registration) &&
  !entryExpired(registration) &&
  sameCodeSet(computed.codes, registeredCodes);

if (canBeNotRun) {
  const receiptPayload = {
    leg: LEG,
    class: 'not_run',
    reason: registration.reason,
    object: DEFINITION.object,
    unavailable_codes: [...computed.codes].sort(),
    code_detail: computed.detail,
    command: [...DEFINITION.command],
    asset: requested,
    asset_sha256: assetSha256,
    asset_bytes: bytes.byteLength,
    core_package: '@aikdna/kdna-core',
    core_version: coreVersion,
    bound_core_version: boundCoreVersion,
    definition_digest: binding?.definition_digest ?? null,
    reference_asset_registry: REFERENCE_ASSET_REGISTRY,
    registered_asset: {
      id: registered.id,
      repository: registered.repository,
      ref: registered.ref,
      path: registered.path,
      sha256: registered.sha256,
      bytes: registered.bytes,
      core_version: registered.core_version,
      integration_script: registered.integration_script,
    },
    core_states: computed.admitted?.states ?? null,
    core_diagnostic_codes: Array.isArray(computed.admitted?.diagnostics)
      ? [...new Set(computed.admitted.diagnostics.map((entry) => entry?.code).filter((code) => typeof code === 'string'))]
      : [],
    inputs: digestInputs(),
  };
  console.log(
    `${NOT_RUN_PREFIX} ${LEG} reason=${registration.reason} object=${registration.object} ` +
      `asset=${registered.id} core=${coreVersion} unavailable=${[...computed.codes].sort().join(',')}`,
  );
  console.log(receipt(receiptPayload));
  process.exit(0);
}

if (registration && entryExpired(registration)) {
  hardFail(
    `the registration for ${LEG} expired on ${registration.review_by}; review it or the leg cannot be held at not_run`,
  );
}
if (!registration) {
  hardFail(
    `${LEG} is not registered in ${REGISTRY_PATH}, so it cannot be held at not_run ` +
      `(recomputed codes: ${computed.codes.join(', ') || 'none'})`,
  );
}

const [command, ...commandArgs] = DEFINITION.command;
const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', env: process.env });
if (result.error) hardFail(`the integration suite could not start (${result.error.message})`);
if (result.signal) hardFail(`the integration suite ended on signal ${result.signal}`);
console.log(receipt({
  leg: LEG,
  class: 'run',
  command: [command, ...commandArgs],
  status: result.status,
  unavailable_codes: [...computed.codes].sort(),
  asset: requested,
  asset_sha256: assetSha256,
  core_version: coreVersion,
  inputs: digestInputs(),
}));
process.exit(result.status ?? 1);
