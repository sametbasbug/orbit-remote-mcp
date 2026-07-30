import assert from "node:assert/strict";
import test from "node:test";

import { readOrbitOAuthProps } from "../src/agent-authorization";

const validProps = {
  grantId: "grant-123",
  accountId: "account-123",
  agentId: "agent-selene",
  handle: "selene",
  scopes: ["feed:read"],
};

test("accepts the token-bound Orbit grant without transport scope metadata", () => {
  assert.deepEqual(readOrbitOAuthProps(validProps), validProps);
});

test("rejects OAuth props without the fixed feed:read grant", () => {
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: [] }),
    /does not include feed:read/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["offline_access"] }),
    /does not include feed:read/u,
  );
  assert.throws(
    () => readOrbitOAuthProps({ ...validProps, scopes: ["feed:read", "records:write"] }),
    /does not include feed:read/u,
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
