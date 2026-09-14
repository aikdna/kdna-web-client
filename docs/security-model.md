# Security model

This document describes what `@aikdna/kdna-web-client` reads, retains and
transmits, and what it explicitly does not do. It applies to the current source
candidate (`0.5.0-rc.component-semantics.1`), whose public surface is the three
exported functions `selectKDNA`, `createKDNAWebClient` and
`releaseKDNASelection`.

---

## What this package does

| Operation | How |
|-----------|-----|
| Admit selected local bytes | Copies a `File`/`Blob`/`ArrayBuffer`/`Uint8Array` and submits it to the bound public Core browser admission surface |
| Expose Core identity evidence | Returns only the admitted asset identity, version tuple and digests |
| Upload a selected asset | One explicit `fetch` POST of `multipart/form-data` carrying the selected bytes and the caller's `outbound_request_json` |
| Admit the remote response | Hands the `Response` to the bound public `@aikdna/kdna-read/transport` receiver |
| Project the result | Returns the receiver's association, response, proof scope, proof limits and capabilities as a bounded view |
| Release retained bytes | `releaseKDNASelection()` drops the retained bytes and cancels in-flight reads for that selection |

The package does not define protocol validity, access modes, authorization,
cryptographic policy or LoadPlan states. Those contracts come from
`aikdna/kdna` and the conforming Core/Read packages bound in
`docs/current-core-read-binding.json`.

---

## What this package never does

- **No independent validation.** It carries no protocol validator, schema, JCS
  implementation or closure resolver. A selected byte string is admitted only
  by the bound public Core surface, and a remote body is admitted only by the
  bound public Read transport receiver.
- **No raw payload exposure.** `selectKDNA()` returns identity, tuple and
  digest evidence; it never returns the file bytes, the parsed manifest or the
  container payload.
- **No credential handling.** Requests are sent with `credentials: 'omit'`.
  This API accepts no license key, password, token or provider API key, and it
  stores none.
- **No ambient network behaviour.** Redirects are rejected
  (`redirect: 'error'`), caching is disabled (`cache: 'no-store'`), the
  referrer is omitted (`referrerPolicy: 'no-referrer'`), and there is no
  retry, implicit server or provider fallback.
- **No Node.js built-ins.** The public browser entry points use standard
  browser APIs plus the bound public Core/Read surfaces; no `fs`, `crypto`,
  `path`, `Buffer` or `process` import reaches the client runtime.
- **No upstream error-body exposure.** A failed local read, a Core rejection, a
  transport rejection and a transport failure each surface a bounded code.
  Network exception messages and rejected response bodies are not copied onto
  results.

---

## Selection and capability boundary

`selectKDNA()` returns a frozen selection object that is an opaque local
capability: it is registered in a module-scoped `WeakMap` keyed by object
identity, so copying its visible fields does not produce a usable selection.
The object carries the byte length, the optional file name, and the
Core-admitted asset identity, version tuple and digests.

A rejected selection carries a bounded code. When the bound Core rejected
technically valid bytes, the unchanged `states`, `diagnostics` and
`component_failure` are preserved so the caller can explain why admission
failed. Local input problems (`CLIENT_FILE_REQUIRED`, `CLIENT_FILE_UNREADABLE`,
`CLIENT_FILE_TOO_LARGE`) stay local and never invent Core states.

---

## Remote read boundary

`createKDNAWebClient()` binds one explicit endpoint (`endpointUrl`), one
`endpointId` and one `sessionId`. Before dispatch, `read()` checks that the
caller-supplied `ReadTransportContext` matches that binding and that its
`expected_asset`, `expected_tuple` and `expected_digests` match the admitted
selection. A mismatch is rejected locally without a network request.

`read()` returns one of three bounded outcomes:

| Status | Meaning |
|--------|---------|
| `received` | The official receiver admitted the remote response; `view` is the bounded projection |
| `rejected` | The receiver or the Core rejected the exchange; `admission` carries the bounded reason |
| `failed` | The client or the network failed; `code` is a bounded local failure code |

`received` means the receiver admitted the response. It does not mean the
requested content was disclosed: a denied envelope, an admission rejection, a
no-body control and a transport failure remain distinct outcomes. The view
preserves the receiver's proof scope, proof limits and stated local
capabilities. **No remote identity, authorization, current revocation, receipt
delivery, network replay prevention or raw HTTP framing proof is added.**
Remote strings are untrusted display data; render them with safe text APIs.

---

## Limits and lifecycle

| Limit | Default | Ceiling |
|-------|---------|---------|
| Selected file bytes | 10 MiB | 10 MiB |
| `outbound_request_json` size | — | 64 KiB (UTF-8) |
| Overall request timeout | 5000 ms | 30000 ms |
| Concurrent requests | 4 | 32 |

Aborted, released, disposed or timed-out operations cannot publish a late view.
`dispose()` cancels active work and prevents further reads;
`releaseKDNASelection()` drops the retained bytes and cancels reads of that
selection. Both are idempotent, and neither grants nor revokes protocol
authority. An application-supplied `fetch` is application-owned: logical
cancellation prevents publication, but if that implementation ignores its
`AbortSignal`, its bounded concurrency slot stays occupied until it settles,
and physical cancellation of that code cannot be guaranteed.

---

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md).
