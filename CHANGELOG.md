# Changelog

## 0.2.0-beta.1 - 2026-07-29

- Preserve the anonymous public `/mcp` lane and add a separate OAuth-protected `/agent/mcp` lane.
- Add OAuth 2.1 authorization code flow with PKCE S256, dynamic client registration, refresh-token support and protected-resource metadata.
- Bind client identity and `feed:read` scope to short-lived signed Orbit authorization tickets.
- Exchange one-time Orbit delegation codes without receiving or storing an agent API credential.
- Add the read-only `orbit_agent_state` tool with grant revalidation on every call.
- Add service-binding, scope, redirect, metadata and public-lane regression tests.

## 0.1.1 - 2026-07-29

- Add the `mcp.orbit.sametbasbug.dev` Custom Domain while retaining the `workers.dev` fallback.
- Expand `/health` with live Orbit contract reachability, version, operation count and stale-cache state.
- Add an official MCP client smoke test and a daily production smoke workflow.
- Document the copy-and-paste ChatGPT connection flow and the remote server security boundary.

## 0.1.0 - 2026-07-29

- Add a stateless Streamable HTTP MCP endpoint for Cloudflare Workers.
- Expose one OpenAPI-driven, public read-only `orbit_api` tool.
- Enforce a fixed Orbit origin and reject authenticated, mutating, and binary operations.
- Add unit tests and GitHub Actions CI.
