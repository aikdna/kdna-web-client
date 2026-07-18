#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kdna-web-client-pack-audit-'));
const packDestination = path.join(temporary, 'pack');
const extraction = path.join(temporary, 'extract');

const EXPECTED_FILES = Object.freeze([
  'LICENSE',
  'NOTICE',
  'README.md',
  'SECURITY.md',
  'docs/getting-started.md',
  'docs/security-model.md',
  'package.json',
  'src/generated/runtime-validators.js',
  'src/index.d.ts',
  'src/index.js',
]);
const EXPECTED_RUNTIME_EXPORTS = Object.freeze([
  'JudgmentTraceViewer',
  'KDNAFileSizeError',
  'KDNAFormatError',
  'KDNALoadError',
  'KDNALoadPlanManager',
  'KDNAUploadError',
  'KDNA_SCHEMA_AUTHORITY',
  'judgmentTraceView',
  'parseJudgmentTrace',
  'readKDNAMetadata',
  'uploadKDNA',
  'validateJudgmentTrace',
]);
const EXPECTED_AUTHORITY = Object.freeze({
  core_commit: '1e77e3e0d486c330fe9f9262b514ef24c859d469',
  aggregate_sha256: '8c38138e18ac5b465d779aeaf9fadcdd846236b0f96e7b144a6cc5c228ad480d',
  judgment_trace_sha256: 'a260e5abbcc68bf8df11ba738b5d475901b2950668c4718e415355adc723c7b0',
  runtime_capsule_sha256: '0219870a83fffddee4fa869cd1976c7ee55bcfa5fd4a44dc4032e126500333db',
});

function fail(code, message) {
  throw new Error(`[${code}] ${message}`);
}

