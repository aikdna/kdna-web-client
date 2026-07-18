import { test } from 'node:test';
import assert from 'node:assert/strict';
import { File as NodeFile } from 'node:buffer';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createKDNAServer } from '@aikdna/kdna-web-server';
import { KDNALoadPlanManager, readKDNAMetadata, uploadKDNA } from '../src/index.js';

const FileCtor = globalThis.File || NodeFile;

async function startHttpServer(server) {
  const listener = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const address = listener.address();
      const url = `http://127.0.0.1:${address.port}${request.url}`;
      const init = {
        method: request.method,
        headers: request.headers,
        ...(request.method === 'GET' || request.method === 'HEAD'
          ? {}
          : { body: Buffer.concat(chunks) }),
      };
      const result = await server.handle(new Request(url, init));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'KDNA_INTEGRATION_BRIDGE_FAILED' } }));
    }
  });
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/kdna`,
    async close() {
      listener.close();
      await once(listener, 'close');
    },
  };
}

test('Web Client drives Web Server 0.3 and Core 0.20 with an accepted public asset', async () => {
  const assetPath = process.env.KDNA_WEB_CLIENT_ASSET;
  assert.ok(assetPath, 'KDNA_WEB_CLIENT_ASSET must point to an accepted public .kdna fixture');

  const bytes = fs.readFileSync(assetPath);
  const file = new FileCtor([bytes], 'laozi-wuwei-0.1.1.kdna', {
    type: 'application/vnd.kdna.asset',
  });
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdna-web-client-integration-'));
  const server = createKDNAServer({ storageDir });
  const httpServer = await startHttpServer(server);

  try {
    const metadata = await readKDNAMetadata(file);
    assert.equal(metadata.domain, 'kdna:aikdna:laozi-wuwei');
    assert.equal(metadata.version, '0.1.1');

    const { fileId, inspect } = await uploadKDNA(file, `${httpServer.baseUrl}/inspect`);
    assert.ok(fileId);
    assert.equal(inspect.domain, 'kdna:aikdna:laozi-wuwei');
    assert.equal(inspect.version, '0.1.1');
    assert.equal(inspect.defaultProfile, 'compact');
    assert.doesNotMatch(JSON.stringify(inspect), new RegExp(storageDir));

    const manager = new KDNALoadPlanManager(httpServer.baseUrl);
    const plan = await manager.planLoad(fileId);
    assert.equal(plan.canProceed, true);
    assert.deepEqual(plan.missing, []);
    assert.doesNotMatch(JSON.stringify(plan), new RegExp(storageDir));

    const loaded = await manager.load(fileId, { profile: 'compact' });
    assert.equal(loaded.domain, 'kdna:aikdna:laozi-wuwei');
    assert.equal(loaded.version, '0.1.1');
    assert.equal(loaded.judgmentVersion, '0.1.0');
    assert.equal(loaded.profile, 'compact');
    assert.equal(loaded.capsule.type, 'kdna.runtime-capsule');
    assert.ok(loaded.content && typeof loaded.content === 'object');
    assert.equal(loaded.content, loaded.capsule.context);
    assert.doesNotMatch(JSON.stringify(loaded), new RegExp(storageDir));
  } finally {
    await httpServer.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});
