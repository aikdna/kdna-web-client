#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const allowlistPath = 'scripts/naming-integrity-allowlist.json';
const allowlist = JSON.parse(fs.readFileSync(path.join(root, allowlistPath), 'utf8'));

if (allowlist.schema !== 'kdna.naming-integrity-third-party-allowlist'
    || allowlist.schema_version !== '0.1.0'
    || !Array.isArray(allowlist.exceptions)) {
  throw new Error('Third-party naming allowlist is invalid.');
}

const allowed = new Map();
for (const entry of allowlist.exceptions) {
  const keys = Object.keys(entry).sort().join(',');
  if (keys !== 'count,path,reason,token'
      || !entry.reason.includes('Third-party')
      || !Number.isInteger(entry.count)
      || entry.count < 1) {
    throw new Error(`Invalid third-party naming exception for ${entry.path || '(missing path)'}.`);
  }
  allowed.set(`${entry.path}\u0000${entry.token}`, entry.count);
}

const retiredTokens = [
  ['trace', 'version'].join('_'),
  ['kdna', 'trace'].join('_'),
  ['answer', 'summary'].join('_'),
  ['assets', 'loaded'].join('_'),
  ['selection', 'actual'].join('_'),
  ['Trace', 'Decision'].join(''),
  ['primary', 'Legacy'].join(''),
  ['is', '09'].join(''),
  ['0', '9', '0'].join('.'),
  ['kdna', 'context', 'capsule'].join('.'),
];
const retiredPaths = [
  ['src', ['Trace', 'Viewer'].join('') + '.tsx'].join('/'),
];
const textExtensions = new Set([
  '.cjs', '.css', '.d.ts', '.html', '.js', '.json', '.jsx', '.md', '.mjs',
  '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);

function isTextFile(file) {
  if (file.endsWith('.d.ts')) return true;
  return textExtensions.has(path.extname(file));
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root })
    .toString('utf8').split('\u0000').filter(Boolean);
}

function packedFiles() {
  const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const report = JSON.parse(output)[0];
  if (!report?.filename) throw new Error('npm pack did not report one package.');
  const archive = path.join(root, report.filename);
  try {
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    return entries
      .filter((entry) => entry.startsWith('package/') && isTextFile(entry))
      .map((entry) => ({
        path: entry.slice('package/'.length),
        text: execFileSync('tar', ['-xOf', archive, entry], { encoding: 'utf8' }),
        surface: 'package',
      }));
  } finally {
    fs.rmSync(archive, { force: true });
  }
}

const tracked = trackedFiles();
const records = tracked
  .filter((file) => file !== allowlistPath && isTextFile(file) && fs.existsSync(path.join(root, file)))
  .map((file) => ({ path: file, text: fs.readFileSync(path.join(root, file), 'utf8'), surface: 'source' }));
records.push(...packedFiles());

const findings = [];
for (const retiredPath of retiredPaths) {
  if (fs.existsSync(path.join(root, retiredPath))
      || records.some((record) => record.surface === 'package' && record.path === retiredPath)) {
    findings.push(`retired path remains: ${retiredPath}`);
  }
}

for (const record of records) {
  let text = record.text;
  for (const [key, count] of allowed) {
    const [allowedPath, token] = key.split('\u0000');
    if (record.surface !== 'source' || record.path !== allowedPath) continue;
    const observed = text.split(token).length - 1;
    if (observed !== count) findings.push(`${record.surface}:${record.path}: allowlisted token count ${observed}, expected ${count}`);
    text = text.split(token).join('');
  }

  if (/(?:^|[^A-Za-z0-9])v\d+(?:\.\d+)*(?=$|[^A-Za-z0-9])/giu.test(text)) {
    findings.push(`${record.surface}:${record.path}: generation-style label`);
  }
  if (/\bv\$\{?[A-Z_]+\}?/u.test(text)) findings.push(`${record.surface}:${record.path}: prefixed release variable`);
  if (/\b(?:interface|type)\s+Trace\b/u.test(text)) findings.push(`${record.surface}:${record.path}: retired public Trace type`);
  for (const token of retiredTokens) {
    if (text.includes(token)) findings.push(`${record.surface}:${record.path}: retired runtime surface`);
  }
}

for (const [key] of allowed) {
  const [allowedPath] = key.split('\u0000');
  if (!records.some((record) => record.surface === 'source' && record.path === allowedPath)) {
    findings.push(`source:${allowedPath}: stale third-party exception path`);
  }
}

if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log(`Naming integrity passed for ${records.filter((record) => record.surface === 'source').length} source files and ${records.filter((record) => record.surface === 'package').length} actual package files.`);
