#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NATURAL_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_HEADING_RE =
  /^## ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?: \((\d{4}-\d{2}-\d{2})\))?$/;
const FORBIDDEN_CHANGELOG_CONTROL_RE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u0084\u0086-\u009f]/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseReleaseHeading(line) {
  const match = RELEASE_HEADING_RE.exec(line);
  if (!match) return null;
  if (match[2]) {
    const date = new Date(`${match[2]}T00:00:00Z`);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== match[2]) return null;
  }
  return { line, version: match[1] };
}

function verifyReleaseContext({ packageJson, packageLock, changelog, releaseTag }) {
  const version = packageJson?.version;
  assert(
    typeof version === 'string' && NATURAL_SEMVER_RE.test(version),
    'package version must be an exact natural SemVer coordinate',
  );
  assert(
    typeof releaseTag === 'string' && NATURAL_SEMVER_RE.test(releaseTag),
    'release tag must be an exact natural SemVer coordinate',
  );
  assert(releaseTag === version, `release tag must be exactly ${version}`);
  assert(packageLock?.version === version, 'package-lock root version must match package version');
  assert(
    packageLock?.packages?.['']?.version === version,
    'package-lock package version must match package version',
  );

  const changelogText = String(changelog);
  assert(
    !FORBIDDEN_CHANGELOG_CONTROL_RE.test(changelogText),
    'CHANGELOG contains an unsupported control separator',
  );
  const lines = changelogText.split(/\r\n|[\n\r\u0085\u2028\u2029]/u);
  const hasSetextH2 = lines.some(
    (line, index) => index > 0 && /^-+$/u.test(line.trim()) && lines[index - 1].trim() !== '',
  );
  assert(!hasSetextH2, 'CHANGELOG release headings must use exact ## x.y.z syntax');
  const headings = lines.filter((line) => /^\s*##(?!#)/u.test(line));
  assert(headings.length > 0, 'CHANGELOG has no release headings');
  const parsed = headings.map(parseReleaseHeading);
  assert(
    parsed.every((heading) => heading !== null),
    'every CHANGELOG H2 must be exactly ## x.y.z or ## x.y.z (YYYY-MM-DD)',
  );
  assert(parsed[0].version === version, `first CHANGELOG release heading must be ${version}`);
  assert(
    parsed.filter((heading) => heading.version === version).length === 1,
    `CHANGELOG must contain exactly one heading for ${version}`,
  );
  return { version, releaseTag, changelogHeading: headings[0] };
}

function verifyReleaseEvent({ action, isDraft, isPrerelease }) {
  assert(action === 'published', 'release event action must be exactly published');
  assert(isDraft === 'false', 'draft releases cannot publish packages');
  assert(isPrerelease === 'false', 'prereleases cannot publish stable packages');
}

function verifyDependencies(packageJson, packageLock) {
  assert(
    packageJson?.devDependencies?.['@aikdna/kdna-web-server'] === '0.3.0'
      && packageLock?.packages?.['']?.devDependencies?.['@aikdna/kdna-web-server'] === '0.3.0'
      && packageLock?.packages?.['node_modules/@aikdna/kdna-web-server']?.version === '0.3.0',
    'integration tests must bind exact @aikdna/kdna-web-server@0.3.0',
  );
  assert(
    packageLock?.packages?.['node_modules/@aikdna/kdna-core']?.version === '0.20.0',
    'integration tests must resolve exact @aikdna/kdna-core@0.20.0',
  );
}

function main() {
  const root = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  try {
    verifyReleaseEvent({
      action: process.env.RELEASE_EVENT_ACTION,
      isDraft: process.env.RELEASE_IS_DRAFT,
      isPrerelease: process.env.RELEASE_IS_PRERELEASE,
    });
    verifyDependencies(packageJson, packageLock);
    const context = verifyReleaseContext({
      packageJson,
      packageLock,
      changelog,
      releaseTag: process.env.RELEASE_TAG,
    });
    console.log(`Release context verified: ${packageJson.name}@${context.version}`);
  } catch (error) {
    console.error(`Release context rejected: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  verifyDependencies,
  verifyReleaseContext,
  verifyReleaseEvent,
};
