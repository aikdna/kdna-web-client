#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url));
const gzipBytes = gzipSync(source).length;
console.log(JSON.stringify({ file: 'src/index.js', bytes: source.length, gzipBytes }, null, 2));
