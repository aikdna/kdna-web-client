#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';

const EXPECTED_CORE_COMMIT = 'ca6ede2b4536215b3d42fe30404afa7d66cf4ddd';
const EXPECTED_AGGREGATE = '8783cb1786fbaaaa5e15641c8d2f790db143fde62bb0afdbdc2dbbce63a67876';
const EXPECTED_GOLDEN = '3db52c98e17a6ae1b65fc5af44c7234f88b54f440392a2ec400f2331429d1a04';
const JUDGMENT_TRACE_ID = 'https://github.com/aikdna/kdna/specs/judgment-trace.schema.json';
const RUNTIME_CAPSULE_ID = 'https://github.com/aikdna/kdna/specs/runtime-capsule.schema.json';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor/core-ca6ede2');
const outputPath = path.join(root, 'src/generated/runtime-validators.js');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function loadAuthority() {
  const authority = JSON.parse(fs.readFileSync(path.join(vendor, 'schema-authority.json'), 'utf8'));
  const expectedKeys = ['aggregate_sha256', 'authority', 'authority_version', 'core_commit', 'golden_sha256', 'schemas'];
  if (Object.keys(authority).sort().join(',') !== expectedKeys.join(',')) throw new Error('Schema authority fields are not exact.');
  if (authority.authority !== 'kdna-core-schema-closure' || authority.authority_version !== '0.1.0') throw new Error('Schema authority identity is invalid.');
  if (authority.core_commit !== EXPECTED_CORE_COMMIT) throw new Error('Core authority commit drifted.');
  if (authority.aggregate_sha256 !== EXPECTED_AGGREGATE) throw new Error('Schema aggregate authority drifted.');
  if (authority.golden_sha256 !== EXPECTED_GOLDEN) throw new Error('Golden authority drifted.');
  return authority;
}

function loadSchemas(authority) {
  const rows = [];
  const schemas = [];
  for (const name of Object.keys(authority.schemas).sort()) {
    const bytes = fs.readFileSync(path.join(vendor, name));
    const digest = sha256(bytes);
    if (digest !== authority.schemas[name]) throw new Error(`Canonical schema bytes drifted: ${name}`);
    rows.push(`${name}:${digest}`);
    schemas.push(JSON.parse(bytes.toString('utf8')));
  }
  const aggregate = sha256(`${rows.join('\n')}\n`);
  if (aggregate !== authority.aggregate_sha256) throw new Error('Canonical schema closure digest mismatched.');
  const golden = fs.readFileSync(path.join(vendor, 'runtime-contract-golden.json'));
  if (sha256(golden) !== authority.golden_sha256) throw new Error('Canonical runtime golden bytes drifted.');
  return schemas;
}

async function generate() {
  const authority = loadAuthority();
  const schemas = loadSchemas(authority);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    // Core conditionals inherit their object type from the enclosing schema;
    // keep every validation keyword while disabling Ajv's annotation warning.
    strictTypes: false,
    validateFormats: true,
    code: { esm: true, source: true },
  });
  addFormats(ajv);
  for (const schema of schemas) ajv.addSchema(schema);
  if (!ajv.getSchema(JUDGMENT_TRACE_ID)) throw new Error('JudgmentTrace schema did not compile.');
  if (!ajv.getSchema(RUNTIME_CAPSULE_ID)) throw new Error('Runtime Capsule schema did not compile.');
  const standalone = standaloneCode(ajv, {
    validateJudgmentTrace: JUDGMENT_TRACE_ID,
    validateRuntimeCapsule: RUNTIME_CAPSULE_ID,
  });
  const authorityExport = `\nexport const KDNA_SCHEMA_AUTHORITY = Object.freeze(${JSON.stringify({
    core_commit: authority.core_commit,
    aggregate_sha256: authority.aggregate_sha256,
    judgment_trace_sha256: authority.schemas['judgment-trace.schema.json'],
    runtime_capsule_sha256: authority.schemas['runtime-capsule.schema.json'],
  })});\n`;
  const bundled = await build({
    stdin: {
      contents: `${standalone}${authorityExport}`,
      loader: 'js',
      resolveDir: root,
      sourcefile: 'canonical-runtime-validator.js',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    legalComments: 'none',
    write: false,
  });
  return `// Generated from KDNA Core ${authority.core_commit}; do not edit.\n${bundled.outputFiles[0].text}`;
}

const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: generate-runtime-validators.js --write|--check');
}
const generated = await generate();
if (mode === '--write') {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, generated);
  console.log(`Generated ${path.relative(root, outputPath)}.`);
} else {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== generated) {
    throw new Error('Committed browser validators are stale; run npm run validators:generate.');
  }
  console.log('Canonical browser validators match their schema closure.');
}
