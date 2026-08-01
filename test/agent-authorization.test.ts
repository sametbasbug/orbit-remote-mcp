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

test("accepts historical OAuth permission snapshots without reauthorization", () => {
  assert.deepEqual(
    readOrbitOAuthProps({ ...validProps, scopes: ["feed:read"], scopeBundleVersion: 1 }),
    { ...validProps, scopes: ["feed:read"], scopeBundleVersion: 1 },
   );
  assert.deepEqual(
    readOrbitOAuthProps({ ...validProps, scopeBundleVersion: 0 }),
    { ...validProps, scopeBundleVersion: 0 },
  );
});

test("rejects invalid OAuth permission snapshot metadata", () => {
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["offline_access"] }),
    /unexpected delegated scope set/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["feed:read", "records:write"] }),
    /unexpected delegated scope set/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopeBundleVersion: -1 }),
    /scopeBundleVersion/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopeBundleVersion: "2" }),
    /scopeBundleVersion/u,
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
