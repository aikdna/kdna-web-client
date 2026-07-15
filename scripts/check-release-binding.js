#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const version = pkg.version;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

if (!semver.test(version)) throw new Error(`Package version is not natural SemVer: ${version}`);
if (version.startsWith('v')) throw new Error('Generation-style or prefixed tags are forbidden.');
if (lock.version !== version || lock.packages?.['']?.version !== version) {
  throw new Error('package.json and package-lock.json versions are not identical.');
}
if (process.env.GITHUB_REF !== `refs/tags/${version}`) {
  throw new Error(`Publish must run from the exact no-prefix tag refs/tags/${version}.`);
}
const head = git('rev-parse', 'HEAD');
const tagCommit = git('rev-list', '-n', '1', version);
const exactTag = git('describe', '--tags', '--exact-match', 'HEAD');
if (tagCommit !== head || exactTag !== version) {
  throw new Error('Version tag, package version, and checked-out HEAD are not identical.');
}
if (git('status', '--porcelain') !== '') throw new Error('Publish checkout is not clean.');
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.split('\n').slice(0, 12).some((line) => line.startsWith(`## ${version} `))) {
  throw new Error(`CHANGELOG.md has no top release entry for ${version}.`);
}
console.log(JSON.stringify({ version, ref: process.env.GITHUB_REF, head }, null, 2));
