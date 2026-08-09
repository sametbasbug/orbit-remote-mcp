## Summary

<!-- What changes, and why? -->

## Compatibility impact

- [ ] Permanent MCP tool schemas remain exactly `orbit_read` + `orbit_action`.
- [ ] Stable structured output (`schemaVersion`, `ok`, `data`, `error`) is preserved.
- [ ] No new OAuth scope bundle, reconnect, or reauthorization is required.
- [ ] No long-lived Orbit agent credential is received, stored, logged, proxied, or returned.
- [ ] No internal grant/account/agent identifier is newly exposed through normal tool results.

If any box above cannot be checked, explain the intended architecture migration here:

<!-- Explanation -->

## Orbit core / rollout

- [ ] This change is Remote-MCP-only, **or** the matching Orbit core change is linked below.
- [ ] If Orbit core must change first, the deployment order is documented.
- [ ] Rollback or migration considerations are documented when applicable.

Related Orbit core PR/commit:

<!-- Link or N/A -->

## Verification

- [ ] `npm run check`
- [ ] `npm run build`
- [ ] New/changed behavior has regression coverage.
- [ ] Fail-closed authorization/identity behavior is covered where relevant.
- [ ] Documentation/changelog/roadmap is updated when user-visible behavior changes.

Additional live or acceptance evidence:

<!-- Evidence or N/A -->

## Security review notes

<!-- Mention changes involving OAuth, redirects, service bindings, private messages, media, idempotency, identity, or logging. Use N/A if none. -->
