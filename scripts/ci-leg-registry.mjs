// Shared, committed definitions for the gated web-server-integration leg.
//
// The registry (fixtures/ci-leg-registry.json) is the only authority that may hold this
// leg at not_run. The gate (scripts/run-web-server-integration-gate.mjs) and the
// independent verifier (scripts/verify-ci-leg-receipts.mjs) both read these definitions;
// the verifier never trusts the gate's own view of them.
//
// A not_run outcome requires BOTH an explicit registration here AND the exact set of
// unavailability codes the gate recomputes from the committed bytes. The set is compared
// in both directions, so a code the gate computes but the registry does not name, or a
// registered code that is no longer true, makes the leg run instead. A gate cannot
// manufacture a permanent not_run out of a condition of its own.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const REGISTRY_PATH = 'fixtures/ci-leg-registry.json';
export const LEG_REGISTRY_FORMAT = 'kdna.ci-leg-registry/1';
export const INTEGRATION_LEG_MODULE = 'tests/web-server-integration.test.js';
export const CORE_PACKAGE = '@aikdna/kdna-core';

export const CODE_PUBLIC_CORE_REJECTS_ASSET = 'public_core_rejects_registered_reference_asset';
export const CODE_LEG_USES_NON_PUBLIC_ENTRY = 'integration_leg_uses_non_public_client_entry';

export const LEGS = Object.freeze({
  'web-server-integration': {
    object:
      "the pinned Web Server exercised with the published public reference asset through the package's own published client entry",
    requires: Object.freeze(['KDNA_WEB_CLIENT_ASSET']),
    command: Object.freeze(['npm', 'run', 'test:web-server-integration']),
  },
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

function fail(message) {
  throw new Error(`ci leg registry: ${message}`);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadLegRegistry(root) {
  let registry;
  try {
    registry = readJson(path.join(root, REGISTRY_PATH));
  } catch (error) {
    fail(`cannot read ${REGISTRY_PATH}: ${error.message}`);
  }
  if (registry?.format !== LEG_REGISTRY_FORMAT) {
    fail(`${REGISTRY_PATH} format must be ${LEG_REGISTRY_FORMAT}`);
  }
  if (typeof registry.purpose !== 'string' || registry.purpose.length < 64) {
    fail(`${REGISTRY_PATH} must state its purpose in plain language`);
  }
  if (!Array.isArray(registry.entries)) fail(`${REGISTRY_PATH} entries must be an array`);
  for (const entry of registry.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${REGISTRY_PATH} entries must be JSON objects`);
    }
    if (!Object.hasOwn(LEGS, entry.leg)) fail(`registration for unknown leg ${String(entry.leg)}`);
    if (entry.class !== 'not_run') fail(`entry ${entry.leg} class must be not_run`);
    if (typeof entry.reason !== 'string' || entry.reason.length < 16) {
      fail(`entry ${entry.leg} must state a reason`);
    }
    if (typeof entry.object !== 'string' || entry.object !== LEGS[entry.leg].object) {
      fail(`entry ${entry.leg} object must equal the leg definition's object`);
    }
    if (!Array.isArray(entry.unavailable_codes) || entry.unavailable_codes.length === 0) {
      fail(`entry ${entry.leg} must name the unavailability codes it registers`);
    }
    if (typeof entry.trigger !== 'string' || entry.trigger.length < 64) {
      fail(`entry ${entry.leg} must state the trigger that removes the registration`);
    }
    if (typeof entry.owner !== 'string' || entry.owner.trim() === '') {
      fail(`entry ${entry.leg} must name an owner`);
    }
    if (!DATE_RE.test(entry.review_by ?? '')) {
      fail(`entry ${entry.leg} must carry a review_by expiry date`);
    }
  }
  const legs = registry.entries.map((entry) => entry.leg);
  if (new Set(legs).size !== legs.length) fail(`${REGISTRY_PATH} registers a leg twice`);
  return registry;
}

export function registrationFor(registry, leg) {
  return (registry.entries ?? []).find((entry) => entry.leg === leg);
}

export function entryExpired(registration, today = new Date().toISOString().slice(0, 10)) {
  return Boolean(registration) && registration.review_by < today;
}

/** The installed public Core's version, read from the installed package itself. */
export function installedCoreVersion(root) {
  const require = createRequire(path.join(root, 'package.json'));
  return require(`${CORE_PACKAGE}/package.json`).version;
}

/**
 * Code 1: the current public Core refuses to admit the supplied bytes. The verdict comes
 * from the package's own published client entry, which is the admission this repository's
 * README describes for consumers.
 */
export async function coreAdmission(root, bytes) {
  const require = createRequire(path.join(root, 'package.json'));
  const { selectKDNA } = require(path.join(root, 'src', 'client.cjs'));
  return selectKDNA(bytes);
}

/**
 * Code 2: the committed integration leg drives a module the package does not publish.
 * The leg's own import specifiers are resolved against package.json#exports, so the
 * registration cannot say "the asset is the only thing in the way" while the leg also
 * exercises a retired internal entry.
 */
export function integrationLegNonPublicEntries(root) {
  const source = fs.readFileSync(path.join(root, INTEGRATION_LEG_MODULE), 'utf8');
  const published = new Set();
  const collect = (value) => {
    if (typeof value === 'string') published.add(path.posix.normalize(value.replace(/^\.\//u, '')));
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(readJson(path.join(root, 'package.json')).exports ?? {});
  const relative = [...source.matchAll(/(?:from|import)\s+'(\.[^']*)'/gu)].map((match) => match[1]);
  const used = relative
    .map((specifier) => path.posix.normalize(
      path.posix.join(path.posix.dirname(INTEGRATION_LEG_MODULE), specifier),
    ))
    .sort();
  return [...new Set(used)].filter((module) => !published.has(module));
}

/**
 * Recompute, from the committed bytes alone, the unavailability codes of one leg. An
 * empty result means the leg must run.
 */
export async function unavailabilityCodes({ root, bytes }) {
  const codes = [];
  const detail = {};
  const nonPublic = integrationLegNonPublicEntries(root);
  if (nonPublic.length > 0) {
    codes.push(CODE_LEG_USES_NON_PUBLIC_ENTRY);
    detail[CODE_LEG_USES_NON_PUBLIC_ENTRY] = nonPublic;
  }
  if (bytes && bytes.byteLength > 0) {
    const admitted = await coreAdmission(root, bytes);
    if (admitted?.status === 'rejected') {
      codes.push(CODE_PUBLIC_CORE_REJECTS_ASSET);
      detail[CODE_PUBLIC_CORE_REJECTS_ASSET] = admitted.code ?? 'UNKNOWN_REJECTION';
      return { codes: codes.sort(), detail, admitted };
    }
    if (admitted?.status !== 'selected') {
      fail(`the public client returned an unreadable admission verdict: ${JSON.stringify(admitted)}`);
    }
    return { codes: codes.sort(), detail, admitted };
  }
  return { codes: codes.sort(), detail, admitted: null };
}

export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function sameCodeSet(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((code, index) => code === b[index]);
}
