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
    this.maxSizeBytes = options.maxSizeBytes || null;
    this.actualSizeBytes = options.actualSizeBytes || null;
    this.code = options.code || 'KDNA_FILE_TOO_LARGE';
  }
}

export class KDNAUploadError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'KDNAUploadError';
    this.status = options.status || null;
    this.response = options.response || null;
    this.code = options.code || 'KDNA_UPLOAD_ERROR';
    this.cause = options.cause;
  }
}

export class KDNALoadError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'KDNALoadError';
    this.status = options.status || null;
    this.response = options.response || null;
    this.code = options.code || 'KDNA_LOAD_ERROR';
    this.cause = options.cause;
  }
}

const textDecoder = new TextDecoder();
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const KDNA_MIMETYPE = 'application/vnd.kdna.asset';

function uint16(view, offset) {
  return view.getUint16(offset, true);
}

function uint32(view, offset) {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view) {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (uint32(view, offset) === EOCD_SIGNATURE) return offset;
  }
  throw new KDNAFormatError('Not a KDNA ZIP container: missing end of central directory.', {
    code: 'KDNA_ZIP_EOCD_MISSING',
  });
}

function listZipEntries(buffer) {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = uint16(view, eocd + 10);
  let offset = uint32(view, eocd + 16);
  const entries = new Map();

  for (let index = 0; index < count; index += 1) {
    if (uint32(view, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new KDNAFormatError('Invalid KDNA ZIP central directory.', {
        code: 'KDNA_ZIP_CENTRAL_DIRECTORY_INVALID',
      });
    }

    const method = uint16(view, offset + 10);
    const compressedSize = uint32(view, offset + 20);
    const uncompressedSize = uint32(view, offset + 24);
    const nameLength = uint16(view, offset + 28);
    const extraLength = uint16(view, offset + 30);
    const commentLength = uint16(view, offset + 32);
    const localOffset = uint32(view, offset + 42);
    const name = textDecoder.decode(new Uint8Array(buffer, offset + 46, nameLength));

    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new KDNAFormatError('This environment cannot decompress deflated KDNA metadata.', {
      code: 'KDNA_DECOMPRESSION_UNAVAILABLE',
    });
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(buffer, entry) {
  const view = new DataView(buffer);
  if (uint32(view, entry.localOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new KDNAFormatError(`Invalid local ZIP header for ${entry.name}.`, {
      code: 'KDNA_ZIP_LOCAL_HEADER_INVALID',
    });
  }

  const nameLength = uint16(view, entry.localOffset + 26);
  const extraLength = uint16(view, entry.localOffset + 28);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(buffer, dataOffset, entry.compressedSize);

  if (entry.method === METHOD_STORE) return compressed;
  if (entry.method === METHOD_DEFLATE) return inflateRaw(compressed);

  throw new KDNAFormatError(`Unsupported ZIP compression method ${entry.method} for ${entry.name}.`, {
    code: 'KDNA_ZIP_METHOD_UNSUPPORTED',
  });
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

  if (options.maxSizeBytes != null && file.size > options.maxSizeBytes) {
    throw new KDNAFileSizeError(`KDNA file exceeds maxSizeBytes (${options.maxSizeBytes}).`, {
      maxSizeBytes: options.maxSizeBytes,
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
  const mimetype = textDecoder.decode(await readZipEntry(buffer, mimetypeEntry));
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
    const manifestBytes = await readZipEntry(buffer, manifestEntry);
    manifest = JSON.parse(textDecoder.decode(manifestBytes));
  } catch (error) {
    if (error instanceof KDNAFormatError) throw error;
    throw new KDNAFormatError('kdna.json is not valid JSON.', {
      code: 'KDNA_MANIFEST_INVALID',
      cause: error,
    });
  }

  return normalizeManifest(manifest, file, entries);
}

async function parseJsonResponse(response, ErrorClass) {
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new ErrorClass('Server returned invalid JSON.', {
        status: response.status,
        response,
        code: 'KDNA_RESPONSE_INVALID_JSON',
        cause: error,
      });
    }
  }

  if (!response.ok) {
    throw new ErrorClass(payload.error?.message || `KDNA request failed with HTTP ${response.status}.`, {
      status: response.status,
      response: payload,
      code: payload.error?.code,
    });
  }

  return payload;
}

export async function uploadKDNA(file, endpoint, options = {}) {
  const form = new FormData();
  form.set(options.fieldName || 'file', file, file.name || 'asset.kdna');

  const response = await (options.fetch || fetch)(endpoint, {
    method: 'POST',
    body: form,
    headers: options.headers,
  });
  const inspect = await parseJsonResponse(response, KDNAUploadError);
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
  }

  endpoint(path) {
    return `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
  }

  async post(path, body) {
    const response = await this.fetch(this.endpoint(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(body),
    });
    return parseJsonResponse(response, KDNALoadError);
  }

  async planLoad(fileId, context = {}) {
    const payload = await this.post('plan-load', { fileId, context });
    const plan = payload.plan || payload;
    return {
      canProceed: Boolean(payload.canProceed ?? plan.can_load_now),
      missing: payload.missing || (plan.can_load_now ? [] : [plan.required_action].filter(Boolean)),
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
      response: payload,
    };
  }

  async load(fileId, options = {}) {
    return this.post('load', { fileId, ...options });
  }
}

const JUDGMENT_TRACE_TYPE = 'kdna.judgment-trace';
const JUDGMENT_TRACE_CONTRACT_VERSION = '0.1.0';
const JUDGMENT_TRACE_FIELDS = [
  'type', 'contract_version', 'trace_id', 'plan_ref', 'parent_trace_id', 'timestamp',
  'overall_status', 'runtime_contract', 'asset_identity', 'digest_evidence',
  'capsule_delivery_evidence', 'projection_actual', 'host_receipt', 'execution',
  'budget', 'result_ref', 'errors', 'warnings',
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Fail closed on retired trace shapes at the browser boundary. This is a
 * structural discriminator check, not cryptographic or semantic conformance.
 */
export function validateJudgmentTrace(trace) {
  const errors = [];
  if (!isObject(trace)) return { valid: false, errors: ['trace must be an object'] };
  const allowed = new Set(JUDGMENT_TRACE_FIELDS);
  for (const field of JUDGMENT_TRACE_FIELDS) {
    if (!Object.hasOwn(trace, field)) errors.push(`${field} is required`);
  }
  for (const field of Object.keys(trace)) {
    if (!allowed.has(field)) errors.push(`${field} is not part of the current contract`);
  }
  if (trace.type !== JUDGMENT_TRACE_TYPE) errors.push(`type must be ${JUDGMENT_TRACE_TYPE}`);
  if (trace.contract_version !== JUDGMENT_TRACE_CONTRACT_VERSION) {
    errors.push(`contract_version must be ${JUDGMENT_TRACE_CONTRACT_VERSION}`);
  }
  if (!isObject(trace.execution)) errors.push('execution is required');
  else {
    for (const field of ['delivery_status', 'semantic_consumption', 'execution_status', 'conformance_status', 'model_identity']) {
      if (!Object.hasOwn(trace.execution, field)) errors.push(`execution.${field} is required`);
    }
    if (trace.execution.semantic_consumption?.state !== 'not_observed'
        || trace.execution.semantic_consumption?.basis !== null) {
      errors.push('semantic consumption must remain not_observed');
    }
    if (trace.execution.conformance_status !== 'not_evaluated') {
      errors.push('conformance status must remain not_evaluated');
    }
  }
  if (!isObject(trace.asset_identity) || typeof trace.asset_identity.asset_id !== 'string') {
    errors.push('asset_identity.asset_id is required');
  }
  if (!isObject(trace.plan_ref) || typeof trace.plan_ref.plan_digest !== 'string') {
    errors.push('plan_ref.plan_digest is required');
  }
  if (!isObject(trace.budget) || !isObject(trace.budget.actual) || !isObject(trace.budget.comparison)) {
    errors.push('budget evidence is required');
  }
  if (!isObject(trace.projection_actual)) errors.push('projection_actual is required');
  if (!Array.isArray(trace.errors) || !Array.isArray(trace.warnings)) {
    errors.push('errors and warnings must be arrays');
  }
  return { valid: errors.length === 0, errors };
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
