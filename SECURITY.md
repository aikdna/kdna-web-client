# Security Policy

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, use one of these private channels:

- **GitHub Private Vulnerability Reporting**: Go to the [Security Advisories](https://github.com/aikdna/kdna-web-client/security/advisories/new) page
- **Email**: security@aikdna.com

We aim to respond within 72 hours and provide a timeline for resolution within
1 week. Please do not disclose the vulnerability publicly until we have had a
chance to address it.

## Supported Versions

`kdna-web-client` is a pre-release browser utility support surface. Until the
first stable package release, security support tracks the latest mainline
pre-release and the canonical KDNA protocol/runtime surfaces.

| Component | Supported Versions |
|-----------|--------------------|
| KDNA Core (`@aikdna/kdna-core`) | 0.22.0 |
| KDNA Web Server (`@aikdna/kdna-web-server`) | 0.3.1 |
| KDNA Web Client (`@aikdna/kdna-web-client`) | 0.3.0 |

Those three coordinates are the releases published to the npm registry as of
2026-09-14. The source candidate in this repository
(`0.5.0-rc.component-semantics.1`) binds Core
`0.24.0-rc.component-semantics.2` and Read
`0.3.0-rc.component-semantics.2`; that version tuple has not been published and
is not an npm-registry installation coordinate. Source development and
explicit local-archive consumption are described in
[Getting started](https://github.com/aikdna/kdna-web-client/blob/main/docs/getting-started.md); the current candidate does not
provide compatibility with the earlier released API. Matching version labels alone do not
identify the tested graph — the exact archive identities are recorded in
[`docs/current-core-read-binding.json`](./docs/current-core-read-binding.json).

Older released versions may receive critical security patches on a
case-by-case basis.

## Security Model

`kdna-web-client` provides browser-safe file selection and a remote Read
consumer. It delegates container admission to the exact pinned public
Core/browser dependency and remote response admission to the exact pinned
public Read/transport dependency. It carries no independent protocol
validator or raw-payload parser.

Selection and endpoint/session bindings are explicit. Local selection objects
are opaque capabilities of this client module and cannot be forged by copying
their visible fields. A remote view preserves the official receiver's proof
limits and does not create a Core snapshot, admitted request, Host witness,
authorization or action capability. Remote identity, authorization, current
revocation, receipt delivery and network replay remain unproven. `read` does
not expose raw HTTP framing; display remote strings with safe text APIs.

Use an `AbortSignal`, dispose the client, and release selections when finished.
Credentials are omitted and redirects are rejected. No license key, activation
endpoint, implicit provider, retry or server fallback is implemented. Custom
`fetch` implementations are application-owned: logical cancellation prevents
late publication, while an uncooperative `fetch` keeps its bounded concurrency
slot until it settles.

A report should include the exact package version, the exact dependency
archive digests, reproduction steps and observed impact. Do not attach private
assets, tokens, raw license keys or secret response bodies. For the KDNA
Protocol security architecture, see
[GOVERNANCE.md](https://github.com/aikdna/kdna/blob/main/docs/GOVERNANCE.md)
in the main protocol repository.
