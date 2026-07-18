import {
  KDNA_ASSET_ID_PATTERN,
  KDNA_SCHEMA_AUTHORITY,
  validateJudgmentTrace as validateCanonicalJudgmentTrace,
  validateRuntimeCapsule as validateCanonicalRuntimeCapsule,
} from './generated/runtime-validators.js';

export { KDNA_SCHEMA_AUTHORITY };

export class KDNAFormatError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'KDNAFormatError';
    this.code = options.code || 'KDNA_FORMAT_ERROR';
    this.cause = options.cause;
  }
}

export class KDNAFileSizeError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'KDNAFileSizeError';
    this.maxSizeBytes = options.maxSizeBytes ?? null;
    this.actualSizeBytes = options.actualSizeBytes ?? null;
    this.code = options.code || 'KDNA_FILE_TOO_LARGE';
  }
}

export class KDNAUploadError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'KDNAUploadError';
    this.status = options.status ?? null;
    // Kept as a null compatibility field. Upstream bodies are never attached
    // to public errors because they can contain paths, credentials, or provider details.
    this.response = null;
    this.code = options.code || 'KDNA_UPLOAD_ERROR';
  }
}

export class KDNALoadError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'KDNALoadError';
    this.status = options.status ?? null;
    // See KDNAUploadError.response.
    this.response = null;
    this.code = options.code || 'KDNA_LOAD_ERROR';
  }
}

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const KDNA_MIMETYPE = 'application/vnd.kdna.asset';
const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_MANIFEST_SIZE_BYTES = 1024 * 1024;
const MAX_ZIP_ENTRIES = 128;
const MAX_RESPONSE_SIZE_BYTES = 64 * 1024;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SAFE_FILE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const ASSET_ID = new RegExp(KDNA_ASSET_ID_PATTERN, 'u');
const NATURAL_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const LOAD_STATES = new Set([
  'ready', 'needs_password', 'needs_license', 'needs_account', 'needs_org_auth',
  'needs_runtime', 'offline_grace', 'expired', 'expired_grace', 'revoked',
  'denied', 'invalid',
]);
const LOAD_ACTIONS = new Set([
  'none', 'load', 'enter_password', 'install_receipt', 'sign_in_or_activate',
  'sync', 'connect_runtime', 'migrate_legacy', 'renew_entitlement',
  'contact_issuer', 'block',
]);
const LOAD_CHECKS = new Set([
  'format_valid', 'schema_valid', 'payload_valid', 'checksums_valid',
  'load_contract_valid', 'overall_valid',
]);
const PROFILES = new Set(['index', 'compact', 'scenario', 'full']);
const ACCESS_MODES = new Set(['public', 'licensed', 'remote']);
const PROJECTION_POLICIES = new Set(['minimal', 'remote', 'none']);

function uint16(view, offset) {
  return view.getUint16(offset, true);
}

function uint32(view, offset) {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view) {
  const minimumOffset = Math.max(0, view.byteLength - 22 - 65_535);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (
      uint32(view, offset) === EOCD_SIGNATURE
      && offset + 22 + uint16(view, offset + 20) === view.byteLength
    ) return offset;
  }
  throw new KDNAFormatError('Not a KDNA ZIP container: missing end of central directory.', {
    code: 'KDNA_ZIP_EOCD_MISSING',
  });
}

