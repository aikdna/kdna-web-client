'use strict';
const { admitBrowser } = require('@aikdna/kdna-core/browser');
const { admitReadTransportResponse } = require('@aikdna/kdna-read/transport');
const { getComponentSemanticsContract } = require('@aikdna/kdna-core/components');
if (require('@aikdna/kdna-core/package.json').version !== '0.24.0-rc.component-semantics.2'
  || require('@aikdna/kdna-read/package.json').version !== '0.3.0-rc.component-semantics.2'
  || getComponentSemanticsContract().definition_digest !== 'sha256:3087cd19542e72322aec19b3015c916d2cfb074fa42e3fd76b3756bb4f097de3') {
  throw new Error('CLIENT_CURRENT_PUBLIC_GRAPH_REQUIRED');
}


const selections = new WeakMap();
const MAX_FILE_BYTES = 10 * 1024 * 1024;
function discard(response) {
  try { if (response.body && !response.body.locked) Promise.resolve(response.body.cancel()).catch(() => {}); } catch {}
}
const failure = code => Object.freeze({ status: 'failed', code, admission: null, view: null });
function limit(value, fallback, ceiling) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > ceiling) throw new TypeError('CLIENT_LIMIT_INVALID');
  return n;
}

/** Explicit local selection, admitted only by the public browser Core. */
async function selectKDNA(input, options = {}) {
  const maxBytes = limit(options.maxFileBytes, MAX_FILE_BYTES, MAX_FILE_BYTES);
  let bytes, name = null;
  try {
    if (input instanceof ArrayBuffer) {
      if (input.byteLength > maxBytes) return Object.freeze({ status: 'rejected', code: 'CLIENT_FILE_TOO_LARGE', selection: null });
      bytes = new Uint8Array(input.slice(0));
    } else if (input instanceof Uint8Array) {
      if (input.byteLength > maxBytes) return Object.freeze({ status: 'rejected', code: 'CLIENT_FILE_TOO_LARGE', selection: null });
      bytes = new Uint8Array(input);
    } else if (typeof Blob === 'function' && input instanceof Blob) {
      const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(input);
      if (size > maxBytes) return Object.freeze({ status: 'rejected', code: 'CLIENT_FILE_TOO_LARGE', selection: null });
      bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(input));
      if (typeof File === 'function' && input instanceof File) name = Object.getOwnPropertyDescriptor(File.prototype, 'name').get.call(input);
    } else return Object.freeze({ status: 'rejected', code: 'CLIENT_FILE_REQUIRED', selection: null });
  } catch { return Object.freeze({ status: 'rejected', code: 'CLIENT_FILE_UNREADABLE', selection: null }); }
  if (bytes.byteLength > maxBytes) return Object.freeze({ status: 'rejected', code: 'CLIENT_FILE_TOO_LARGE', selection: null });
  const admitted = admitBrowser(bytes);
  if (admitted.status !== 'accepted') return Object.freeze({ status: 'rejected', code: admitted.reason, selection: null,
    states: admitted.states, diagnostics: admitted.diagnostics, component_failure: admitted.component_failure });
  const snapshot = admitted.snapshot;
  const selection = Object.freeze({ kind: 'kdna.web-client-selection/1', byteLength: bytes.byteLength,
    fileName: name, asset: snapshot.asset, tuple: snapshot.tuple, digests: snapshot.digests });
  selections.set(selection, { bytes, released: false, active: new Set() });
  return Object.freeze({ status: 'selected', selection, code: null });
}

/** Release owned file bytes; this does not grant, revoke or manufacture authority. */
function releaseKDNASelection(selection) {
  const record = selections.get(selection);
  if (record) {
    record.released = true; record.bytes = null;
    for (const cancel of record.active) cancel();
    record.active.clear(); selections.delete(selection);
  }
}

/** A remote display model is a view of the official transport admission result. */
function view(admission) {
  return Object.freeze({ kind: 'remote_read', origin: admission.origin,
    association: admission.association, response: admission.response,
    proof_scope: admission.proof_scope, proof_limits: admission.proof_limits,
    capabilities: admission.capabilities });
}

