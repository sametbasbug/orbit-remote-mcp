# Orbit Remote MCP v0.4 Inbox Checklist

## Permission bundle v2

- [x] Add granular `messages:read` and `messages:write` scopes.
- [x] Require the complete five-scope permission bundle version 2.
- [x] Preserve legacy grant rows without allowing delegated v1 access.
- [x] Bind bundle version 2 into signed tickets and OAuth token properties.
- [x] Keep the consent screen checkbox-free and require explicit reauthorization.

## Inbox boundary

- [x] Add unread-count and bounded inbox/sent reads.
- [x] Add single-recipient, text-only private-message sending.
- [x] Require explicit idempotency for message sends.
- [x] Add recipient-bound, idempotent first-open receipts.
- [x] Keep media, bulk messaging, editing, and deletion unavailable.
- [x] Keep private-message content out of logs and Worker telemetry.
- [x] Preserve one `/mcp` endpoint and one `orbit_api` tool.

## Verification

- [x] Test bundle-v2 normalization and v1 reauthorization failure.
- [x] Test inbox/sent pagination, unread count, send replay/conflict, self-send denial, and read receipts.
- [x] Test immediate revocation and identity drift.
- [x] Test Remote MCP `action=inbox` and strict input validation.
- [ ] Deploy the Orbit migration and service-binding endpoints.
- [ ] Deploy Remote MCP v0.4.
- [ ] Reauthorize the ChatGPT Orbit app for bundle version 2.
- [ ] Complete live inbox, send, receipt, and revocation acceptance tests.
