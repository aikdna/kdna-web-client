# Contributing to kdna-web-client

## Issues

Open an issue at the repository. Include:

- Browser and version
- Bundler and version (webpack, Vite, Rollup, etc.)
- Minimal reproduction steps
- Expected vs actual behavior

If proposing a feature, tag the issue `[RFC]` and describe the problem
before the solution.

## Pull Requests

1. Fork and branch from `main`.
2. Keep PRs focused — one logical change per PR.
3. All commits must be signed off: `git commit -s`
4. Title format: `area: what changed`
5. Verify before opening:
   - `npm test` passes
   - `npm run build` produces a valid browser bundle
   - Bundle size is checked: `npm run size`

## Security Issues

Do **not** report security vulnerabilities through public GitHub issues.
See [SECURITY.md](./SECURITY.md) for the private reporting path.

## Developer Certificate of Origin (DCO)

All commits must include a `Signed-off-by:` line.
Use `git commit -s` to add it automatically. No CLA is required.

## Security Constraints (Non-Negotiable)

Contributions that violate the following will be rejected:

- This package **must not** perform decryption of any kind.
- This package **must not** store passwords, raw license keys, or signed
  entitlement records in object properties, module-level variables,
  browser storage, or caches.
- The current API accepts no credentials or activation input. Explicit Read
  sends only the selected asset bytes and the caller's bounded public request;
  ambient Fetch credentials, redirects and retries remain disabled.
- This package **must not** include Node.js built-in modules (`fs`,
  `crypto`, `path`, etc.) in the browser bundle.
- This adapter delegates selected-byte admission to public Core/browser and
  response admission to public Read/transport. Do not add another ZIP, payload,
  schema or protocol parser. Core-owned interpretation stays in the bound
  public dependency; the client returns only its documented selection and view.
- Preserve bounded safe-text presentation and the official remote proof limits.
  Selection, a successful response and delivery metadata grant no action authority.

A proposal involving decryption, credentials or licensing requires a separate
versioned upstream contract decision. The current Web Server also does not
provide those unavailable capabilities.
