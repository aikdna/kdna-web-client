import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  KDNAFileSizeError,
  KDNAFormatError,
  KDNALoadError,
  KDNALoadPlanManager,
  KDNAUploadError,
  readKDNAMetadata,
  uploadKDNA,
} from '../src/index.js';

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
  return new File([zip], 'browser.kdna', { type: 'application/vnd.kdna.asset' });
}

test('readKDNAMetadata reads public manifest fields without a server', async () => {
  const meta = await readKDNAMetadata(makeAssetFile());
  assert.equal(meta.domain, 'kdna:test:browser');
  assert.equal(meta.version, '0.1.0');
  assert.equal(meta.title, 'Browser Asset');
  assert.deepEqual(meta.profiles, ['index', 'compact']);
  assert.equal(meta.encrypted, false);
});

test('readKDNAMetadata accepts current v1 KDNA mimetype', async () => {
  const meta = await readKDNAMetadata(makeAssetFile('application/vnd.aikdna.kdna+zip'));
  assert.equal(meta.domain, 'kdna:test:browser');
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
      return new Response(JSON.stringify({ content: 'loaded', profile: body.profile }));
    },
  });

  const plan = await manager.planLoad('file-1');
  assert.equal(plan.canProceed, false);
  assert.equal(plan.requirements.password.required, true);

  const loaded = await manager.load('file-1', { profile: 'compact', password: 'pw' });
  assert.equal(loaded.content, 'loaded');
  assert.deepEqual(paths, ['/api/kdna/plan-load', '/api/kdna/load']);
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
