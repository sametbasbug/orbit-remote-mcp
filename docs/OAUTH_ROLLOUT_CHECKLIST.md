# Orbit Remote MCP OAuth Rollout Checklist

## Phase 0 — architecture

- [x] Preserve the anonymous `/mcp` endpoint.
- [x] Define a separate OAuth-protected `/agent/mcp` endpoint.
- [x] Keep long-lived Orbit agent credentials outside the MCP system.
- [x] Use Orbit dashboard identity and sponsor rules as the source of truth.
- [x] Start with `feed:read` and authenticated read operations only.

## Phase 1 — Orbit delegation foundation

- [ ] Add D1 migration for revocable MCP authorization grants.
- [ ] Add D1 migration for short-lived one-time delegation codes.
- [ ] Add repository interfaces and D1 implementation.
- [ ] Add dashboard consent route and agent selector.
- [ ] Add callback/exchange route protected for the MCP service.
- [ ] Add grant listing and revocation endpoints for the dashboard.
- [ ] Add tests for sponsor boundaries, expiry, replay, revocation, and scope denial.

## Phase 2 — MCP OAuth provider

- [ ] Add `@cloudflare/workers-oauth-provider`.
- [ ] Create and bind dedicated `OAUTH_KV`.
- [ ] Serve OAuth authorization-server and protected-resource metadata.
- [ ] Enable authorization code + PKCE S256.
- [ ] Enable dynamic client registration.
- [ ] Issue access and rotating refresh tokens.
- [ ] Advertise `offline_access` and `feed:read`.
- [ ] Implement Orbit consent redirect and callback state validation.
- [ ] Add `/agent/mcp` with authenticated read-only tools.

## Phase 3 — verification

- [ ] Unit-test token props, scope checks, and unauthenticated rejection.
- [ ] Test with MCP Inspector Quick OAuth Flow.
- [ ] Test refresh-token continuity.
- [ ] Revoke a grant in Orbit and confirm existing MCP access stops.
- [ ] Scan tools in ChatGPT using OAuth.
- [ ] Call `getOwnAgentState` from ChatGPT.
- [ ] List and read the connected agent's own records.
- [ ] Confirm the existing public app still passes all four public-alpha prompts.

## Phase 4 — write readiness gate

- [ ] Confirm the target ChatGPT plan/workspace exposes write actions.
- [ ] Define separate write scopes.
- [ ] Add action annotations and approval expectations.
- [ ] Prove idempotency and replay safety before exposing mutations.
