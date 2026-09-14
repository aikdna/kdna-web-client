// Coordinates of the published public reference assets the CI reference-asset leg may
// treat as ground truth.
//
// The registry is a committed, reviewable file: it is what makes "the published asset was
// rejected by the current public Core" a falsifiable statement instead of a label any
// non-empty byte string can borrow. The leg compares four observed values against an
// entry here -- the path it was pointed at, the sha256 of the bytes it read, the byte
// length, and the version of the installed public Core -- and refuses to emit any receipt
// unless all four match. Keeping the expectation in one file means publishing a new
// reference asset touches the registry and nothing else.
import fs from 'node:fs';
import path from 'node:path';

export const REFERENCE_ASSET_REGISTRY = 'docs/reference-asset-registry.json';
export const REFERENCE_ASSET_REGISTRY_FORMAT = 'kdna.web-client-reference-assets/1';
export const REGISTRY_ENTRY_KEYS = Object.freeze([
  'bytes',
  'core_version',
  'id',
  'integration_script',
  'path',
  'ref',
  'repository',
  'sha256',
]);

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const PUBLIC_ASSET_PREFIX = 'public-assets/';

export function referenceAssetRegistryFile(root) {
  return path.join(root, REFERENCE_ASSET_REGISTRY);
}

function fail(message) {
  throw new Error(`reference asset registry: ${message}`);
}

/** Structural validation. Any drift from the declared shape is a defect, not a warning. */
export function assertRegistryShape(registry, file = REFERENCE_ASSET_REGISTRY) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    fail(`${file} must be a JSON object`);
  }
  if (registry.format !== REFERENCE_ASSET_REGISTRY_FORMAT) {
    fail(`${file} format must be ${REFERENCE_ASSET_REGISTRY_FORMAT}`);
  }
  if (typeof registry.purpose !== 'string' || registry.purpose.length < 32) {
    fail(`${file} must state its purpose in plain language`);
  }
  if (typeof registry.registry_scope !== 'string' || registry.registry_scope.length < 32) {
    fail(`${file} must state its scope in plain language`);
  }
  if (!Array.isArray(registry.assets) || registry.assets.length === 0) {
    fail(`${file} must register at least one published reference asset`);
  }
  const ids = new Set();
  const paths = new Set();
  for (const entry of registry.assets) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${file} entries must be JSON objects`);
    }
    const keys = Object.keys(entry).sort();
    if (keys.join(',') !== REGISTRY_ENTRY_KEYS.join(',')) {
      fail(`${file} entry keys must be exactly ${REGISTRY_ENTRY_KEYS.join(', ')}`);
    }
    for (const key of ['id', 'repository', 'ref', 'path', 'sha256', 'core_version', 'integration_script']) {
      if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
        fail(`${file} entry ${entry.id ?? '(missing id)'} must set a non-empty ${key}`);
      }
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes < 1) {
      fail(`${file} entry ${entry.id} must declare a positive integer byte length`);
    }
    if (!SHA256_HEX.test(entry.sha256)) {
      fail(`${file} entry ${entry.id} must declare a lowercase hex sha256`);
    }
    if (!entry.path.startsWith(PUBLIC_ASSET_PREFIX) || path.isAbsolute(entry.path)
      || entry.path.split('/').includes('..') || entry.path.includes('\\')) {
      fail(`${file} entry ${entry.id} must declare a repository-relative ${PUBLIC_ASSET_PREFIX} path`);
    }
    if (!/^[0-9a-f]{40}$/u.test(entry.ref)) {
      fail(`${file} entry ${entry.id} must pin a full immutable commit ref`);
    }
    if (ids.has(entry.id)) fail(`${file} registers ${entry.id} twice`);
    if (paths.has(entry.path)) fail(`${file} registers ${entry.path} twice`);
    ids.add(entry.id);
    paths.add(entry.path);
  }
  return registry.assets;
}

export function loadRegistry(root) {
  const file = referenceAssetRegistryFile(root);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot read ${REFERENCE_ASSET_REGISTRY}: ${error.message}`);
  }
  assertRegistryShape(parsed);
  return parsed;
}

/**
 * Lexical path comparison. The registry records the path form the CI leg is invoked with,
 * so an absolute invocation of that exact location is accepted and every other location
 * -- copy, rename, symlink under a different name, sibling directory -- is not. Symlinks
 * are deliberately not resolved: resolving them would let a differently named link pass
 * as the registered asset.
 */
export function isRegisteredAssetPath(root, observedPath, registeredPath) {
  if (typeof observedPath !== 'string' || observedPath.trim() === '') return false;
  if (path.normalize(observedPath) === path.normalize(registeredPath)) return true;
  return path.resolve(root, observedPath) === path.resolve(root, registeredPath);
}

/**
 * Compares the four observed values against the registry. Returns the matched entry plus
 * the exact mismatches, so the caller can report why an observation was refused instead
 * of printing a receipt that claims a reason it did not establish.
 */
export function matchRegisteredAsset(registry, observation) {
  const { root, observedPath, observedSha256, observedBytes, coreVersion } = observation;
  const entry = registry.assets
    .find((candidate) => isRegisteredAssetPath(root, observedPath, candidate.path));
  if (!entry) {
    return {
      matched: false,
      entry: null,
      reasons: [`no registered asset is published at ${JSON.stringify(observedPath)}`],
    };
  }
  const reasons = [];
  if (observedSha256 !== entry.sha256) {
    reasons.push(`sha256 ${observedSha256} != registered ${entry.sha256} for ${entry.id}`);
  }
  if (observedBytes !== entry.bytes) {
    reasons.push(`byte length ${observedBytes} != registered ${entry.bytes} for ${entry.id}`);
  }
  if (coreVersion !== entry.core_version) {
    reasons.push(`installed @aikdna/kdna-core ${coreVersion} != registered ${entry.core_version} for ${entry.id}`);
  }
  if (reasons.length > 0) return { matched: false, entry, reasons };
  return { matched: true, entry, reasons: [] };
}