function listZipEntries(buffer) {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const diskNumber = uint16(view, eocd + 4);
  const centralDisk = uint16(view, eocd + 6);
  const diskCount = uint16(view, eocd + 8);
  const count = uint16(view, eocd + 10);
  const centralSize = uint32(view, eocd + 12);
  const centralOffset = uint32(view, eocd + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || diskCount !== count) {
    throw new KDNAFormatError('Multi-disk KDNA ZIP containers are not supported.', {
      code: 'KDNA_ZIP_MULTIDISK_UNSUPPORTED',
    });
  }
  if (count === 0 || count > MAX_ZIP_ENTRIES) {
    throw new KDNAFormatError(`KDNA ZIP entry count must be between 1 and ${MAX_ZIP_ENTRIES}.`, {
      code: 'KDNA_ZIP_ENTRY_COUNT_INVALID',
    });
  }
  if (centralOffset + centralSize !== eocd) {
    throw new KDNAFormatError('Invalid KDNA ZIP central directory bounds.', {
      code: 'KDNA_ZIP_CENTRAL_DIRECTORY_INVALID',
    });
  }

  let offset = centralOffset;
  const entries = new Map();

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > eocd) {
      throw new KDNAFormatError('Truncated KDNA ZIP central directory.', {
        code: 'KDNA_ZIP_CENTRAL_DIRECTORY_INVALID',
      });
    }
    if (uint32(view, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new KDNAFormatError('Invalid KDNA ZIP central directory.', {
        code: 'KDNA_ZIP_CENTRAL_DIRECTORY_INVALID',
      });
    }

    const flags = uint16(view, offset + 8);
    const method = uint16(view, offset + 10);
    const compressedSize = uint32(view, offset + 20);
    const uncompressedSize = uint32(view, offset + 24);
    const nameLength = uint16(view, offset + 28);
    const extraLength = uint16(view, offset + 30);
    const commentLength = uint16(view, offset + 32);
    const localOffset = uint32(view, offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > eocd || nameLength === 0) {
      throw new KDNAFormatError('Invalid KDNA ZIP entry bounds.', {
        code: 'KDNA_ZIP_CENTRAL_DIRECTORY_INVALID',
      });
    }
    if ((flags & 0x1) !== 0) {
      throw new KDNAFormatError('Encrypted ZIP entries are not valid KDNA public metadata.', {
        code: 'KDNA_ZIP_ENTRY_ENCRYPTED',
      });
    }
    let name;
    try {
      name = textDecoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    } catch {
      throw new KDNAFormatError('KDNA ZIP entry names must be valid UTF-8.', {
        code: 'KDNA_ZIP_ENTRY_NAME_INVALID',
      });
    }
    if (entries.has(name)) {
      throw new KDNAFormatError(`Duplicate KDNA ZIP entry: ${name}.`, {
        code: 'KDNA_ZIP_ENTRY_DUPLICATE',
      });
    }

    entries.set(name, {
      name, flags, method, compressedSize, uncompressedSize, localOffset,
    });
    offset = nextOffset;
  }

  if (offset !== eocd) {
    throw new KDNAFormatError('Invalid trailing data in KDNA ZIP central directory.', {
      code: 'KDNA_ZIP_CENTRAL_DIRECTORY_INVALID',
    });
  }

  return entries;
}

async function readBoundedStream(stream, maxSizeBytes) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new TypeError('Stream returned a non-byte chunk.');
      }
      size += value.byteLength;
      if (size > maxSizeBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size decision is authoritative even if stream cancellation fails.
        }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function inflateRaw(bytes, maxSizeBytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new KDNAFormatError('This environment cannot decompress deflated KDNA metadata.', {
      code: 'KDNA_DECOMPRESSION_UNAVAILABLE',
    });
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const inflated = await readBoundedStream(stream, maxSizeBytes);
  if (!inflated) {
    throw new KDNAFormatError('KDNA metadata exceeds the manifest size limit.', {
      code: 'KDNA_MANIFEST_TOO_LARGE',
    });
  }
  return inflated;
}