function createKDNAWebClient(options) {
  if (!options || typeof options.endpointUrl !== 'string') throw new TypeError('CLIENT_ENDPOINT_REQUIRED');
  const endpoint = new URL(options.endpointUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash
    || endpoint.href !== options.endpointUrl) throw new TypeError('CLIENT_ENDPOINT_INVALID');
  for (const key of ['endpointId', 'sessionId']) {
    if (typeof options[key] !== 'string' || options[key].length < 1 || options[key].length > 256) throw new TypeError('CLIENT_SESSION_REQUIRED');
  }
  const endpointId = options.endpointId, sessionId = options.sessionId;
  const timeoutMs = limit(options.timeoutMs, 5000, 30000);
  const maxConcurrentRequests = limit(options.maxConcurrentRequests, 4, 32);
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new TypeError('CLIENT_FETCH_REQUIRED');
  const active = new Set();
  let disposed = false;

  return Object.freeze({
    /** Context is the application's explicit public Read transport binding. */
    async read(selection, context, settings = {}) {
      if (disposed) return failure('CLIENT_DISPOSED');
      if (active.size >= maxConcurrentRequests) return failure('CLIENT_BUSY');
      const source = selections.get(selection);
      if (!source || source.released) return failure('CLIENT_SELECTION_INVALID');
      let binding;
      try { binding = structuredClone(context); } catch { return failure('CLIENT_CONTEXT_INVALID'); }
      if (!binding || binding.endpoint_url !== endpoint.href || binding.endpoint_id !== endpointId || binding.session_id !== sessionId) {
        return failure('CLIENT_CONTEXT_MISMATCH');
      }
      // Compare already admitted identity fields; the public receiver owns all schema and semantic validation.
      if (!['asset', 'tuple'].every(key => binding['expected_' + key]
        && Object.keys(selection[key]).every(field => binding['expected_' + key][field] === selection[key][field]))
        || !binding.expected_digests || !['A', 'C', 'E'].every(key => binding.expected_digests[key] === selection.digests[key].observed)) {
        return failure('CLIENT_SELECTION_MISMATCH');
      }
      if (typeof binding.outbound_request_json !== 'string'
        || new TextEncoder().encode(binding.outbound_request_json).byteLength > 65536) return failure('CLIENT_REQUEST_INVALID');
      if (!settings || (settings.signal !== undefined && !(settings.signal instanceof AbortSignal))) return failure('CLIENT_SIGNAL_INVALID');
      if (settings.signal?.aborted) return failure('CLIENT_CANCELLED');
      const controller = new AbortController();
      let timer, stopCode = null, stop, started = false;
      const stopped = new Promise(resolve => { stop = code => {
        if (stopCode !== null) return;
        stopCode = code; controller.abort(); resolve(failure(code));
      }; });
      const onAbort = () => stop('CLIENT_CANCELLED');
      const cancel = () => stop('CLIENT_DISPOSED');
      const release = () => stop('CLIENT_SELECTION_RELEASED');
      active.add(cancel);
      source.active.add(release);
      settings.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => stop('CLIENT_TIMEOUT'), timeoutMs);
      try {
        const form = new FormData();
        form.append('file', new Blob([source.bytes]), 'selection.kdna');
        form.append('request', binding.outbound_request_json);
        started = true;
        const operation = (async () => {
          try {
            // Drain our bounded multipart encoder before attaching an abortable
            // network consumer. Node's async FormData producer can enqueue after
            // Fetch abort has closed its stream. The finite byte body has no such
            // producer; cancellation still aborts Fetch and prevents dispatch or
            // publication while encoding completes within the existing limits.
            const upload = new Request(endpoint.href, { method: 'POST', body: form });
            const body = await upload.arrayBuffer();
            if (stopCode !== null || disposed || source.released) return failure(stopCode ?? 'CLIENT_SELECTION_RELEASED');
            const response = await fetcher(endpoint.href, { method: 'POST', body,
              headers: { 'content-type': upload.headers.get('content-type') },
              signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
            if (stopCode !== null || disposed || source.released) { discard(response); return failure(stopCode ?? 'CLIENT_SELECTION_RELEASED'); }
            const admission = await admitReadTransportResponse(response, binding);
            if (stopCode !== null || disposed || source.released) return failure(stopCode ?? 'CLIENT_SELECTION_RELEASED');
            if (admission.status !== 'accepted') { controller.abort(); discard(response); return Object.freeze({ status: 'rejected', code: admission.rejection.code, admission, view: null }); }
            return Object.freeze({ status: 'received', code: null, admission, view: view(admission) });
          } catch { return failure(stopCode ?? 'CLIENT_NETWORK_ERROR'); }
        })();
        // A fetch implementation that ignores abort keeps its concurrency slot until it settles.
        operation.then(() => { active.delete(cancel); source.active.delete(release); });
        return await Promise.race([operation, stopped]);
      } finally {
        clearTimeout(timer); settings.signal?.removeEventListener('abort', onAbort);
        if (!started) { active.delete(cancel); source.active.delete(release); }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cancel of active) cancel();
      active.clear();
    },
  });
}

module.exports = { selectKDNA, releaseKDNASelection, createKDNAWebClient };
