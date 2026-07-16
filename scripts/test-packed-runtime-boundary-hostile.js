#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kdna-web-client-hostile-'));
const candidateFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root },
).toString('utf8').split('\0').filter(Boolean);

function copyCandidate(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const relative of candidateFiles) {
    const source = path.join(root, relative);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) continue;
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function replaceOnce(file, expected, replacement) {
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(before.split(expected).length - 1, 1, `hostile fixture drifted: ${file}`);
  fs.writeFileSync(file, before.replace(expected, replacement));
}

function runGate(directory) {
  return spawnSync(process.execPath, ['scripts/check-packed-runtime-boundary.js'], {
    cwd: directory,
    encoding: 'utf8',
    env: process.env,
  });
}

try {
  const pristine = path.join(temporary, 'pristine');
  copyCandidate(pristine);
  const accepted = runGate(pristine);
  assert.equal(accepted.error, undefined, `pristine packed boundary spawn failed: ${accepted.error}`);
  assert.equal(accepted.signal, null, `pristine packed boundary received signal: ${accepted.signal}`);
  assert.equal(accepted.status, 0, `pristine packed boundary failed:\n${accepted.stderr}`);

  const mutations = new Map([
    ['unexpected runtime export', {
      code: '[PACK_EXPORTS]',
      mutate(directory) {
        fs.appendFileSync(path.join(directory, 'src/index.js'), '\nexport const unexpectedPublicAlias = true;\n');
      },
    }],
    ['validator bypass', {
      code: '[PACK_TRACE_VALIDATE]',
      mutate(directory) {
        replaceOnce(
          path.join(directory, 'src/index.js'),
          'const valid = validateCanonicalJudgmentTrace(trace);',
          'const valid = true;',
        );
      },
    }],
    ['view boundary bypass', {
      code: '[PACK_TRACE_BOUNDARY]',
      mutate(directory) {
        replaceOnce(
          path.join(directory, 'src/index.js'),
          `export function judgmentTraceView(trace) {
  const validation = validateJudgmentTrace(trace);
  if (!validation.valid) {
    throw new KDNAFormatError(\`Invalid JudgmentTrace: \${validation.errors.join('; ')}\`, {
      code: 'KDNA_JUDGMENT_TRACE_INVALID',
    });
  }
  return {`,
          `export function judgmentTraceView(trace) {
  return {`,
        );
      },
    }],
    ['private path leak', {
      code: '[PACK_PRIVATE]',
      mutate(directory) {
        const privatePath = ['/Users', 'internal-owner', 'private-note'].join('/');
        fs.appendFileSync(path.join(directory, 'README.md'), `\nInternal source: ${privatePath}\n`);
      },
    }],
    ['install lifecycle', {
      code: '[PACK_LIFECYCLE]',
      mutate(directory) {
        const manifestPath = path.join(directory, 'package.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.scripts.preinstall = 'node -e "process.exit(0)"';
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      },
    }],
    ['expanded package files', {
      code: '[PACK_FILE_REPORT]',
      mutate(directory) {
        const manifestPath = path.join(directory, 'package.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.files.push('tests/');
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      },
    }],
  ]);

  let rejected = 0;
  for (const [name, mutation] of mutations) {
    const directory = path.join(temporary, `mutation-${rejected}`);
    copyCandidate(directory);
    mutation.mutate(directory);
    const result = runGate(directory);
    assert.equal(result.error, undefined, `${name} spawn failed: ${result.error}`);
    assert.equal(result.signal, null, `${name} received signal: ${result.signal}`);
    assert.notEqual(result.status, 0, `${name} unexpectedly passed the packed boundary`);
    assert.ok(
      `${result.stdout}\n${result.stderr}`.includes(mutation.code),
      `${name} failed for an unrelated reason; expected ${mutation.code}:\n${result.stderr}`,
    );
    rejected += 1;
  }
  console.log(`Packed boundary hostile mutations rejected: ${rejected}/${mutations.size}.`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
