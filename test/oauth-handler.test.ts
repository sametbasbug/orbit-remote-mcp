import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthRequest,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";

import { oauthDefaultHandler } from "../src/oauth-handler";
import type { Env } from "../src/oauth-types";

const SERVICE_SECRET = "test-service-secret-at-least-32-bytes-long";

function context(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function memoryKv(): KVNamespace {
  const values = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const value = values.get(key) ?? null;
      if (value === null) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
    async delete(key: string) {
      values.delete(key);
    },
  } as unknown as KVNamespace;
}

function service(
  responder: (request: Request) => Response | Promise<Response>,
): Fetcher {
  return { fetch: responder } as unknown as Fetcher;
}

test("binds the access token to the complete current permission bundle", async () => {
  const oauthRequest: AuthRequest = {
    responseType: "code",
    clientId: "chatgpt-client",
    redirectUri: "https://chatgpt.com/aip/callback",
    scope: ["feed:read", "posts:write", "replies:write", "offline_access"],
    state: "oauth-state",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
  };

  let completed: Parameters<OAuthHelpers["completeAuthorization"]>[0] | null = null;
  let authorizationRequestId = "";
  let ticketRequestBody: Record<string, unknown> | null = null;
  const provider = {
    async parseAuthRequest() {
      return oauthRequest;
    },
    async lookupClient() {
      return {
        clientId: "chatgpt-client",
        clientName: "ChatGPT",
        redirectUris: [oauthRequest.redirectUri],
        tokenEndpointAuthMethod: "none",
      };
    },
    async completeAuthorization(options: Parameters<OAuthHelpers["completeAuthorization"]>[0]) {
      completed = options;
      return { redirectTo: "https://chatgpt.com/aip/callback?code=oauth-code&state=oauth-state" };
    },
  } as unknown as OAuthHelpers;

  const env: Env = {
    OAUTH_KV: memoryKv(),
    OAUTH_PROVIDER: provider,
    ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
    ORBIT_SERVICE: service(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/v1/mcp/authorization-tickets") {
        ticketRequestBody = await request.clone().json() as Record<string, unknown>;
        authorizationRequestId = String(ticketRequestBody.authorizationRequestId);
        return jsonResponse({
          ticket: "orb_mcp_auth_v1.payload.signature",
          authorizationRequest: {
            id: authorizationRequestId,
            oauthClient: { id: "chatgpt-client", label: "ChatGPT" },
            scopes: ["feed:read", "posts:write", "replies:write"],
            scopeBundleVersion: 1,
            issuedAt: 1,
            expiresAt: Date.now() + 10 * 60 * 1000,
          },
        });
      }
      if (path === "/v1/mcp/delegations/redeem") {
        return jsonResponse({
          authorization: {
            id: "grant-1",
            accountId: "account-1",
            agent: { id: "agent-1", handle: "selene" },
            scopes: ["feed:read", "posts:write", "replies:write"],
            scopeBundleVersion: 1,
            currentScopeBundleVersion: 1,
            upgradeRequired: false,
            oauthClient: { id: "chatgpt-client", label: "ChatGPT" },
            status: "active",
            createdAt: 1,
            lastUsedAt: null,
            expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
            revokedAt: null,
            revokedReason: null,
          },
        });
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    }),
  };

  const fetchHandler = oauthDefaultHandler.fetch!;
  const start = await fetchHandler(
    new Request("https://mcp.orbit.sametbasbug.dev/authorize"),
    env,
    context(),
  );
  assert.equal(start.status, 302);
  assert.ok(start.headers.get("location")?.startsWith("https://orbit.sametbasbug.dev/dashboard#"));
  const capturedTicketRequest = ticketRequestBody as Record<string, unknown> | null;
  assert.deepEqual(capturedTicketRequest?.scopes, ["feed:read", "posts:write", "replies:write"]);
  assert.equal(capturedTicketRequest?.scopeBundleVersion, 1);
  assert.ok(authorizationRequestId.length > 0);

  const finish = await fetchHandler(
    new Request(
      `https://mcp.orbit.sametbasbug.dev/oauth/orbit/callback?code=orb_mcp_v1_selector_secret&authorization_request_id=${encodeURIComponent(authorizationRequestId)}`,
    ),
    env,
    context(),
  );
  assert.equal(finish.status, 302);
  assert.equal(
    finish.headers.get("location"),
    "https://chatgpt.com/aip/callback?code=oauth-code&state=oauth-state",
  );
  const completedOptions = completed as Parameters<OAuthHelpers["completeAuthorization"]>[0] | null;
  assert.ok(completedOptions);
  assert.deepEqual(completedOptions.scope, ["feed:read", "posts:write", "replies:write", "offline_access"]);
  assert.deepEqual(completedOptions.props, {
    grantId: "grant-1",
    accountId: "account-1",
    agentId: "agent-1",
    handle: "selene",
    scopes: ["feed:read", "posts:write", "replies:write"],
    scopeBundleVersion: 1,
  });
});
