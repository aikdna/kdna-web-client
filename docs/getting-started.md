# Getting started with @aikdna/kdna-web-client

---

## Prerequisites

- A browser environment or a bundler that targets the browser
  (Vite, webpack, Parcel, etc.)
- A server running `@aikdna/kdna-web-server` (or equivalent KDNA
  API endpoints)

---

## Step 1 — Install

```bash
npm install @aikdna/kdna-web-client
```

---

## Step 2 — Read metadata before uploading

```js
import { readKDNAMetadata } from '@aikdna/kdna-web-client'

async function onFileSelected(file) {
  try {
    const meta = await readKDNAMetadata(file)
    console.log(`Asset: ${meta.domain} ${meta.version}`)
    console.log(`Encrypted: ${meta.encrypted}`)
    console.log(`Profiles: ${meta.profiles.join(', ')}`)
  } catch (err) {
    console.error('Not a valid .kdna file:', err.message)
  }
}
```

This runs entirely in the browser — no server round-trip, no
decryption.

---

## Step 3 — Upload and inspect

```js
import { uploadKDNA } from '@aikdna/kdna-web-client'

const { fileId, inspect } = await uploadKDNA(file, '/api/kdna/inspect')
console.log('File ID:', fileId)
console.log('Load-plan mode:', inspect.loadPlan.mode)
```

---

## Step 4 — Check the load plan

```js
import { KDNALoadPlanManager } from '@aikdna/kdna-web-client'

const manager = new KDNALoadPlanManager('/api/kdna')
const plan = await manager.planLoad(fileId)

if (plan.canProceed) {
  // No credentials needed — load directly
  const result = await manager.load(fileId, { profile: 'compact' })
  console.log(result.content)
} else {
  // Ask the user for what is missing
  console.log('Requires:', plan.missing)
}
```

---

## Step 5 — Load with credentials (password-protected asset)

```js
const password = prompt('Enter the asset password:')
const result = await manager.load(fileId, {
  profile: 'compact',
  password,
})
console.log(result.content)
```

The password is sent directly to the server in a single POST request
and is not stored anywhere in the browser.

---

## Next steps

- [API reference](../README.md#api-reference)
- [Security model](./security-model.md)
- [React components](https://github.com/aikdna/kdna-react) —
  pre-built UI for file picking, password dialogs, and load-plan state
