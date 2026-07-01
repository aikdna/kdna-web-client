# Security model

This document describes what `@aikdna/kdna-web-client` reads, stores,
and transmits, and what it explicitly does not do.

---

## What this package does

| Operation | How |
|-----------|-----|
| Read public metadata | Parses the `.kdna` file header in-memory using the File API |
| Upload a file to the server | `fetch` POST with `multipart/form-data` |
| Drive the load-plan flow | `fetch` POST to `/plan-load` and `/load` |
| Forward credentials to `/load` | Single `fetch` POST — credentials not stored |

---

## What this package never does

- **No decryption.** The package does not attempt to decrypt any part
  of the `.kdna` payload, even if it has access to a password.
- **No credential storage.** Passwords and license keys are arguments
  to `manager.load()`. They are POSTed to the server and then garbage
  collected with the call frame. They are never assigned to a property
  on a long-lived object.
- **No Node.js built-ins.** The browser bundle contains no `fs`,
  `crypto`, `path`, `Buffer`, or `process` references. It runs in a
  standard browser environment.
- **No local payload parsing.** File bytes beyond the public header are
  forwarded to the server as-is. This package does not attempt to
  decode, deserialize, or display payload content.

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

`readKDNAMetadata(file)` reads only the header bytes needed to
identify the format version and extract public manifest fields.
It does not read the full file into memory.

`uploadKDNA(file, endpoint)` sends the full file bytes to the server
endpoint using the `fetch` API. The bytes are not retained after the
upload completes.

---

## HTTPS requirement

This package uses the `fetch` API. In production, all requests
should travel over HTTPS. Browsers enforce this for mixed-content
requests on HTTPS pages; on HTTP pages, no enforcement occurs.

Ensure your server is accessible over HTTPS in production.

---

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md).
