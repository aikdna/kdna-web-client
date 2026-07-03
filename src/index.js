export class KDNAFormatError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'KDNAFormatError';
    this.code = options.code || 'KDNA_FORMAT_ERROR';
    this.cause = options.cause;
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

export async function readKDNAMetadata(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new KDNAFormatError('readKDNAMetadata requires a File or Blob.', {
      code: 'KDNA_FILE_REQUIRED',
    });
  }

  const buffer = await file.arrayBuffer();
  const entries = listZipEntries(buffer);
  const manifestEntry = entries.get('kdna.json');
  if (!manifestEntry) {
    throw new KDNAFormatError('KDNA container is missing kdna.json.', {
      code: 'KDNA_MANIFEST_MISSING',
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
