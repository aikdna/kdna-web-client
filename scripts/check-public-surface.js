#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const textExtensions = new Set([
  '.cjs', '.css', '.d.ts', '.html', '.js', '.json', '.jsx', '.md', '.mjs',
  '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);
const forbiddenCredentialPrefixHash =
  '74f0f71d71864ef09245d0dafe6aba03129017f87ae023a18a1c38bb887ad76c';
const findings = [];

function containsForbiddenCredentialPrefix(text) {
  for (const match of text.matchAll(/(?=([A-Z0-9]{4}-[A-Z0-9]{3}-))/gu)) {
    const digest = crypto.createHash('sha256').update(match[1]).digest('hex');
    if (digest === forbiddenCredentialPrefixHash) return true;
  }
  return false;
}

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root },
).toString('utf8').split('\0').filter(Boolean);

for (const relative of files) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) continue;
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    findings.push(`${relative}: repository contains a symlink`);
    continue;
  }
  if (!stat.isFile() || (!textExtensions.has(path.extname(relative)) && relative !== 'NOTICE')) {
    continue;
  }
  const bytes = fs.readFileSync(absolute);
  if (bytes.length > 1_000_000 || bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  if (/\/Users\/(?!<user>\/|you\/|username\/)[^/\s]+\//u.test(text)) {
    findings.push(`${relative}: machine-specific filesystem path`);
  }
  if (containsForbiddenCredentialPrefix(text)) {
    findings.push(`${relative}: credential prefix or token-shaped example`);
  }
  if (/(?:^|\/)(?:AGENTS|WORKLOG)\.md$/iu.test(relative)) {
    findings.push(`${relative}: private coordination file`);
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(finding);
  throw new Error(`public-surface check found ${findings.length} issue(s)`);
}
console.log('Public-surface check passed.');