async function readZipEntry(buffer, entry, maxSizeBytes) {
  const view = new DataView(buffer);
  if (entry.localOffset + 30 > view.byteLength) {
    throw new KDNAFormatError(`Invalid local ZIP header for ${entry.name}.`, {
      code: 'KDNA_ZIP_LOCAL_HEADER_INVALID',
    });
  }
  if (uint32(view, entry.localOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new KDNAFormatError(`Invalid local ZIP header for ${entry.name}.`, {
      code: 'KDNA_ZIP_LOCAL_HEADER_INVALID',
    });
  }

  const flags = uint16(view, entry.localOffset + 6);
  const method = uint16(view, entry.localOffset + 8);
  const nameLength = uint16(view, entry.localOffset + 26);
  const extraLength = uint16(view, entry.localOffset + 28);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > view.byteLength || flags !== entry.flags || method !== entry.method) {
    throw new KDNAFormatError(`Invalid local ZIP header for ${entry.name}.`, {
      code: 'KDNA_ZIP_LOCAL_HEADER_INVALID',
    });
  }
  let localName;
  try {
    localName = textDecoder.decode(new Uint8Array(buffer, entry.localOffset + 30, nameLength));
  } catch {
    localName = null;
  }
  if (localName !== entry.name) {
    throw new KDNAFormatError(`Local ZIP entry name mismatch for ${entry.name}.`, {
      code: 'KDNA_ZIP_LOCAL_HEADER_INVALID',
    });
  }
  if (entry.uncompressedSize > maxSizeBytes) {
    throw new KDNAFormatError('KDNA metadata exceeds the manifest size limit.', {
      code: 'KDNA_MANIFEST_TOO_LARGE',
    });
  }
  const compressed = new Uint8Array(buffer, dataOffset, entry.compressedSize);

  let output;
  if (entry.method === METHOD_STORE) output = compressed;
  else if (entry.method === METHOD_DEFLATE) {
    try {
      output = await inflateRaw(compressed, maxSizeBytes);
    } catch (error) {
      if (error instanceof KDNAFormatError) throw error;
      throw new KDNAFormatError(`Invalid deflated ZIP entry for ${entry.name}.`, {
        code: 'KDNA_ZIP_DEFLATE_INVALID',
      });
    }
  }
  else {
    throw new KDNAFormatError(`Unsupported ZIP compression method ${entry.method} for ${entry.name}.`, {
      code: 'KDNA_ZIP_METHOD_UNSUPPORTED',
    });
  }

  if (output.byteLength !== entry.uncompressedSize) {
    throw new KDNAFormatError(`ZIP entry size mismatch for ${entry.name}.`, {
      code: 'KDNA_ZIP_ENTRY_SIZE_INVALID',
    });
  }
  return output;
}

function normalizeManifest(manifest, file, entries) {
  const loadProfiles = manifest.load_contract?.profiles
    ? Object.keys(manifest.load_contract.profiles)
    : [];

  return {
    domain: manifest.asset_id || manifest.name || null,
    version: manifest.version || null,
    title: manifest.title || manifest.name || null,
    description: manifest.description || manifest.summary || null,
    encrypted: Boolean(manifest.payload?.encrypted || manifest.encryption?.encrypted_entries?.includes('payload.kdnab')),
    profiles: loadProfiles,
    fileSize: file.size,
    manifest,
    entries: [...entries.keys()],
  };
}

export async function readKDNAMetadata(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new KDNAFormatError('readKDNAMetadata requires a File or Blob.', {
      code: 'KDNA_FILE_REQUIRED',
    });
  }

  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  if (!Number.isSafeInteger(maxSizeBytes) || maxSizeBytes <= 0) {
    throw new KDNAFormatError('maxSizeBytes must be a positive safe integer.', {
      code: 'KDNA_MAX_SIZE_INVALID',
    });
  }
  if (file.size > maxSizeBytes) {
    throw new KDNAFileSizeError(`KDNA file exceeds maxSizeBytes (${maxSizeBytes}).`, {
      maxSizeBytes,
      actualSizeBytes: file.size,
    });
  }

  const buffer = await file.arrayBuffer();
  const entries = listZipEntries(buffer);
  if (entries.keys().next().value !== 'mimetype') {
    throw new KDNAFormatError('KDNA container must store mimetype as its first entry.', {
      code: 'KDNA_MIMETYPE_NOT_FIRST',
    });
  }
  const mimetypeEntry = entries.get('mimetype');
  if (!mimetypeEntry) {
    throw new KDNAFormatError('KDNA container is missing mimetype.', {
      code: 'KDNA_MIMETYPE_MISSING',
    });
  }

  if (mimetypeEntry.method !== METHOD_STORE) {
    throw new KDNAFormatError('KDNA mimetype entry must be stored without compression.', {
      code: 'KDNA_MIMETYPE_COMPRESSED',
    });
  }
  const mimetype = textDecoder.decode(await readZipEntry(buffer, mimetypeEntry, 64));
  if (mimetype !== KDNA_MIMETYPE) {
    throw new KDNAFormatError(`Unsupported KDNA mimetype: ${mimetype || '(empty)'}.`, {
      code: 'KDNA_MIMETYPE_INVALID',
    });
  }

  const manifestEntry = entries.get('kdna.json');
  if (!manifestEntry) {
    throw new KDNAFormatError('KDNA container is missing kdna.json.', {
      code: 'KDNA_MANIFEST_MISSING',
    });
  }
  if (!entries.has('payload.kdnab')) {
    throw new KDNAFormatError('KDNA container is missing payload.kdnab.', {
      code: 'KDNA_PAYLOAD_MISSING',
    });
  }

  let manifest;
  try {
    const manifestBytes = await readZipEntry(buffer, manifestEntry, MAX_MANIFEST_SIZE_BYTES);
    manifest = JSON.parse(textDecoder.decode(manifestBytes));
  } catch (error) {
    if (error instanceof KDNAFormatError) throw error;
    throw new KDNAFormatError('kdna.json is not valid JSON.', {
      code: 'KDNA_MANIFEST_INVALID',
      cause: error,
    });
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new KDNAFormatError('kdna.json must contain a JSON object.', {
      code: 'KDNA_MANIFEST_INVALID',
    });
  }

  return normalizeManifest(manifest, file, entries);
}

