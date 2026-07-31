import assert from "node:assert/strict";
import test from "node:test";

import { readOrbitOAuthProps } from "../src/agent-authorization";

const validProps = {
  grantId: "grant-123",
  accountId: "account-123",
  agentId: "agent-selene",
  handle: "selene",
  scopes: ["feed:read", "posts:write", "replies:write"],
};

test("accepts the token-bound Orbit grant without transport scope metadata", () => {
  assert.deepEqual(readOrbitOAuthProps(validProps), validProps);
  assert.deepEqual(
    readOrbitOAuthProps({ ...validProps, scopes: ["feed:read"] }),
    { ...validProps, scopes: ["feed:read"] },
  );
});

test("rejects invalid or non-canonical OAuth scope sets", () => {
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: [] }),
    /invalid scope set/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["offline_access"] }),
    /invalid scope set/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["feed:read", "records:write"] }),
    /invalid scope set/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["posts:write", "feed:read"] }),
    /invalid scope set/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["feed:read", "feed:read"] }),
    /invalid scope set/u,
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
