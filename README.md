# @aikdna/kdna-web-client

Explicit browser file selection and a remote Read consumer. The public Core admits selected container bytes. The public `@aikdna/kdna-read/transport` receiver admits the actual Fetch `Response`; this package projects that result without a second parser, Validator, schema, JCS implementation, closure resolver, or Host fallback.

Version `0.5.0-rc.component-semantics.1` binds Core
`0.24.0-rc.component-semantics.2` and Read `0.3.0-rc.component-semantics.2`.
The component definition is
`sha256:3087cd19542e72322aec19b3015c916d2cfb074fa42e3fd76b3756bb4f097de3`.
Exact archive identities are listed in `docs/current-core-read-binding.json`;
matching version labels alone do not identify the tested graph.
For source setup and installation from local archives, see
[Getting started](https://github.com/aikdna/kdna-web-client/blob/main/docs/getting-started.md).
The candidate peer versions are not yet available from the npm registry.

## Public API

- `selectKDNA(fileOrBytes, { maxFileBytes? })` accepts File, Blob, ArrayBuffer or Uint8Array and returns a Core-admitted selection or a bounded rejection. It copies bytes and exposes only Core identity, version tuple and digest evidence. The default and maximum file limit is 10 MiB. Raw payload and manifests are not returned. A public Core rejection also exposes its unchanged `states`, `diagnostics` and `component_failure`; technically valid content with blocked component interpretation remains rejected with no selection. Local file-input errors keep their bounded error shape without invented Core states.
- `createKDNAWebClient({ endpointUrl, endpointId, sessionId, timeoutMs?, maxConcurrentRequests?, fetch? })` creates an explicit remote session. The URL must be canonical HTTP(S), without credentials or a fragment. There is no implicit server.
- `client.read(selection, context, { signal? })` uploads the private selected bytes and the exact `context.outbound_request_json` as multipart fields `file` and `request`. `context` is the public ReadTransportContext, including its request, correlation, lifetime, response limits and expected Core identity. The application supplies this explicit contract; the client does not invent selection semantics or authority. The client checks the chosen file against its identity binding, and the public receiver validates the full response contract.
- `client.dispose()` cancels active work and prevents further reads. `releaseKDNASelection(selection)` drops retained file bytes and cancels reads of that selection. Both are idempotent.

```js
import { selectKDNA, createKDNAWebClient, releaseKDNASelection } from '@aikdna/kdna-web-client';
const chosen = await selectKDNA(file);
if (chosen.status === 'selected') {
  const client = createKDNAWebClient({ endpointUrl, endpointId, sessionId });
  try {
    const result = await client.read(chosen.selection, readTransportContext, { signal });
    if (result.status === 'received') consumeRemoteView(result.view);
  } finally {
    client.dispose();
    releaseKDNASelection(chosen.selection);
  }
}
```

`received` means the official receiver admitted the remote response. Inspect `view.response.channel` and its public body: a denied envelope, admission rejection, no-body control, and transport failure remain those outcomes. `received` alone does not mean the requested content was disclosed. The view preserves the receiver's proof scope, proof limits and false local capabilities. No remote identity, authorization, current revocation, network replay prevention, receipt delivery or raw HTTP framing proof is added. Remote content remains untrusted display data; consumers must use safe text rendering.

Failures carry bounded codes and null views. The client does not expose network exception messages or rejected bodies. Request JSON is limited to 64 KiB. Overall timeout defaults to 5 seconds and is capped at 30 seconds. Concurrent requests default to 4 and are capped at 32. The public context supplies bounded response bytes and read duration. Redirects, ambient credentials, caching and retries are disabled. Aborted, released, disposed or timed-out operations cannot publish a late view. An injected Fetch implementation is application-owned: if it ignores abort, its slot stays occupied until it settles; physical cancellation of such custom code cannot be guaranteed.

## Packaging and verification

CJS and ESM expose the same three functions, with TypeScript declarations. Only public Core browser/components/package metadata and Read transport/package metadata enter the browser bundle. No Node/server/development or private entrypoints are imported. Official generated validators remain owned and shipped by their public dependency, not duplicated here.

The current source lock resolves the KDNA/Read archives in `vendor/` and the
declared build tools from the official registry, so `npm ci --ignore-scripts
--no-audit --no-fund` needs registry access or a prepared npm cache; an offline
install is not a requirement of this repository. Then run `npm test`,
`npm run lint`, `npm run check:current-graph`, `npm run build` and
`npm run typecheck`. `npm run pack:check` verifies the actual archive and its reported
file surface; `npm pack --ignore-scripts --json` alone only creates the package
and prints its report. The source tests also use an explicitly
pinned reference Host as a development fixture, not a client runtime dependency.
`npm run check:current-graph` verifies source vendor bytes, lock bindings and the
runtime descriptor.

`esbuild` and `typescript` are declared `devDependencies`: `npm run build` and
`npm run typecheck` use those declared tools by default and still accept an
explicit path (`npm run build -- /path/to/esbuild/module`,
`npm run typecheck -- /path/to/typescript/lib/tsc.js`). An explicit `tsc.js`
path must be a compatible version (TypeScript 7 or newer): the declared
typecheck passes `--ignoreConfig`, which the 5.x line rejects with `TS5023`.
No esbuild or TypeScript
executable is vendored here or shipped in the tarball — the platform binaries
are architecture-specific optional dependencies installed from the registry —
so a build or typecheck needs the registry or a prepared cache, and an install
that does not omit optional dependencies.

The Node transport suite uses selected component bytes, a reference Host on an
explicit `127.0.0.1` ephemeral port and native Fetch through the public receiver.
Run it explicitly with `npm run test:http` in an environment that permits a
loopback listener. Restricted environments can instead pass an already listening
IPv4 FD through `KDNA_WEB_CLIENT_BOUND_FD`, with the JSON address pair in
`KDNA_WEB_CLIENT_BOUND_ADDRESS`, to a direct Node invocation of the test file.
Process launchers must explicitly preserve that FD; npm and worker-based test
runners must not be assumed to do so. The default `npm test` runs current
selection and injected pending-Fetch lifecycle checks without opening sockets. Neither suite establishes a real browser
application, authenticated remote identity or remote application acknowledgement.
Historical browser matrices remain under their original exact graphs and are
not re-labelled as current verification. CJS/ESM runtime and type consumers are
distinct from a browser bundle or browser application acceptance.

The previous manifest/ZIP parser, upload-fileId, LoadPlan manager, Runtime Capsule, JudgmentTrace and Viewer API are retired from this candidate's exports and tarball. The retained isolated historical files are not runtime fallbacks. This is a bounded consumption-contract migration, not compatibility for the retired API, a Reader product design, or a React/application rollout. Historical modules and the explicitly named `test:legacy-graph`,
`build:legacy-graph` and `typecheck:legacy-graph` scripts remain separate from
current package verification.
