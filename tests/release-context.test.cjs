'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  verifyDependencies,
  verifyReleaseContext,
  verifyReleaseEvent,
} = require('../scripts/verify-release-context.cjs');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PACKAGE_LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');
const SCRIPT = path.join(ROOT, 'scripts/verify-release-context.cjs');

function changelogFor(heading, extra = '') {
  return `# Changelog\n\n${heading}\n\n- Release notes.\n${extra}`;
}

function context(overrides = {}) {
  const version = PACKAGE_JSON.version;
  return {
    packageJson: overrides.packageJson ?? PACKAGE_JSON,
    packageLock: overrides.packageLock ?? PACKAGE_LOCK,
    changelog: overrides.changelog ?? changelogFor(`## ${version} (2026-07-18)`),
    releaseTag: overrides.releaseTag ?? version,
  };
}

test('release context accepts only the exact stable coordinate and first CHANGELOG entry', () => {
  const version = PACKAGE_JSON.version;
  assert.deepEqual(verifyReleaseContext(context()), {
    version,
    releaseTag: version,
    changelogHeading: `## ${version} (2026-07-18)`,
  });
  assert.doesNotThrow(() => verifyDependencies(PACKAGE_JSON, PACKAGE_LOCK));
  assert.doesNotThrow(() => verifyReleaseEvent({
    action: 'published', isDraft: 'false', isPrerelease: 'false',
  }));
});

test('release context rejects prereleases, drafts, version drift, and prefix-shaped tags', () => {
  for (const event of [
    { action: 'created', isDraft: 'false', isPrerelease: 'false' },
    { action: 'published', isDraft: 'true', isPrerelease: 'false' },
    { action: 'published', isDraft: 'false', isPrerelease: 'true' },
  ]) assert.throws(() => verifyReleaseEvent(event));

  const version = PACKAGE_JSON.version;
  for (const releaseTag of [
    '9.9.9',
    ['v', version].join(''),
    ['V', version].join(''),
    `${version}-preview`,
    `${version}+build`,
  ]) assert.throws(() => verifyReleaseContext(context({ releaseTag })), /natural SemVer|exactly/);
});

test('release context rejects stale, approximate, duplicate, and Setext headings', () => {
  const version = PACKAGE_JSON.version;
  for (const changelog of [
    changelogFor('## 9.9.9'),
    changelogFor(`## ${version} notes`),
    changelogFor(`## ${version} (2026-99-99)`),
    changelogFor(` ## ${version}`),
    changelogFor(`## ${version}`, `\n## ${version}\n`),
    changelogFor(`## ${version}`, `\n9.9.9\n---\n`),
  ]) assert.throws(() => verifyReleaseContext(context({ changelog })), /CHANGELOG/);
});

test('release dependency binding rejects range and lock drift', () => {
  const ranged = structuredClone(PACKAGE_JSON);
  ranged.devDependencies['@aikdna/kdna-web-server'] = '^0.3.0';
  assert.throws(() => verifyDependencies(ranged, PACKAGE_LOCK), /exact/);

  const drifted = structuredClone(PACKAGE_LOCK);
  drifted.packages['node_modules/@aikdna/kdna-core'].version = '0.19.0';
  assert.throws(() => verifyDependencies(PACKAGE_JSON, drifted), /core/i);
});

test('a Git-legal command-shaped tag remains data and fails before publication', () => {
  const version = PACKAGE_JSON.version;
  const hostileTag = `${version}';printf\${IFS}TAG_INTERPOLATION_EXECUTED;#`;
  assert.equal(spawnSync('git', ['check-ref-format', `refs/tags/${hostileTag}`]).status, 0);
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      RELEASE_EVENT_ACTION: 'published',
      RELEASE_IS_DRAFT: 'false',
      RELEASE_IS_PRERELEASE: 'false',
      RELEASE_TAG: hostileTag,
    },
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /TAG_INTERPOLATION_EXECUTED/u);
});

test('publish workflow is release-only, immutable, and checks out the exact tag', () => {
  assert.match(WORKFLOW, /release:\s*\n\s+types: \[published\]/u);
  assert.doesNotMatch(WORKFLOW, /workflow_dispatch/u);
  assert.match(WORKFLOW, /actions\/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0/u);
  assert.match(WORKFLOW, /actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/u);
  assert.doesNotMatch(WORKFLOW, /actions\/(?:checkout|setup-node)@v\d+/u);
  assert.match(WORKFLOW, /ref: \$\{\{ github\.event\.release\.tag_name \}\}/u);
  assert.match(WORKFLOW, /run: node scripts\/verify-release-context\.cjs/u);
  assert.match(WORKFLOW, /github\.event\.release\.prerelease == false/u);
});
