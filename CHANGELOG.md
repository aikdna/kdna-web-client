# Changelog

## Unreleased

- Replace the non-exported compatibility viewer with a browser-safe current
  JudgmentTrace parser, evidence projection, and dependency-free DOM renderer.
- Add package-root TypeScript declarations for the complete public surface.
- Align Runtime Capsule examples and tests with the current Core contract.

## 0.2.0 (2026-07-13)

- Accept only the single current KDNA media type and required container entries.
- Keep browser inspection limited to public manifest metadata.
- Document the server-produced Runtime Capsule as the Agent-facing load result.

## 0.1.1 (2026-07-03)

- Normalize `repository.url` metadata for npm.
- Add a lightweight lint script to the package CI path.
- Use a CI-portable test glob.
- Keep test file construction compatible with Node 18 and 20.
- Add `prepublishOnly` release protection.

## 0.1.0 (2026-07-03)

Initial public release of the KDNA web client.

- Browser-safe metadata inspection for `.kdna` assets
- Upload and load management (LoadPlan, load state)
- `@aikdna/kdna-web-client` scoped npm package
- Getting started docs and security model documentation
