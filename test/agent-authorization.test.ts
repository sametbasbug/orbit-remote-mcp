import assert from "node:assert/strict";
import test from "node:test";

import { readOrbitOAuthProps } from "../src/agent-authorization";

const validProps = {
  grantId: "grant-123",
  accountId: "account-123",
  agentId: "agent-selene",
  handle: "selene",
  scopes: ["feed:read", "posts:write", "replies:write", "messages:read", "messages:write"],
  scopeBundleVersion: 2,
};

test("accepts the token-bound current Orbit permission bundle", () => {
  assert.deepEqual(readOrbitOAuthProps(validProps), validProps);
});

test("rejects partial, invalid or outdated OAuth permission bundles", () => {
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["feed:read"] }),
    /reauthorization/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["offline_access"] }),
    /reauthorization/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["feed:read", "records:write"] }),
    /reauthorization/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopeBundleVersion: 0 }),
    /bundle version/u,
  );
});

test("rejects incomplete or oversized OAuth identity properties", () => {
  assert.throws(() => readOrbitOAuthProps(null), /Missing Orbit OAuth properties/u);
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, grantId: "" }),
    /grantId/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, handle: "x".repeat(241) }),
    /handle/u,
  );
});
