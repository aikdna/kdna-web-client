# Changelog

## 0.2.2 (2026-07-18)

- Derive the browser `asset_id` grammar from the pinned KDNA Core schema
  closure instead of maintaining a narrower hand-written expression.
- Preserve valid multi-segment, mixed-case, dotted, and underscored asset IDs
  in public inspect and LoadPlan projections while continuing to null invalid
  identities.
- Fail validator generation when Core's Runtime Capsule, Consumption Plan, and
  JudgmentTrace schemas disagree about asset identity syntax.

## 0.2.1 (2026-07-18)

- Replace the non-exported compatibility viewer with a browser-safe current
  JudgmentTrace parser, evidence projection, and dependency-free DOM renderer.
- Add package-root TypeScript declarations for the complete public surface.
- Align Runtime Capsule examples and tests with the current Core contract.
- Generate browser validators from the pinned Core schema closure, validate
  Runtime Capsules at `load()`, and reject hostile nested trace mutations.
- Bound ZIP metadata and JSON response parsing, reject malformed container
  structure, and align the default browser file limit with the Web Server.
- Project successful HTTP responses to documented public fields and prevent
  upstream messages, bodies, paths, and provider details from entering errors.
- Exercise the exact Web Server 0.3.0 and Core 0.20.0 packages with the accepted
  Laozi 0.1.1 asset across pinned Node.js releases.
- Bind stable publication to an immutable release-only workflow, exact natural
  SemVer coordinate, exact dependency graph, and strict CHANGELOG entry.

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
