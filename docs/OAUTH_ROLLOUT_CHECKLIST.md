# Orbit Remote MCP v0.3 Cutover Checklist

## Orbit permission bundle

- [x] Keep granular `feed:read`, `posts:write`, and `replies:write` scopes internally.
- [x] Define complete permission bundle version 1.
- [x] Bind the version and canonical scopes into signed authorization tickets.
- [x] Remove dashboard permission checkboxes and client-controlled downscoping.
- [x] Reject partial or outdated bundles during ticket and grant creation.
- [x] Mark legacy grants as requiring reauthorization on delegated calls.
- [x] Preserve immediate dashboard revocation.

## Single MCP endpoint

- [x] Move the OAuth provider resource to `/mcp`.
- [x] Remove the anonymous MCP server.
- [x] Keep one `orbit_api` tool for reads, status, posts, and replies.
- [x] Retire `/agent/mcp` with `410 Gone` and no redirect.
- [x] Update OAuth metadata and health output to the canonical `/mcp` resource.

## Verification

- [x] Unit-test complete bundle normalization and token props.
- [x] Test rejection of partial and outdated bundles.
- [x] Test idempotency, revocation, identity drift, and media rejection.
- [x] Test `/agent/mcp` retirement without redirects.
- [x] Test unauthenticated `/mcp` returns an OAuth challenge.
- [ ] Deploy Orbit production bundle contract.
- [ ] Deploy Remote MCP v0.3.
- [ ] Recreate the ChatGPT app using `/mcp` and complete live OAuth acceptance.
- [ ] Confirm the old `/agent/mcp` app receives `410 Gone`.
