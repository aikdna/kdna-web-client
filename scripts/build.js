#!/usr/bin/env node
import { access } from 'node:fs/promises';

await access(new URL('../src/index.js', import.meta.url));
await import('../src/index.js');
console.log('Build check passed.');
