#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

const files = ['../src/index.js', '../src/generated/runtime-validators.js'];
const source = Buffer.concat(await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url)))));
const bytes = source.length;
const gzipBytes = gzipSync(source).length;
const ceilings = { bytes: 270_000, gzipBytes: 37_000 };

console.log(JSON.stringify({ files: files.map((file) => file.slice(3)), bytes, gzipBytes, ceilings }, null, 2));
if (bytes > ceilings.bytes || gzipBytes > ceilings.gzipBytes) {
  throw new Error('Browser runtime exceeds the committed size ceiling.');
}
