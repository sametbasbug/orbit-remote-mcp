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
          scopes: ["feed:read", "posts:write", "replies:write", "reactions:write", "messages:read", "messages:write"],
          scopeBundleVersion: 3,
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
    scopes: ["feed:read", "posts:write", "replies:write", "reactions:write", "messages:read", "messages:write"],
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
    scopes: ["feed:read", "posts:write", "replies:write", "reactions:write", "messages:read", "messages:write"],
    scopeBundleVersion: 3,
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
          scopes: ["feed:read", "posts:write", "replies:write", "reactions:write", "messages:read", "messages:write"],
          scopeBundleVersion: 3,
          currentScopeBundleVersion: 3,
          upgradeRequired: false,
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

test("reads delegated agent state with write scopes and rejects unknown scope drift", async () => {
  let scopes: unknown = ["feed:read", "posts:write", "replies:write", "reactions:write", "messages:read", "messages:write"];
  const api = new OrbitMcpApi({
    ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
    ORBIT_SERVICE: service(() => jsonResponse({
      authorization: {
        id: "grant-1",
        accountId: "account-1",
        agent: { id: "agent-1", handle: "selene" },
        scopes,
        scopeBundleVersion: 3,
        currentScopeBundleVersion: 3,
        upgradeRequired: false,
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
  assert.deepEqual(state.authorization.scopes, ["feed:read", "posts:write", "replies:write", "reactions:write", "messages:read", "messages:write"]);

  scopes = ["feed:read", "records:write"];
  await assert.rejects(() => api.getDelegatedAgentState("grant-1"), /invalid delegated permission snapshot/u);
});

test("creates delegated posts and replies with explicit idempotency and no media", async () => {
  const calls: Request[] = [];
  const api = new OrbitMcpApi({
    ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
    ORBIT_SERVICE: service(async (request) => {
      calls.push(request);
      return new Response(JSON.stringify({ record: { id: `record-${calls.length}` } }), {
        status: calls.length === 1 ? 201 : 202,
        headers: {
          "content-type": "application/json",
          "x-request-id": `request-${calls.length}`,
          "idempotency-key-expires-at": "2026-08-01T01:00:00.000Z",
          ...(calls.length === 2 ? { "idempotency-replayed": "true" } : {}),
        },
      });
    }),
  });

  const body = {
    bodyMarkdown: "MCP write test",
    projectSlug: null,
    topicSlugs: ["orbit"],
  };
  const post = await api.createDelegatedPost("grant-1", body, "post-key-1");
  const reply = await api.createDelegatedReply("grant-1", "root/unsafe", body, "reply-key-1");

  assert.equal(post.status, 201);
  assert.equal(post.requestId, "request-1");
  assert.equal(post.idempotencyReplayed, false);
  assert.equal(reply.status, 202);
  assert.equal(reply.idempotencyReplayed, true);
  assert.equal(reply.idempotencyExpiresAt, "2026-08-01T01:00:00.000Z");

  assert.equal(
    calls[0]!.url,
    `${ORBIT_ORIGIN}/v1/mcp/grants/grant-1/records`,
  );
  assert.equal(
    calls[1]!.url,
    `${ORBIT_ORIGIN}/v1/mcp/grants/grant-1/records/root%2Funsafe/replies`,
  );
  assert.equal(calls[0]!.headers.get("idempotency-key"), "post-key-1");
  assert.equal(calls[1]!.headers.get("idempotency-key"), "reply-key-1");
  assert.deepEqual(await calls[0]!.clone().json(), { ...body, mediaId: null });
  assert.deepEqual(await calls[1]!.clone().json(), { ...body, mediaId: null });

  await assert.rejects(
    () => api.createDelegatedPost("grant-1", body, "bad key with spaces"),
    /Invalid Orbit idempotency key/u,
  );
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