function sameStringSet(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function hostileTraces(golden) {
  const cases = [];
  const add = (name, mutate) => {
    const trace = structuredClone(golden);
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

function hostileCapsules(golden) {
  const cases = [];
  const add = (name, mutate) => {
    const capsule = structuredClone(golden);
    mutate(capsule);
    cases.push([name, capsule]);
  };
  add('unknown top-level field', (capsule) => { capsule.forged = true; });
  add('invalid profile', (capsule) => { capsule.profile = 'everything'; });
  add('illegal digest comparison', (capsule) => {
    capsule.digests.asset.comparison = {
      state: 'matched', against: null, expected: null, source: null,
    };
  });
  return cases;
}

function mustThrow(operation, name, boundary) {
  try {
    operation();
  } catch {
    return;
  }
  fail('PACK_TRACE_BOUNDARY', `${boundary} accepted hostile packed trace: ${name}`);
}

async function loadThrough(runtime, capsule) {
  const manager = new runtime.KDNALoadPlanManager('/api/kdna', {
    fetch: async () => new Response(JSON.stringify({ capsule, content: capsule.context }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  return manager.load('packed-boundary');
}

function assertExtractedFilesAreRegular(directory) {
  const visit = (current) => {
    for (const name of fs.readdirSync(current)) {
      const candidate = path.join(current, name);
      const stat = fs.lstatSync(candidate);
      assert.equal(stat.isSymbolicLink(), false, `packed symlink is forbidden: ${candidate}`);
      assert.ok(stat.isDirectory() || stat.isFile(), `non-regular packed entry is forbidden: ${candidate}`);
      if (stat.isDirectory()) visit(candidate);
    }
  };
  visit(directory);
}

try {
  fs.mkdirSync(packDestination);
  fs.mkdirSync(extraction);
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', packDestination],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const reports = JSON.parse(output);
  assert.equal(reports.length, 1, 'npm pack must report exactly one package');
  const report = reports[0];
  assert.equal(report.name, '@aikdna/kdna-web-client');
  assert.equal(report.version, '0.2.2');
  if (report.entryCount !== EXPECTED_FILES.length
      || !sameStringSet(report.files.map((entry) => entry.path), EXPECTED_FILES)) {
    fail('PACK_FILE_REPORT', 'npm pack file report drifted from the reviewed public package boundary');
  }

  const archive = path.join(packDestination, report.filename);
  assert.ok(fs.statSync(archive).isFile(), 'npm pack artifact is missing');
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  assert.deepEqual(
    entries.sort(),
    EXPECTED_FILES.map((entry) => `package/${entry}`).sort(),
    'actual tar entries drifted from the reviewed public package boundary',
  );
  for (const entry of entries) {
    assert.match(entry, /^package\/(?!\.\.\/)[^\0]+$/u, `unsafe tar entry: ${entry}`);
    assert.equal(entry.includes('/../'), false, `traversal tar entry: ${entry}`);
  }

  execFileSync('tar', ['-xzf', archive, '-C', extraction]);
  const packageRoot = path.join(extraction, 'package');
  assertExtractedFilesAreRegular(packageRoot);

  const packedManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(packedManifest.name, '@aikdna/kdna-web-client');
  assert.equal(packedManifest.version, '0.2.2');
  assert.deepEqual(packedManifest.exports, {
    '.': { types: './src/index.d.ts', default: './src/index.js' },
  });
  assert.equal(packedManifest.types, './src/index.d.ts');
  assert.deepEqual(packedManifest.files, [
    'src/', 'docs/', 'LICENSE', 'NOTICE', 'README.md', 'SECURITY.md',
  ]);
  assert.deepEqual(packedManifest.dependencies, {});
  assert.deepEqual(packedManifest.peerDependencies, {});
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) {
    if (packedManifest.scripts?.[lifecycle] !== undefined) {
      fail('PACK_LIFECYCLE', `packed lifecycle script is forbidden: ${lifecycle}`);
    }
  }

  for (const relative of EXPECTED_FILES) {
    const bytes = fs.readFileSync(path.join(packageRoot, relative));
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    for (const forbidden of ['/Users/', '/private/', 'private/x-plan', 'WORKLOG.md', 'AGENTS.md']) {
      if (text.includes(forbidden)) {
        fail('PACK_PRIVATE', `private token shipped in ${relative}: ${forbidden}`);
      }
    }
  }

  const runtime = await import(`${pathToFileURL(path.join(packageRoot, 'src/index.js')).href}?packed-audit`);
  if (!sameStringSet(Object.keys(runtime), EXPECTED_RUNTIME_EXPORTS)) {
    fail('PACK_EXPORTS', 'packed runtime exports drifted from the reviewed public API');
  }
  assert.deepEqual(runtime.KDNA_SCHEMA_AUTHORITY, EXPECTED_AUTHORITY);
  const declarations = fs.readFileSync(path.join(packageRoot, 'src/index.d.ts'), 'utf8');
  for (const exported of EXPECTED_RUNTIME_EXPORTS.filter((name) => name !== 'KDNA_SCHEMA_AUTHORITY')) {
    assert.match(declarations, new RegExp(`export (?:class|function) ${exported}\\b`, 'u'));
  }
  assert.match(declarations, /export declare const KDNA_SCHEMA_AUTHORITY\b/u);

  const golden = JSON.parse(fs.readFileSync(
    path.join(root, 'vendor/core-1e77e3e/runtime-contract-golden.json'),
    'utf8',
  ));
  assert.equal(runtime.validateJudgmentTrace(golden.trace).valid, true);
  assert.equal(runtime.parseJudgmentTrace(JSON.stringify(golden.trace)).trace_id, golden.trace.trace_id);
  assert.equal(runtime.judgmentTraceView(golden.trace).traceId, golden.trace.trace_id);
  const viewer = new runtime.JudgmentTraceViewer({ ownerDocument: {}, replaceChildren() {} });
  for (const [name, trace] of hostileTraces(golden.trace)) {
    if (runtime.validateJudgmentTrace(trace).valid) {
      fail('PACK_TRACE_VALIDATE', `validateJudgmentTrace accepted hostile packed trace: ${name}`);
    }
    mustThrow(() => runtime.parseJudgmentTrace(JSON.stringify(trace)), name, 'parseJudgmentTrace');
    mustThrow(() => runtime.judgmentTraceView(trace), name, 'judgmentTraceView');
    mustThrow(() => viewer.render(trace), name, 'JudgmentTraceViewer.render');
  }

  const loaded = await loadThrough(runtime, golden.request.capsule);
  assert.equal(loaded.capsule.contract_version, '0.1.0');
  for (const [name, capsule] of hostileCapsules(golden.request.capsule)) {
    await assert.rejects(
      loadThrough(runtime, capsule),
      (error) => error instanceof runtime.KDNALoadError
        && error.code === 'KDNA_RUNTIME_CAPSULE_INVALID',
      `KDNALoadPlanManager accepted hostile packed capsule: ${name}`,
    );
  }

  console.log('Packed public boundary passed: 10 exact files, 12 runtime exports, 5 hostile traces, and 3 hostile capsules.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