function safeServerCode(payload, fallbackCode) {
  const code = payload?.error?.code;
  return typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : fallbackCode;
}

function safeText(value, maxLength = 4096) {
  return typeof value === 'string'
    && value.length <= maxLength
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    ? value
    : null;
}

function enumValue(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

async function boundedResponseText(response, ErrorClass) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_SIZE_BYTES) {
    throw new ErrorClass('KDNA server response exceeded the client limit.', {
      status: response.status,
      code: 'KDNA_RESPONSE_TOO_LARGE',
    });
  }

  let bytes;
  try {
    if (response.body && typeof response.body.getReader === 'function') {
      bytes = await readBoundedStream(response.body, MAX_RESPONSE_SIZE_BYTES);
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_RESPONSE_SIZE_BYTES) bytes = null;
    }
  } catch {
    throw new ErrorClass('KDNA server response could not be read.', {
      status: response.status,
      code: 'KDNA_RESPONSE_READ_FAILED',
    });
  }
  if (!bytes) {
    throw new ErrorClass('KDNA server response exceeded the client limit.', {
      status: response.status,
      code: 'KDNA_RESPONSE_TOO_LARGE',
    });
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw new ErrorClass('KDNA server response was not valid UTF-8.', {
      status: response.status,
      code: 'KDNA_RESPONSE_INVALID_UTF8',
    });
  }
}

async function parseJsonResponse(response, ErrorClass, fallbackCode) {
  const text = await boundedResponseText(response, ErrorClass);
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ErrorClass('KDNA server returned invalid JSON.', {
        status: response.status,
        code: 'KDNA_RESPONSE_INVALID_JSON',
      });
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ErrorClass('KDNA server returned an invalid response shape.', {
      status: response.status,
      code: 'KDNA_RESPONSE_INVALID_SHAPE',
    });
  }

  if (!response.ok) {
    throw new ErrorClass(`KDNA request failed with HTTP ${response.status}.`, {
      status: response.status,
      code: safeServerCode(payload, fallbackCode),
    });
  }

  return payload;
}

async function requestJson(fetcher, input, init, ErrorClass, fallbackCode) {
  let response;
  try {
    response = await fetcher(input, init);
  } catch {
    throw new ErrorClass('KDNA server request failed.', {
      code: 'KDNA_NETWORK_ERROR',
    });
  }
  return parseJsonResponse(response, ErrorClass, fallbackCode);
}

function publicLoadPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return {};
  const checks = plan.checks && typeof plan.checks === 'object' && !Array.isArray(plan.checks)
    ? Object.fromEntries(
        Object.entries(plan.checks)
          .filter(([key, value]) => LOAD_CHECKS.has(key) && typeof value === 'boolean'),
      )
    : {};
  return {
    format_version: plan.format_version === '0.1.0' ? plan.format_version : null,
    asset: plan.asset && typeof plan.asset === 'object' && !Array.isArray(plan.asset)
      ? {
          asset_id: ASSET_ID.test(plan.asset.asset_id) ? plan.asset.asset_id : null,
          asset_uid: safeText(plan.asset.asset_uid, 256),
          title: safeText(plan.asset.title),
          version: NATURAL_SEMVER.test(plan.asset.version) ? plan.asset.version : null,
          judgment_version: NATURAL_SEMVER.test(plan.asset.judgment_version)
            ? plan.asset.judgment_version : null,
        }
      : null,
    access: enumValue(plan.access, ACCESS_MODES),
    state: enumValue(plan.state, LOAD_STATES),
    required_action: enumValue(plan.required_action, LOAD_ACTIONS),
    can_load_now: Boolean(plan.can_load_now),
    projection_policy: enumValue(plan.projection_policy, PROJECTION_POLICIES),
    checks,
  };
}

function publicInspect(payload) {
  const loadPlan = publicLoadPlan(payload.loadPlan);
  return {
    fileId: SAFE_FILE_ID.test(payload.fileId) ? payload.fileId : null,
    domain: ASSET_ID.test(payload.domain) ? payload.domain : null,
    version: NATURAL_SEMVER.test(payload.version) ? payload.version : null,
    title: safeText(payload.title),
    description: safeText(payload.description),
    encrypted: Boolean(payload.encrypted),
    defaultProfile: enumValue(payload.defaultProfile, PROFILES),
    ...(Array.isArray(payload.profiles)
      ? { profiles: payload.profiles.filter((profile) => PROFILES.has(profile)) }
      : {}),
    loadPlan,
  };
}

