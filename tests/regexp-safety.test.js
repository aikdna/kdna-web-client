import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KDNALoadPlanManager } from '../src/index.js';

test('trimSlash preserves empty string', () => {
  const mgr = new KDNALoadPlanManager('');
  assert.equal(mgr.endpoint('test'), '/test');
});

test('trimSlash preserves string with no trailing slash', () => {
  const mgr = new KDNALoadPlanManager('https://example.com');
  assert.equal(mgr.endpoint('test'), 'https://example.com/test');
});

test('trimSlash strips one trailing slash', () => {
  const mgr = new KDNALoadPlanManager('https://example.com/');
  assert.equal(mgr.endpoint('test'), 'https://example.com/test');
});

test('trimSlash strips many trailing slashes', () => {
  const mgr = new KDNALoadPlanManager('https://example.com////');
  assert.equal(mgr.endpoint('test'), 'https://example.com/test');
});

test('trimSlash strips all-slash input', () => {
  const mgr = new KDNALoadPlanManager('/////');
  assert.equal(mgr.endpoint('test'), '/test');
});

test('trimSlash handles large trailing-slash input with correct output', () => {
  const prefix = 'https://example.com/path';
  const base = prefix + '/'.repeat(100000);
  const mgr = new KDNALoadPlanManager(base);
  assert.equal(mgr.endpoint('test'), prefix + '/test');
  assert.equal(mgr.baseUrl, prefix);
});

test('trimSlash handles trailing slashes followed by non-slash — preserves non-slash content', () => {
  const prefix = 'https://example.com/path';
  const base = prefix + '/'.repeat(50000) + 'x';
  const mgr = new KDNALoadPlanManager(base);
  assert.ok(mgr.baseUrl.endsWith('x'), 'non-slash suffix must be preserved');
  assert.equal(mgr.endpoint('resource'), mgr.baseUrl + '/resource');
});
