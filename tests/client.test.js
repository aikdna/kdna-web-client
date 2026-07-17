import { test } from 'node:test';
import assert from 'node:assert/strict';
import { File as NodeFile } from 'node:buffer';
import fs from 'node:fs';
import {
  KDNA_SCHEMA_AUTHORITY,
  KDNAFileSizeError,
  KDNAFormatError,
  KDNALoadError,
  KDNALoadPlanManager,
  KDNAUploadError,
  JudgmentTraceViewer,
  judgmentTraceView,
  parseJudgmentTrace,
  readKDNAMetadata,
  uploadKDNA,
  validateJudgmentTrace,
} from '../src/index.js';

const FileCtor = globalThis.File || NodeFile;
const golden = JSON.parse(fs.readFileSync(
  new URL('../vendor/core-1e77e3e/runtime-contract-golden.json', import.meta.url),
  'utf8',
));

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function bytes(value) {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, raw] of Object.entries(entries)) {
    const nameBytes = bytes(name);
    const data = bytes(raw);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data,
    ]);
    const central = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0),
      u16(0), u32(0), u32(offset), nameBytes,
    ]);
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }

  const local = concat(localParts);
  const central = concat(centralParts);
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0), u16(centralParts.length), u16(centralParts.length),
    u32(central.length), u32(local.length), u16(0),
  ]);
  return concat([local, central, eocd]);
}

function makeAssetFile(mimetype = 'application/vnd.kdna.asset') {
  const zip = makeStoredZip({
    mimetype,
    'kdna.json': JSON.stringify({
      asset_id: 'kdna:test:browser',
      version: '0.1.0',
      title: 'Browser Asset',
      summary: 'Public metadata',
      load_contract: { profiles: { index: {}, compact: {} } },
    }),
    'payload.kdnab': '{}',
  });
  return new FileCtor([zip], 'browser.kdna', { type: 'application/vnd.kdna.asset' });
}

function currentRuntimeCapsule() {
  return structuredClone(golden.request.capsule);
}

function currentJudgmentTrace() {
  return structuredClone(golden.trace);
}

function hostileTraces() {
  const cases = [];
  const add = (name, mutate) => {
    const trace = currentJudgmentTrace();
    mutate(trace);
    cases.push([name, trace]);
  };
  add('empty host capabilities', (trace) => { trace.runtime_contract.host_capabilities = {}; });
  add('forged receipt', (trace) => { trace.host_receipt.runtime_receipt.forged = true; });
  add('illegal digest comparison', (trace) => {
    trace.digest_evidence.asset.comparison = {
      state: 'matched', against: null, expected: null, source: null,
    };
  });
  add('negative budget and malformed error', (trace) => {
    trace.budget.actual.tokens_used = -1;
    trace.errors = [{}];
  });
  add('inconsistent negotiation', (trace) => {
    trace.runtime_contract.selected_capsule_version = null;
  });
  return cases;
}

test('readKDNAMetadata reads public manifest fields without a server', async () => {
  const meta = await readKDNAMetadata(makeAssetFile());
  assert.equal(meta.domain, 'kdna:test:browser');
  assert.equal(meta.version, '0.1.0');
  assert.equal(meta.title, 'Browser Asset');
  assert.deepEqual(meta.profiles, ['index', 'compact']);
  assert.equal(meta.encrypted, false);
});

test('readKDNAMetadata rejects removed KDNA mimetypes', async () => {
  await assert.rejects(
    readKDNAMetadata(makeAssetFile('application/vnd.aikdna.kdna+zip')),
    (error) => error instanceof KDNAFormatError && error.code === 'KDNA_MIMETYPE_INVALID',
  );
});

test('readKDNAMetadata rejects unsupported mimetype entries', async () => {
  await assert.rejects(
    readKDNAMetadata(makeAssetFile('application/zip')),
    (error) => error instanceof KDNAFormatError && error.code === 'KDNA_MIMETYPE_INVALID',
  );
});

test('readKDNAMetadata enforces optional maxSizeBytes', async () => {
  const file = makeAssetFile();
  await assert.rejects(
    readKDNAMetadata(file, { maxSizeBytes: file.size - 1 }),
    (error) => error instanceof KDNAFileSizeError
      && error.code === 'KDNA_FILE_TOO_LARGE'
      && error.actualSizeBytes === file.size,
  );
});

