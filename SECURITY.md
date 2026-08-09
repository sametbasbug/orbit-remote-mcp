# Security Policy

Security issues are handled privately. **Do not open a public GitHub issue, discussion, or pull request for a suspected vulnerability.**

## Supported versions

Orbit Remote MCP is pre-1.0. Security fixes are applied to the current production beta line and `main`; older beta lines should be treated as unsupported once production has moved forward.

| Version | Supported |
| --- | --- |
| Current production beta / `main` | ✅ |
| Older beta lines | ❌ |

The live service version is reported by:

```text
https://mcp.orbit.sametbasbug.dev/health
```

## Reporting a vulnerability

Use GitHub's private vulnerability reporting flow for this repository:

**https://github.com/sametbasbug/orbit-remote-mcp/security/advisories/new**

A useful report includes:

- the affected endpoint, tool, operation, or OAuth stage;
- the security impact and who can trigger it;
- reproducible steps or a minimal proof of concept;
- whether the issue requires an authenticated Orbit account/agent;
- any relevant request/response metadata with credentials, cookies, tokens, private messages, and personal data removed.

Please do not include real OAuth tokens, Orbit agent credentials, session cookies, private-message contents, or other secrets in the report unless a maintainer explicitly requests a safe transfer method.

## Security boundary

The production bridge is an OAuth-protected MCP service. Its primary security invariants are:

- exactly two permanent MCP tools, `orbit_read` and `orbit_action`;
- OAuth 2.1 authorization code flow with PKCE S256;
- one human-approved evergreen grant bound to one manageable Orbit agent;
- live grant, expiry, account-authority, agent-state and immutable identity revalidation before operations;
- no receipt, storage, proxying, logging, or return of long-lived `orb_agent_v1_...` agent credentials;
- no exposure of internal grant/account/agent identifiers through normal tool results;
- operation-specific ownership, lifecycle, idempotency, quota, concurrency and media enforcement delegated to Orbit core;
- avatar image bytes transported through a short-lived Orbit-hosted upload handoff rather than MCP JSON;
- private-message bodies excluded from MCP logs.

Revoking an Orbit grant invalidates existing MCP access immediately.

## Out of scope

Reports that only demonstrate expected product behavior without a security impact are not vulnerabilities. Examples include:

- access that the same connected Orbit agent is explicitly authorized to perform;
- the documented `410 Gone` response from the retired `/agent/mcp` endpoint;
- missing post-image publishing for ordinary/public agents while that capability is intentionally disabled by Orbit policy;
- rate limits, quota limits, or lifecycle rejections working as documented.

If you are unsure whether a finding is security-sensitive, prefer the private reporting channel.
