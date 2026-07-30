import assert from "node:assert/strict";
import test from "node:test";

import { OrbitMcpApi } from "../src/orbit-mcp-api";
import { ORBIT_ORIGIN } from "../src/service-metadata";

const SERVICE_SECRET = "test-service-secret-at-least-32-bytes-long";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function service(
  responder: (request: Request) => Response | Promise<Response>,
): Fetcher {
  return { fetch: responder } as unknown as Fetcher;
}

test("creates a signed authorization ticket through the service binding", async () => {
  const calls: Request[] = [];
  const api = new OrbitMcpApi({
    ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
    ORBIT_SERVICE: service(async (request) => {
      calls.push(request);
      return jsonResponse({
        ticket: "orb_mcp_auth_v1.payload.signature",
        authorizationRequest: {
          id: "request-1",
          oauthClient: { id: "client-1", label: "ChatGPT" },
          scopes: ["feed:read"],
          issuedAt: 1,
          expiresAt: 2,
        },
      });
    }),
  });

  const result = await api.createAuthorizationTicket({
    authorizationRequestId: "request-1",
    oauthClientId: "client-1",
    oauthClientLabel: "ChatGPT",
  });

  assert.equal(result.ticket, "orb_mcp_auth_v1.payload.signature");
  const captured = calls[0]!;
  assert.equal(captured.url, `${ORBIT_ORIGIN}/v1/mcp/authorization-tickets`);
  assert.equal(captured.method, "POST");
  assert.equal(captured.redirect, "manual");
  assert.equal(captured.headers.get("authorization"), `Bearer ${SERVICE_SECRET}`);
  assert.deepEqual(await captured.clone().json(), {
    authorizationRequestId: "request-1",
    oauthClientId: "client-1",
    oauthClientLabel: "ChatGPT",
    scopes: ["feed:read"],
  });
});

test("redeems a one-time delegation without exposing an agent credential", async () => {
  const calls: Request[] = [];
  const api = new OrbitMcpApi({
    ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
    ORBIT_SERVICE: service((request) => {
      calls.push(request);
      return jsonResponse({
        authorization: {
          id: "grant-1",
          accountId: "account-1",
          agent: { id: "agent-1", handle: "selene" },
          scopes: ["feed:read"],
          oauthClient: { id: "client-1", label: "ChatGPT" },
          status: "active",
          createdAt: 1,
          lastUsedAt: null,
          expiresAt: 2,
          revokedAt: null,
          revokedReason: null,
        },
      });
    }),
  });

  const result = await api.redeemDelegation({
    code: "orb_mcp_v1_selector_secret",
    authorizationRequestId: "request-1",
  });

  assert.equal(result.authorization.agent.handle, "selene");
  const body = JSON.stringify(await calls[0]!.clone().json());
  assert.ok(!body.includes("orb_agent_v1_"));
  assert.equal(calls[0]!.url, `${ORBIT_ORIGIN}/v1/mcp/delegations/redeem`);
});

test("reads delegated agent state and rejects scope drift", async () => {
  let elevated = false;
  const api = new OrbitMcpApi({
    ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
    ORBIT_SERVICE: service(() => jsonResponse({
      authorization: {
        id: "grant-1",
        accountId: "account-1",
        agent: { id: "agent-1", handle: "selene" },
        scopes: elevated ? ["feed:read", "records:write"] : ["feed:read"],
        oauthClient: { id: "client-1", label: "ChatGPT" },
        status: "active",
        createdAt: 1,
        lastUsedAt: 2,
        expiresAt: 3,
        revokedAt: null,
        revokedReason: null,
      },
      agent: {
        id: "agent-1",
        handle: "selene",
        status: "active",
        onboardingState: "active",
        publicationMode: "direct_publish",
      },
      recordCounts: {
        total: 5,
        pending: 0,
        published: 5,
        rejected: 0,
        deleted: 0,
        pendingReview: 0,
        moderated: 0,
      },
    })),
  });

  const state = await api.getDelegatedAgentState("grant-1");
  assert.equal(state.agent.handle, "selene");
  assert.equal(state.recordCounts.total, 5);

  elevated = true;
  await assert.rejects(() => api.getDelegatedAgentState("grant-1"), /unexpected delegated scope/u);
});

test("rejects redirects, oversized errors and missing service configuration", async () => {
  assert.throws(
    () => new OrbitMcpApi({
      ORBIT_MCP_SERVICE_SECRET_V1: "short",
      ORBIT_SERVICE: service(() => jsonResponse({})),
    }),
    /not configured/u,
  );

  const redirected = new OrbitMcpApi({
    ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
    ORBIT_SERVICE: service(() => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example" },
    })),
  });
  await assert.rejects(
    () => redirected.getDelegatedAgentState("grant-1"),
    /redirected/u,
  );

  const rejected = new OrbitMcpApi({
    ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
    ORBIT_SERVICE: service(() => jsonResponse({
      error: { code: "mcp_authorization_invalid", message: "Revoked" },
    }, 401)),
  });
  await assert.rejects(
    () => rejected.getDelegatedAgentState("grant-1"),
    /mcp_authorization_invalid: Revoked/u,
  );
});
