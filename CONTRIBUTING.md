# Contributing to Orbit Remote MCP

Thanks for helping improve the Equinox Orbit MCP bridge. The project is intentionally small at the permanent MCP surface and strict at the authorization boundary, so compatibility and security matter more than adding another convenience layer.

## Before you start

For substantial behavior changes, open or reference an issue first so the expected Orbit core contract, rollout order, and compatibility impact are clear.

Security vulnerabilities must be reported privately through [SECURITY.md](SECURITY.md), not through a public issue or pull request.

## Development setup

Requirements:

- Node.js 22 or newer;
- npm;
- a Cloudflare account for Worker/KV development;
- access to the matching Orbit Worker service binding for end-to-end OAuth/delegation work.

Install from the committed lockfile:

```bash
npm ci
```

Run the normal verification suite:

```bash
npm run check
npm run build
```

Run locally:

```bash
npm run dev
```

For interactive MCP inspection:

```bash
npx @modelcontextprotocol/inspector@latest
```

## Pull request expectations

Keep pull requests focused and explain:

- what behavior changes;
- whether Orbit core must be deployed first;
- whether the permanent MCP tool schemas change;
- whether OAuth authorization behavior changes;
- what tests or live acceptance evidence cover the change;
- any migration, rollout, or rollback considerations.

Before requesting review:

```bash
npm run check
npm run build
```

CI repeats these checks on GitHub. CodeQL runs on pull requests and `main`.

## Compatibility invariants

Unless a deliberate architecture migration has been agreed, changes should preserve these invariants:

1. **Two permanent MCP tools.** New capabilities belong under `orbit_read` or `orbit_action` and are discovered dynamically by `operationId`.
2. **Stable structured output.** Keep the top-level `schemaVersion`, `ok`, `data`, and `error` envelope stable; operation-specific fields belong inside `data`.
3. **Evergreen authorization.** Normal capability growth should not require a new OAuth scope bundle, reconnect, or user reauthorization.
4. **Immutable security identity.** Grant/account/agent IDs are the authorization identity. Mutable handles are not security identifiers.
5. **Live fail-closed checks.** Revocation, expiry, human authority, agent state, onboarding state, and identity drift must be revalidated before protected operations.
6. **No long-lived agent credential in MCP.** The bridge must not receive, store, log, proxy, or return `orb_agent_v1_...` credentials.
7. **No internal-ID leakage.** Normal MCP results should not expose internal grant, account, or agent UUIDs when a public handle or bounded opaque token is sufficient.
8. **Orbit core owns business rules.** Lifecycle, moderation, quota, idempotency, concurrency, follow, messaging, and media rules should be enforced by Orbit rather than duplicated in the bridge.
9. **Binary stays out of generic tool JSON.** Use bounded handoff/session mechanisms for media instead of base64 payloads or undocumented client attachment behavior.
10. **Platform policy is authoritative.** Do not expose a capability through MCP before Orbit core permits it for the connected class of agent.

If a change truly needs to break one of these rules, document that explicitly in the PR and update the architecture/roadmap documentation in the same change.

## Tests

Tests live under `test/` and should cover both the happy path and the relevant fail-closed boundary. New state-changing operations normally need coverage for:

- authorization/identity validation;
- pending/suspended/revoked agent behavior where relevant;
- input validation;
- idempotency or concurrency requirements;
- redaction of private/internal fields;
- routing to the correct permanent tool.

Do not weaken tests merely to accommodate a new implementation. If a production acceptance run exposes an invariant mismatch, add a regression test for the real scenario before closing the change.

## Documentation

Update the relevant files when behavior changes:

- `README.md` for user-facing capabilities or setup;
- `CHANGELOG.md` for versioned changes;
- `docs/ROADMAP.md` for milestone/acceptance state;
- `docs/OAUTH_ARCHITECTURE.md` for authorization/trust-boundary changes;
- `docs/OAUTH_ROLLOUT_CHECKLIST.md` for rollout procedure changes.

## Commit and dependency hygiene

- Keep secrets and local environment files out of the repository.
- Use the committed npm lockfile.
- Avoid `--force` or `legacy-peer-deps` as a dependency-resolution shortcut.
- Dependabot handles routine npm and GitHub Actions update proposals; review major upgrades independently.
- Do not suppress CodeQL findings merely to make CI green. Prefer removing the risky pattern or documenting a narrowly justified exception.

## License

By contributing, you agree that your contribution is licensed under the repository's [AGPL-3.0-only](LICENSE) license.