export async function uploadKDNA(file, endpoint, options = {}) {
  const form = new FormData();
  form.set(options.fieldName || 'file', file, file.name || 'asset.kdna');

  const payload = await requestJson(options.fetch || fetch, endpoint, {
    method: 'POST',
    body: form,
    headers: options.headers,
    signal: options.signal,
  }, KDNAUploadError, 'KDNA_UPLOAD_ERROR');
  const inspect = publicInspect(payload);
  if (!inspect.fileId) {
    throw new KDNAUploadError('KDNA server returned an invalid inspect response.', {
      code: 'KDNA_INSPECT_RESPONSE_INVALID',
    });
  }
  return {
    fileId: inspect.fileId,
    inspect,
  };
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

export class KDNALoadPlanManager {
  constructor(baseUrl, options = {}) {
    this.baseUrl = trimSlash(baseUrl);
    this.fetch = options.fetch || fetch;
    this.headers = options.headers || {};
    this.signal = options.signal;
  }

  endpoint(path) {
    return `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
  }

  async post(path, body) {
    return requestJson(this.fetch, this.endpoint(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(body),
      signal: this.signal,
    }, KDNALoadError, 'KDNA_LOAD_ERROR');
  }

  async planLoad(fileId, context = {}) {
    const payload = await this.post('plan-load', { fileId, context });
    const plan = publicLoadPlan(payload.plan || payload);
    const canProceed = Boolean(payload.canProceed ?? plan.can_load_now);
    const missing = Array.isArray(payload.missing)
      ? payload.missing.filter((value) => LOAD_ACTIONS.has(value))
      : (canProceed ? [] : [plan.required_action].filter(Boolean));
    return {
      canProceed,
      missing,
      requirements: {
        password: {
          required: plan.required_action === 'enter_password' || plan.state === 'needs_password',
          hint: plan.password_hint || null,
        },
        licenseKey: {
          required: plan.required_action === 'install_receipt' || plan.state === 'needs_license',
        },
      },
      plan,
    };
  }

  async load(fileId, options = {}) {
    const payload = await this.post('load', { fileId, ...options });
    if (!validateCanonicalRuntimeCapsule(payload.capsule)) {
      throw new KDNALoadError('KDNA server returned an invalid Runtime Capsule.', {
        code: 'KDNA_RUNTIME_CAPSULE_INVALID',
      });
    }
    const capsule = payload.capsule;
    return {
      domain: capsule.asset.asset_id,
      version: capsule.asset.version,
      judgmentVersion: capsule.asset.judgment_version,
      profile: capsule.profile,
      content: capsule.context,
      capsule,
    };
  }
}

function canonicalValidationErrors(validator) {
  return (validator.errors ?? []).map((issue) => (
    `${issue.instancePath || '/'} ${issue.message || issue.keyword}`
  ));
}

/**
 * Fail closed on any trace that does not satisfy the exact Core schema closure
 * pinned by KDNA_SCHEMA_AUTHORITY. This verifies shape, not cryptographic or
 * semantic conformance.
 */
export function validateJudgmentTrace(trace) {
  const valid = validateCanonicalJudgmentTrace(trace);
  return {
    valid,
    errors: valid ? [] : canonicalValidationErrors(validateCanonicalJudgmentTrace),
  };
}

export function parseJudgmentTrace(json) {
  const trace = JSON.parse(json);
  const validation = validateJudgmentTrace(trace);
  if (!validation.valid) {
    throw new KDNAFormatError(`Invalid JudgmentTrace: ${validation.errors.join('; ')}`, {
      code: 'KDNA_JUDGMENT_TRACE_INVALID',
    });
  }
  return trace;
}

export function judgmentTraceView(trace) {
  const validation = validateJudgmentTrace(trace);
  if (!validation.valid) {
    throw new KDNAFormatError(`Invalid JudgmentTrace: ${validation.errors.join('; ')}`, {
      code: 'KDNA_JUDGMENT_TRACE_INVALID',
    });
  }
  return {
    traceId: trace.trace_id,
    status: trace.overall_status,
    primary: trace.asset_identity.asset_id,
    assetVersion: trace.asset_identity.version,
    deliveryStatus: trace.execution.delivery_status,
    executionStatus: trace.execution.execution_status,
    semanticConsumption: trace.execution.semantic_consumption.state,
    conformanceStatus: trace.execution.conformance_status,
    modelIdentity: trace.execution.model_identity?.value ?? null,
    modelIdentityBasis: trace.execution.model_identity?.basis ?? 'not_observed',
    tokensUsed: trace.budget.actual.tokens_used,
    usageBasis: trace.budget.actual.usage_basis,
    budgetStatus: trace.budget.comparison.overall,
    projectionProfile: trace.projection_actual.profile,
    planDigest: trace.plan_ref.plan_digest,
    capsuleDeliveryDigest: trace.projection_actual.capsule_delivery_digest,
    resultDigest: trace.result_ref?.result_digest ?? null,
    resultStored: trace.result_ref?.stored ?? false,
    errors: trace.errors,
    warnings: trace.warnings,
  };
}

/** Dependency-free DOM renderer for a trusted application endpoint's trace. */
export class JudgmentTraceViewer {
  constructor(container) {
    if (!container || typeof container.replaceChildren !== 'function') {
      throw new TypeError('JudgmentTraceViewer requires a DOM container.');
    }
    this.container = container;
  }

  render(trace) {
    const view = judgmentTraceView(trace);
    const document = this.container.ownerDocument;
    const section = document.createElement('section');
    section.className = 'kdna-judgment-trace';
    const heading = document.createElement('h3');
    heading.textContent = `Trace: ${view.traceId}`;
    section.append(heading);
    for (const [label, value] of [
      ['Primary', `${view.primary} ${view.assetVersion}`.trim()],
      ['Delivery', view.deliveryStatus],
      ['Execution', view.executionStatus],
      ['Semantic consumption', view.semanticConsumption],
      ['Conformance', view.conformanceStatus],
      ['Budget', view.budgetStatus],
    ]) {
      const row = document.createElement('p');
      row.textContent = `${label}: ${value}`;
      section.append(row);
    }
    this.container.replaceChildren(section);
    return view;
  }

  clear() {
    this.container.replaceChildren();
  }
}