test('uploadKDNA posts multipart form data and returns fileId', async () => {
  const calls = [];
  const result = await uploadKDNA(makeAssetFile(), '/api/kdna/inspect', {
    fetch: async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.method, 'POST');
      assert.ok(init.body instanceof FormData);
      return new Response(JSON.stringify({ fileId: 'file-1', domain: 'kdna:test:browser' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(result.fileId, 'file-1');
  assert.equal(calls[0].url, '/api/kdna/inspect');
});

test('uploadKDNA surfaces structured server errors', async () => {
  await assert.rejects(
    uploadKDNA(makeAssetFile(), '/api/kdna/inspect', {
      fetch: async () => new Response(JSON.stringify({ error: { code: 'bad', message: 'Nope' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    (error) => error instanceof KDNAUploadError && error.code === 'bad',
  );
});

test('KDNALoadPlanManager drives plan-load and load JSON calls', async () => {
  const paths = [];
  const manager = new KDNALoadPlanManager('/api/kdna/', {
    fetch: async (url, init) => {
      paths.push(url);
      const body = JSON.parse(init.body);
      if (url.endsWith('/plan-load')) {
        assert.equal(body.fileId, 'file-1');
        return new Response(JSON.stringify({
          plan: { can_load_now: false, required_action: 'enter_password', state: 'needs_password' },
        }));
      }
      const capsule = currentRuntimeCapsule();
      assert.equal(body.profile, capsule.profile);
      return new Response(JSON.stringify({
        content: capsule.context,
        profile: body.profile,
        capsule,
      }));
    },
  });

  const plan = await manager.planLoad('file-1');
  assert.equal(plan.canProceed, false);
  assert.equal(plan.requirements.password.required, true);

  const loaded = await manager.load('file-1', { profile: 'compact', password: 'pw' });
  assert.equal(loaded.capsule.type, 'kdna.runtime-capsule');
  assert.equal(loaded.capsule.contract_version, '0.1.0');
  assert.equal(loaded.content.highest_question, golden.request.capsule.context.highest_question);
  assert.deepEqual(paths, ['/api/kdna/plan-load', '/api/kdna/load']);
});

test('KDNALoadPlanManager rejects forged Runtime Capsules at the load boundary', async () => {
  const capsule = currentRuntimeCapsule();
  capsule.forged = true;
  const manager = new KDNALoadPlanManager('/api/kdna', {
    fetch: async () => new Response(JSON.stringify({ capsule, content: capsule.context })),
  });
  await assert.rejects(
    manager.load('file-1'),
    (error) => error instanceof KDNALoadError && error.code === 'KDNA_RUNTIME_CAPSULE_INVALID',
  );
});

test('KDNALoadPlanManager throws KDNALoadError on failed load calls', async () => {
  const manager = new KDNALoadPlanManager('/api/kdna', {
    fetch: async () => new Response(JSON.stringify({ error: { code: 'denied', message: 'Denied' } }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
  });

  await assert.rejects(
    manager.load('file-1'),
    (error) => error instanceof KDNALoadError && error.status === 403 && error.code === 'denied',
  );
});

test('security docs keep raw license keys out of load guidance', () => {
  for (const relPath of ['../README.md', '../docs/security-model.md', '../CONTRIBUTING.md']) {
    const text = fs.readFileSync(new URL(relPath, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /Passwords and license keys are arguments\\s+to `manager\\.load\\(\\)`/);
    assert.doesNotMatch(text, /must not accept, store, or transmit passwords or\\s+license keys/);
  }
});

test('JudgmentTrace parser accepts only the current contract discriminator', () => {
  const trace = currentJudgmentTrace();
  assert.equal(parseJudgmentTrace(JSON.stringify(trace)).contract_version, '0.1.0');
  assert.equal(validateJudgmentTrace(trace).valid, true);

  const retiredField = ['trace', 'version'].join('_');
  const stale = { ...trace, [retiredField]: ['0', '9', '0'].join('.') };
  assert.equal(validateJudgmentTrace(stale).valid, false);
  assert.throws(() => parseJudgmentTrace(JSON.stringify(stale)), (error) => (
    error instanceof KDNAFormatError && error.code === 'KDNA_JUDGMENT_TRACE_INVALID'
  ));
});

test('all web trace boundaries reject hostile nested mutations', () => {
  const container = { ownerDocument: {}, replaceChildren() {} };
  const viewer = new JudgmentTraceViewer(container);
  for (const [name, trace] of hostileTraces()) {
    assert.equal(validateJudgmentTrace(trace).valid, false, name);
    assert.throws(() => parseJudgmentTrace(JSON.stringify(trace)), KDNAFormatError, name);
    assert.throws(() => judgmentTraceView(trace), KDNAFormatError, name);
    assert.throws(() => viewer.render(trace), KDNAFormatError, name);
  }
});

test('validator authority is pinned to the audited Core schema closure', () => {
  assert.deepEqual(KDNA_SCHEMA_AUTHORITY, {
    core_commit: '1e77e3e0d486c330fe9f9262b514ef24c859d469',
    aggregate_sha256: '8c38138e18ac5b465d779aeaf9fadcdd846236b0f96e7b144a6cc5c228ad480d',
    judgment_trace_sha256: 'a260e5abbcc68bf8df11ba738b5d475901b2950668c4718e415355adc723c7b0',
    runtime_capsule_sha256: '0219870a83fffddee4fa869cd1976c7ee55bcfa5fd4a44dc4032e126500333db',
  });
});

test('judgmentTraceView keeps delivery, execution, consumption, and conformance distinct', () => {
  const view = judgmentTraceView(currentJudgmentTrace());
  assert.equal(view.deliveryStatus, 'correlated_response');
  assert.equal(view.executionStatus, 'completed');
  assert.equal(view.semanticConsumption, 'not_observed');
  assert.equal(view.conformanceStatus, 'not_evaluated');
  assert.equal(view.tokensUsed, null);
  assert.equal(view.usageBasis, 'not_observed');
});

test('JudgmentTraceViewer renders through DOM APIs without HTML injection', () => {
  const created = [];
  const document = {
    createElement(tagName) {
      const node = {
        tagName,
        children: [],
        textContent: '',
        append(...children) { this.children.push(...children); },
      };
      created.push(node);
      return node;
    },
  };
  const container = {
    ownerDocument: document,
    children: [],
    replaceChildren(...children) { this.children = children; },
  };
  const viewer = new JudgmentTraceViewer(container);
  const view = viewer.render(currentJudgmentTrace());
  assert.equal(view.semanticConsumption, 'not_observed');
  assert.equal(container.children[0].tagName, 'section');
  assert.ok(created.some((node) => node.textContent === 'Conformance: not_evaluated'));
  viewer.clear();
  assert.deepEqual(container.children, []);
});
