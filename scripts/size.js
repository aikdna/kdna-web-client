#!/usr/bin/env node
// Size gate for the browser artifact this repository publishes.
//
// The gate used to measure `src/index.js` + `src/generated/runtime-validators.js`, the
// pre-`client.mjs` graph. Neither file is what a browser downloads now: package.json
// exports `src/client.mjs`/`src/client.cjs`, and `npm run build`
// (scripts/build-current.cjs) bundles `src/client.mjs` into `dist/components/client.js`.
// A ceiling on the retired pair therefore could not constrain the shipped artifact: it
// reported 275,973 B while the real bundle was 3,744,974 B. The retired pair is still
// reported, and still bounded, as a historical entry so the previous ceiling is not
// silently dropped; it is not the release gate.
//
// Budget derivation: `npm run build` is byte-deterministic with the pinned toolchain
// (esbuild from package-lock.json, Node 22.23.1, the CI floor) and currently emits
// 3,744,974 bytes / 263,715 gzip for `dist/components/client.js`. Both ceilings add 5%
// headroom, rounded up to a round number: enough for patch-level source and dependency
// drift plus the small zlib difference between the Node 22 and Node 24 CI legs, small
// enough that a real regression -- re-bundling the retired graph, adding a heavy
// dependency, or losing tree-shaking -- still fails. Re-derive with
// `npm run build && npm run size` whenever the bundle changes for a declared reason.
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const ARTIFACT = {
  path: 'dist/components/client.js',
  entry: 'src/client.mjs',
  built_by: 'npm run build',
  ceilings: { bytes: 3_950_000, gzipBytes: 280_000 },
};
const HISTORICAL = {
  paths: ['src/index.js', 'src/generated/runtime-validators.js'],
  historical: true,
  note: 'Retired graph: package.json#exports and the build no longer use these files. Retained, and still bounded, so the previous ceiling is not silently dropped.',
  ceilings: { bytes: 276_000, gzipBytes: 37_000 },
};

async function measure(paths) {
  const parts = await Promise.all(
    paths.map((file) => readFile(new URL(`../${file}`, import.meta.url))),
  );
  const bytes = Buffer.concat(parts);
  return { bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
}

let current;
try {
  current = await measure([ARTIFACT.path]);
} catch (error) {
  throw new Error(
    `Browser size gate: ${ARTIFACT.path} is missing (${error.code}). Run "npm run build" first.`,
  );
}
const historical = await measure(HISTORICAL.paths);

console.log(
  JSON.stringify(
    {
      artifact: { ...ARTIFACT, ...current },
      historical: { ...HISTORICAL, ...historical },
    },
    null,
    2,
  ),
);

if (current.bytes > ARTIFACT.ceilings.bytes || current.gzipBytes > ARTIFACT.ceilings.gzipBytes) {
  throw new Error(
    `Browser artifact ${ARTIFACT.path} exceeds the committed size ceiling ` +
      `(${current.bytes} B / ${current.gzipBytes} B gzip over ` +
      `${ARTIFACT.ceilings.bytes} B / ${ARTIFACT.ceilings.gzipBytes} B gzip).`,
  );
}
if (
  historical.bytes > HISTORICAL.ceilings.bytes ||
  historical.gzipBytes > HISTORICAL.ceilings.gzipBytes
) {
  throw new Error(
    `Retired graph ${HISTORICAL.paths.join(' + ')} exceeds its retained historical ceiling.`,
  );
}
