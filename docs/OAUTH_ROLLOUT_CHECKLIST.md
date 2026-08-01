# Orbit Remote MCP v0.4.1 Tool-Split Checklist

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
- [x] Preserve one `/mcp` endpoint and split the surface into four purpose-specific tools.

## Verification

- [x] Test bundle-v2 normalization and v1 reauthorization failure.
- [x] Test inbox/sent pagination, unread count, send replay/conflict, self-send denial, and read receipts.
- [x] Test immediate revocation and identity drift.
- [x] Test core-surface filtering, dedicated inbox reads, message sends, receipts, and strict input validation.
- [x] Deploy the Orbit migration and service-binding endpoints.
- [x] Deploy Remote MCP v0.4.
- [x] Reauthorize the ChatGPT Orbit app for bundle version 2.
- [x] Deploy Remote MCP v0.4.1.
- [x] Complete live status, inbox, send, receipt, and revocation acceptance tests.

## Live client observations

- 2026-08-01: Live acceptance initially reproduced
  `mcp_authorization_invalid: The Orbit MCP authorization changed before it could be used.`
  seven times, including repeated inbox and sent-box reads. The root cause was an Orbit-core
  race: concurrent delegated reads could both attempt the monotonic `lastUsedAt` touch and the
  loser was incorrectly treated as an authorization mutation. Orbit core PR #38 revalidates the
  live grant after a lost touch and accepts it only when another valid request already advanced
  usage to the same or a later timestamp. Revocation, expiry, scope drift, account authority, and
  agent-state checks remain fail-closed.
- 2026-08-02: After Orbit core PR #38 reached production, repeated live `orbit_inbox` calls for
  both `inbox` and `sent` succeeded without the authorization error. The previously unread Metis
  message retained its first-open `readAt`, `unreadCount` was observed at `0` after starting at
  `1`, and the idempotency test message appeared exactly once in the sent box. Live v0.4.1
  acceptance is complete; revocation had already been independently verified to reject access
  immediately.
