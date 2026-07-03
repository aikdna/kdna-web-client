# @aikdna/kdna-web-client

**Browser-safe KDNA utilities.**

File selection, metadata inspection, upload to your server, and
load-plan state management — without ever performing decryption in
the browser.

> **Design constraint:** this package never decrypts anything. It reads
> public metadata from a `.kdna` file and delegates all sensitive
> operations to a server running
> [@aikdna/kdna-web-server](https://github.com/aikdna/kdna-web-server).

> New to KDNA? → [KDNA Core](https://github.com/aikdna/kdna)
>
> Need a server-side adapter? →
> [@aikdna/kdna-web-server](https://github.com/aikdna/kdna-web-server)
>
> Need React components? →
> [@aikdna/kdna-react](https://github.com/aikdna/kdna-react)

[![npm](https://img.shields.io/npm/v/@aikdna/kdna-web-client)](https://www.npmjs.com/package/@aikdna/kdna-web-client)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

---

## Install

```bash
npm install @aikdna/kdna-web-client
```

No peer dependencies. No Node.js built-ins in the browser bundle.

---

## Quick start

```js
import { readKDNAMetadata, uploadKDNA, KDNALoadPlanManager } from '@aikdna/kdna-web-client'

// 1. Let the user pick a file
const input = document.createElement('input')
input.type = 'file'
input.accept = '.kdna'
input.onchange = async () => {
  const file = input.files[0]

  // 2. Read public metadata (no server round-trip, no decryption)
  const meta = await readKDNAMetadata(file)
  console.log(meta.domain, meta.version, meta.encrypted)

  // 3. Upload to your server and get a fileId
  const { fileId } = await uploadKDNA(file, '/api/kdna/inspect')

  // 4. Manage the load-plan flow
  const manager = new KDNALoadPlanManager('/api/kdna')
  const plan = await manager.planLoad(fileId)

  if (plan.canProceed) {
    const result = await manager.load(fileId, { profile: 'compact' })
    console.log(result.content)
  } else {
    console.log('Missing:', plan.missing)  // e.g. ['password']
  }
}
input.click()
```

---

## API reference

### `readKDNAMetadata(file)`

Reads public manifest fields from a `.kdna` `File` object without
uploading it or performing any decryption.

```js
const meta = await readKDNAMetadata(file, {
  maxSizeBytes: 10 * 1024 * 1024,
})
```

Returns:

```ts
{
  domain:      string         // e.g. "@author/asset-name"
  version:     string         // e.g. "1.2.0"
  title:       string | null
  description: string | null
  encrypted:   boolean
  profiles:    string[]       // available load profiles
  fileSize:    number         // bytes
}
```

Throws `KDNAFileSizeError` if `maxSizeBytes` is set and the file is too large.
Throws `KDNAFormatError` if the file is not a valid `.kdna` container.

---

### `uploadKDNA(file, endpoint)`

Upload a `.kdna` `File` to an endpoint (typically
`/api/kdna/inspect`) and return the `fileId` assigned by the server.

```js
const { fileId, inspect } = await uploadKDNA(file, '/api/kdna/inspect')
```

Returns:

```ts
{
  fileId:   string    // opaque ID — pass to plan-load and load
  inspect:  object    // the full /inspect response
}
```

Throws `KDNAUploadError` if the request fails or the server returns
a non-200 status.

---

### `KDNALoadPlanManager`

Stateful class that drives the load-plan flow for a single file.

```js
const manager = new KDNALoadPlanManager(baseUrl)
```

| Method | Description |
|--------|-------------|
| `planLoad(fileId, context?)` | Evaluate the LoadPlan. Returns requirements. |
| `load(fileId, options)` | Load the asset. Credentials are passed directly. |

#### `planLoad(fileId, context?)`

```js
const plan = await manager.planLoad('abc123', {
  hasPassword: false,
  hasLicenseKey: false,
})
```

Returns:

```ts
{
  canProceed:   boolean
  missing:      string[]    // e.g. ['password']
  requirements: {
    password:   { required: boolean, hint: string | null }
    licenseKey: { required: boolean }
  }
}
```

#### `load(fileId, options)`

```js
const result = await manager.load('abc123', {
  profile:          'compact',
  password:         '...',   // only if required
  licenseKey:       '...',   // only if required
  entitlementToken: '...',   // only if required
})
```

Returns the `/load` response from the server:

```ts
{
  domain:   string
  version:  string
  profile:  string
  content:  string
}
```

---

### `KDNAFileSizeError`

Thrown by `readKDNAMetadata` when the file exceeds the configured
maximum size.

### `KDNAFormatError`

Thrown by `readKDNAMetadata` when the file does not have a valid
`.kdna` header.

### `KDNAUploadError`

Thrown by `uploadKDNA` when the HTTP request fails.

---

## Security model

See [docs/security-model.md](./docs/security-model.md).

Short version:

- This package reads the local `.kdna` file in memory to inspect the ZIP
  directory and public `kdna.json` manifest. It does not attempt to parse or
  decrypt payload entries.
- Passwords and license keys are passed as arguments to `manager.load()`
  and are POSTed directly to the server endpoint. They are not stored
  in any object property or module-level variable.
- This package has no Node.js built-in dependencies. It runs entirely
  within the browser's security model.

---

## Related packages

| Package | Role |
|---------|------|
| [`@aikdna/kdna-core`](https://github.com/aikdna/kdna) | KDNA format and runtime (Node.js) |
| [`@aikdna/kdna-web-server`](https://github.com/aikdna/kdna-web-server) | Server-side adapter |
| [`@aikdna/kdna-react`](https://github.com/aikdna/kdna-react) | React components and hooks |
| [`create-kdna-web-app`](https://github.com/aikdna/create-kdna-web-app) | Project scaffolding CLI |

---

## License

Apache 2.0 — see [LICENSE](./LICENSE).
