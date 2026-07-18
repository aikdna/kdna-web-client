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
- This package may POST passwords and signed entitlement records directly
  to compatible server endpoints for a single in-flight load request.
  Raw license keys must travel only to an activation endpoint, never to
  `/load`.
- This package **must not** include Node.js built-in modules (`fs`,
  `crypto`, `path`, etc.) in the browser bundle.
- The browser may buffer the bounded container to locate ZIP metadata, but it
  decodes only `mimetype` and public `kdna.json`. Payload bytes are never
  deserialized or interpreted client-side and are forwarded only by the
  explicit upload call.

If a proposed feature requires decryption or license verification,
it belongs in `@aikdna/kdna-web-server`, not here.
