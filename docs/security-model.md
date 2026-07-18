# Security model

This document describes what `@aikdna/kdna-web-client` reads, stores,
and transmits, and what it explicitly does not do.

---

## What this package does

| Operation | How |
|-----------|-----|
| Read public metadata | Reads the local `.kdna` file in-memory and parses ZIP metadata plus public `kdna.json` |
| Upload a file to the server | `fetch` POST with `multipart/form-data` |
| Drive the load-plan flow | `fetch` POST to `/plan-load` and `/load` |
| Forward credentials to `/load` | Single `fetch` POST — credentials not stored |
| Read server responses | Bounded UTF-8 JSON with explicit public projections |

---

## What this package never does

- **No decryption.** The package does not attempt to decrypt any part
  of the `.kdna` payload, even if it has access to a password.
- **No credential storage.** Passwords and signed entitlement records or
  tokens are arguments to `manager.load()`. They are POSTed to the server
  and then garbage collected with the call frame. Raw license keys belong
  on your activation endpoint, not `/load`. Credentials are never assigned
  to a property on a long-lived object.
- **No Node.js built-ins.** The browser bundle contains no `fs`,
  `crypto`, `path`, `Buffer`, or `process` references. It runs in a
  standard browser environment.
- **No local payload parsing.** The package may see ZIP entry names while
  locating `kdna.json`, but it does not attempt to decode, deserialize,
  or display payload content.
- **No upstream error-body exposure.** Server messages, response payloads,
  provider details, and paths are not copied onto public client errors.

---

## Credential flow

```
User types password
       │
       ▼
manager.load(fileId, { password: '...' })
       │
       ├── password is in a local variable
       │
       ▼
fetch POST /api/kdna/load  { password: '...' }
       │
       └── local variable goes out of scope
```

The password never touches `localStorage`, `sessionStorage`,
`IndexedDB`, or any module-level state.

---

## File bytes in the browser

`readKDNAMetadata(file)` reads the local file into memory so it can locate
the ZIP central directory, verify the KDNA mimetype entry, and extract
public manifest fields from `kdna.json`. It does not parse or decrypt
payload entries. A 10 MiB file limit is enforced by default, matching the
official Web Server, and `kdna.json` has an independent 1 MiB decompression
limit. ZIP entry counts, central-directory bounds, duplicate names, local
headers, UTF-8 names, and declared sizes are validated before metadata is
returned. Use `maxSizeBytes` to choose a smaller positive limit.

`uploadKDNA(file, endpoint)` sends the full file bytes to the server
endpoint using the `fetch` API. The bytes are not retained after the
upload completes.

## Response and error boundary

Server response bodies are limited to 64 KiB, decoded as strict UTF-8, and
required to contain a JSON object. Upload and LoadPlan success responses are
projected to documented public fields. Load success is reconstructed from a
Runtime Capsule only after the exact pinned Core schema closure accepts it.

For failed requests, the client ignores the upstream message and body. It
exposes only a fixed local message, HTTP status, and an uppercase bounded KDNA
error code when present. `KDNAUploadError.response` and
`KDNALoadError.response` remain `null` for compatibility; they never contain a
`Response` object or parsed server payload.

---

## HTTPS requirement

This package uses the `fetch` API. In production, all requests
should travel over HTTPS. Browsers enforce this for mixed-content
requests on HTTPS pages; on HTTP pages, no enforcement occurs.

Ensure your server is accessible over HTTPS in production.

---

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md).
