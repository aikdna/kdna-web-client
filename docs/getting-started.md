# Getting started with @aikdna/kdna-web-client

This guide uses the current source candidate
(`0.5.0-rc.component-semantics.1`): browser-safe file selection plus one
explicit remote Read call. That version tuple is not yet published to the npm
registry, and the current npm release (`0.3.0`) exposes an earlier API. See
[SECURITY.md](../SECURITY.md) for the supported coordinates.

---

## Prerequisites

- Node.js 22 or newer, and a browser environment or a browser-targeting
  bundler (Vite, webpack, Parcel, …).
- An HTTP(S) endpoint that implements the bound public Read transport contract.
  The source transport tests use `@aikdna/kdna-web-server`
  `0.5.0-rc.component-semantics.1` from `vendor/`; the published `0.3.1`
  release exposes the earlier contract and is not a substitute for that fixture.
- The bound public `@aikdna/kdna-core` and `@aikdna/kdna-read` packages, which
  this package declares as `peerDependencies`. Exact archive identities are
  recorded in `docs/current-core-read-binding.json`.

---

## Step 1 — Install

For source development, clone this repository and install its lockfile:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check:current-graph
npm test
```

The source lock resolves the bound Core/Read archives from `vendor/` and the
declared build tools from the registry. It needs registry access or a prepared
npm cache; an offline install is not a requirement.

To consume the candidate in another application, first create its archive in
the source checkout:

```bash
npm pack --ignore-scripts
```

Then run this in your application's directory, replacing `../kdna-web-client`
with the path to that source checkout:

```bash
npm install --ignore-scripts --no-audit --no-fund \
  ../kdna-web-client/vendor/aikdna-kdna-core-0.24.0-rc.component-semantics.2.tgz \
  ../kdna-web-client/vendor/aikdna-kdna-read-0.3.0-rc.component-semantics.2.tgz \
  ../kdna-web-client/aikdna-kdna-web-client-0.5.0-rc.component-semantics.1.tgz
```

All three archives are required in the same installation because the exact
Core/Read peer versions are not available from the registry. The client archive
does not contain `vendor/` or install its source-only development dependencies.
Its transitive third-party runtime dependencies still need the registry or a
prepared cache. Keep the dependency archive identities alongside your
application's lockfile; the source `check:current-graph` command verifies the
bound archive bytes before packaging.

---

## Step 2 — Select a file

```js
import { selectKDNA, releaseKDNASelection } from '@aikdna/kdna-web-client';

const chosen = await selectKDNA(file);
if (chosen.status !== 'selected') {
  console.error('Not admitted:', chosen.code);
} else {
  console.log(chosen.selection.asset, chosen.selection.tuple);
}
```

`selectKDNA()` copies the bytes and returns either a selection carrying
Core-admitted identity evidence or a bounded rejection. The default and maximum
file limit is 10 MiB; pass `{ maxFileBytes }` to enforce a smaller positive
limit. The bytes, the parsed manifest and the container payload are never
returned.

---

## Step 3 — Open an explicit remote session

```js
import { createKDNAWebClient } from '@aikdna/kdna-web-client';

const client = createKDNAWebClient({
  endpointUrl: 'https://example.com/api/kdna',
  endpointId: 'endpoint-1',
  sessionId: 'session-1',
});
```

`endpointUrl` must be a canonical absolute HTTP(S) URL without embedded
credentials or a fragment, because it is compared against the endpoint the Read
transport context declares. There is no implicit server and no fallback.

---

## Step 4 — Read the admitted selection

```js
// Continue only after selectKDNA returned status: 'selected'.
try {
  const result = await client.read(chosen.selection, readTransportContext, { signal });
  if (result.status === 'received') {
    consumeRemoteView(result.view);
  } else if (result.status === 'rejected') {
    console.warn('Rejected:', result.code);
  } else {
    console.error('Failed:', result.code);
  }
} finally {
  client.dispose();
  releaseKDNASelection(chosen.selection);
}
```

`readTransportContext` is the application's public `ReadTransportContext`,
supplied by the caller; the client does not invent selection semantics or
authority. The client checks it against the session binding and against the
admitted selection before it uploads anything. The upload is a single
`multipart/form-data` POST carrying the selected bytes as `file` and the
caller's `outbound_request_json` as `request`.

`received` means the official receiver admitted the remote response; it does
not by itself mean the requested content was disclosed. Inspect
`result.view.response.channel` and its public body. A denied envelope, an
admission rejection, a no-body control and a transport failure stay distinct
outcomes, and the view keeps the receiver's proof limits.

---

## Step 5 — Dispose and release

```js
client.dispose();
releaseKDNASelection(chosen.selection);
```

`dispose()` cancels active work and prevents further reads;
`releaseKDNASelection()` drops the retained bytes and cancels reads of that
selection. Both are idempotent, and neither grants nor revokes protocol
authority. Wrap the read in a `try/finally` so that both run even when the read
throws or is aborted.

---

## What to expect

- Bytes the bound Core admits produce `status: 'selected'`; bytes the Core
  cannot interpret produce `status: 'rejected'` with the Core's `states`,
  `diagnostics` and `component_failure` preserved.
- A remote exchange the receiver accepts produces `status: 'received'`; a
  receiver or Core rejection produces `status: 'rejected'` with a bounded code;
  a client or network failure produces `status: 'failed'`.
- The overall timeout defaults to 5 s and is capped at 30 s; concurrent
  requests default to 4 and are capped at 32. Redirects, ambient credentials,
  caching and retries are disabled.

---

## Next steps

- [Public API](../README.md#public-api)
- [Security model](./security-model.md)
- [Security policy](../SECURITY.md)
