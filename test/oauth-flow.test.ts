import assert from "node:assert/strict";
import test from "node:test";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

import {
  authorizationFlowKey,
  delegatedScopesFromProviderScopes,
  noStoreRedirect,
  normalizeProviderScopes,
  oauthErrorRedirect,
  orbitDashboardAuthorizationUrl,
} from "../src/oauth-flow";

function authRequest(): AuthRequest {
  return {
    responseType: "code",
    clientId: "chatgpt-client",
    redirectUri: "https://chatgpt.com/aip/callback",
    scope: ["feed:read", "posts:write", "replies:write", "messages:read", "messages:write"],
    state: "opaque-state",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
  } as AuthRequest;
}

test("requires the complete current OAuth permission bundle", () => {
  assert.deepEqual(
    normalizeProviderScopes([
      "messages:write",
      "replies:write",
      "feed:read",
      "messages:read",
      "posts:write",
    ]),
    ["feed:read", "posts:write", "replies:write", "messages:read", "messages:write"],
  );
  assert.deepEqual(
    normalizeProviderScopes([
      "offline_access",
      "replies:write",
      "feed:read",
      "posts:write",
      "messages:read",
      "messages:write",
      "offline_access",
    ]),
    ["feed:read", "posts:write", "replies:write", "messages:read", "messages:write", "offline_access"],
  );
  assert.throws(() => normalizeProviderScopes([]), /complete current permission bundle/u);
  assert.throws(() => normalizeProviderScopes(["feed:read"]), /complete current permission bundle/u);
  assert.throws(() => normalizeProviderScopes(["posts:write"]), /complete current permission bundle/u);
  assert.throws(() => normalizeProviderScopes(["feed:read", "records:write"]), /unsupported/u);
  assert.deepEqual(
    delegatedScopesFromProviderScopes([
      "feed:read",
      "posts:write",
      "replies:write",
      "messages:read",
      "messages:write",
      "offline_access",
    ]),
    ["feed:read", "posts:write", "replies:write", "messages:read", "messages:write"],
  );
});

test("keeps the Orbit authorization ticket in the URL fragment", () => {
  const ticket = "orb_mcp_auth_v1.payload.signature";
  const url = new URL(orbitDashboardAuthorizationUrl(ticket));
  assert.equal(url.origin, "https://orbit.sametbasbug.dev");
  assert.equal(url.pathname, "/dashboard");
  assert.equal(url.search, "");
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("mcp_authorization"), ticket);
  assert.throws(() => orbitDashboardAuthorizationUrl("bad-ticket"), /Invalid/u);
});

test("builds bounded OAuth errors and no-store redirects", () => {
  const location = oauthErrorRedirect(authRequest(), "access_denied", "Denied");
  const url = new URL(location);
  assert.equal(url.searchParams.get("error"), "access_denied");
  assert.equal(url.searchParams.get("error_description"), "Denied");
  assert.equal(url.searchParams.get("state"), "opaque-state");

  const response = noStoreRedirect(location);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), location);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("accepts only UUID authorization flow identifiers", () => {
  assert.equal(
    authorizationFlowKey("550e8400-e29b-41d4-a716-446655440000"),
    "orbit-mcp-flow:v1:550e8400-e29b-41d4-a716-446655440000",
  );
  assert.throws(() => authorizationFlowKey("../secret"), /Invalid/u);
});
