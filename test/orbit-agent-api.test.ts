import assert from "node:assert/strict";
import test from "node:test";

import { OrbitAgentApi } from "../src/orbit-agent-api";
import { OrbitMcpApi } from "../src/orbit-mcp-api";
import { OrbitPublicApi, ORBIT_API_BASE, ORBIT_OPENAPI_URL } from "../src/orbit-public-api";
import type { OrbitOAuthProps } from "../src/oauth-types";
import type { OrbitGrantScope } from "../src/orbit-scopes";

const SERVICE_SECRET = "test-service-secret-at-least-32-bytes-long";

const contract = {
  openapi: "3.2.0",
  info: { version: "test" },
  servers: [{ url: ORBIT_API_BASE }],
  paths: {
    "/feed": {
      get: {
        operationId: "listPublicFeed",
        summary: "List feed",
        security: [],
        responses: {
          "200": { content: { "application/json": { schema: { type: "object" } } } },
        },
      },
    },
    "/records": {
      post: {
        operationId: "createPost",
        security: [{ agentCredential: [] }],
        responses: {
          "201": { content: { "application/json": { schema: { type: "object" } } } },
        },
      },
    },
  },
};

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), {
    ...init,
    status: init.status ?? 200,
    headers,
  });
}

function service(responder: (request: Request) => Response | Promise<Response>): Fetcher {
  return { fetch: responder } as unknown as Fetcher;
}

function props(scopes: OrbitGrantScope[]): OrbitOAuthProps {
  return {
    grantId: "grant-1",
    accountId: "account-1",
    agentId: "agent-1",
    handle: "selene",
    scopes,
  };
}

function state(scopes: OrbitGrantScope[]) {
  return {
    authorization: {
      id: "grant-1",
      accountId: "account-1",
      agent: { id: "agent-1", handle: "selene" },
      scopes,
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
  };
}

function publicApi(): OrbitPublicApi {
  return new OrbitPublicApi(async (input) => {
    if (String(input) === ORBIT_OPENAPI_URL) return jsonResponse(contract);
    return jsonResponse({ records: [], nextCursor: null });
  });
}

test("filters private operations by the live read-only grant", async () => {
  let stateCalls = 0;
  const scopes: OrbitGrantScope[] = ["feed:read"];
  const api = new OrbitAgentApi(
    publicApi(),
    new OrbitMcpApi({
      ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
      ORBIT_SERVICE: service(() => {
        stateCalls += 1;
        return jsonResponse(state(scopes));
      }),
    }),
    props(scopes),
  );

  const listed = await api.run({ action: "list" });
  const operationIds = (listed.operations as Array<{ operationId: string }>).map(
    (operation) => operation.operationId,
  );
  assert.deepEqual(operationIds, ["listPublicFeed"]);
  assert.deepEqual(listed.grantedScopes, ["feed:read"]);
  assert.deepEqual(listed.connectedAgent, {
    handle: "selene",
    status: "active",
    onboardingState: "active",
    publicationMode: "direct_publish",
  });
  assert.equal(
    (listed.statusAction as { action: string }).action,
    "status",
  );

  const status = await api.run({ action: "status" });
  assert.equal(status.readOnly, true);
  assert.deepEqual(status.connectedAgent, {
    handle: "selene",
    status: "active",
    onboardingState: "active",
    publicationMode: "direct_publish",
  });
  assert.equal((status.authorization as { status: string }).status, "active");
  assert.equal((status.recordCounts as { total: number }).total, 5);
  assert.equal(JSON.stringify(status).includes("grant-1"), false);
  assert.equal(JSON.stringify(status).includes("agent-1"), false);
  assert.deepEqual(status.capabilities, []);

  await assert.rejects(
    () => api.run({ action: "describe", operationId: "createPost" }),
    /not available for this OAuth grant/u,
  );

  const publicResult = await api.run({ action: "call", operationId: "listPublicFeed" });
  assert.equal(publicResult.status, 200);
  assert.equal(stateCalls, 4);
});

test("requires explicit scope and idempotency for text-only post creation", async () => {
  const scopes: OrbitGrantScope[] = ["feed:read", "posts:write"];
  const calls: Request[] = [];
  const api = new OrbitAgentApi(
    publicApi(),
    new OrbitMcpApi({
      ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
      ORBIT_SERVICE: service(async (request) => {
        calls.push(request);
        if (new URL(request.url).pathname.endsWith("/agent/state")) {
          return jsonResponse(state(scopes));
        }
        return jsonResponse(
          { record: { id: "post-1", lifecycleState: "published" } },
          {
            status: 201,
            headers: {
              "x-request-id": "request-post-1",
              "idempotency-key-expires-at": "2026-08-01T01:00:00.000Z",
            },
          },
        );
      }),
    }),
    props(scopes),
  );

  const listed = await api.run({ action: "list" });
  const operationIds = (listed.operations as Array<{ operationId: string }>).map(
    (operation) => operation.operationId,
  );
  assert.deepEqual(operationIds, ["createPost", "listPublicFeed"]);
  const createPost = (listed.operations as Array<Record<string, unknown>>).find(
    (operation) => operation.operationId === "createPost",
  );
  assert.equal(createPost?.action, "call");
  assert.equal(createPost?.requiredScope, "posts:write");
  assert.equal(createPost?.readOnly, false);
  assert.equal(
    (createPost?.idempotencyKey as { required: boolean }).required,
    true,
  );
  assert.equal(
    (createPost?.requestBody as { additionalProperties: boolean }).additionalProperties,
    false,
  );

  const status = await api.run({ action: "status" });
  const statusCreatePost = (status.capabilities as Array<Record<string, unknown>>).find(
    (operation) => operation.operationId === "createPost",
  );
  assert.equal(statusCreatePost?.action, "call");
  assert.equal(statusCreatePost?.requiredScope, "posts:write");
  assert.equal(statusCreatePost?.readOnly, false);
  assert.equal(
    (statusCreatePost?.idempotencyKey as { required: boolean }).required,
    true,
  );
  assert.equal(
    (statusCreatePost?.requestBody as { additionalProperties: boolean }).additionalProperties,
    false,
  );

  await assert.rejects(
    () => api.run({
      action: "call",
      operationId: "createPost",
      body: { bodyMarkdown: "Hello Orbit" },
    }),
    /idempotencyKey is required/u,
  );
  await assert.rejects(
    () => api.run({
      action: "call",
      operationId: "createPost",
      body: { bodyMarkdown: "Hello Orbit", mediaId: "not-allowed" },
      idempotencyKey: "post-key-1",
    }),
    /Unsupported body field: mediaId/u,
  );
  await assert.rejects(
    () => api.run({ action: "call", operationId: "createReply" }),
    /not available for this OAuth grant/u,
  );
  await assert.rejects(
    () => api.run({
      action: "call",
      operationId: "createPost",
      pathParams: { record: "unexpected" },
      body: { bodyMarkdown: "Hello Orbit" },
      idempotencyKey: "post-key-2",
    }),
    /does not accept path parameters/u,
  );

  const created = await api.run({
    action: "call",
    operationId: "createPost",
    body: {
      bodyMarkdown: "Hello Orbit",
      projectSlug: null,
      topicSlugs: ["orbit"],
    },
    idempotencyKey: "post-key-1",
  });
  assert.equal(created.status, 201);
  assert.equal(created.requestId, "request-post-1");
  assert.equal(created.idempotencyReplayed, false);

  const write = calls.find((request) => new URL(request.url).pathname.endsWith("/records"));
  assert.ok(write);
  assert.equal(write.headers.get("idempotency-key"), "post-key-1");
  assert.deepEqual(await write.clone().json(), {
    bodyMarkdown: "Hello Orbit",
    projectSlug: null,
    topicSlugs: ["orbit"],
    mediaId: null,
  });
});

test("supports reply scope independently and revalidates revocation before every action", async () => {
  const scopes: OrbitGrantScope[] = ["feed:read", "replies:write"];
  let revoked = false;
  let stateCalls = 0;
  const api = new OrbitAgentApi(
    publicApi(),
    new OrbitMcpApi({
      ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
      ORBIT_SERVICE: service((request) => {
        if (new URL(request.url).pathname.endsWith("/agent/state")) {
          stateCalls += 1;
          return revoked
            ? jsonResponse(
                { error: { code: "mcp_authorization_invalid", message: "Revoked" } },
                { status: 401 },
              )
            : jsonResponse(state(scopes));
        }
        return jsonResponse(
          { record: { id: "reply-1", lifecycleState: "published" } },
          { status: 201 },
        );
      }),
    }),
    props(scopes),
  );

  const listed = await api.run({ action: "list" });
  const operationIds = (listed.operations as Array<{ operationId: string }>).map(
    (operation) => operation.operationId,
  );
  assert.deepEqual(operationIds, ["createReply", "listPublicFeed"]);

  const status = await api.run({ action: "status" });
  const capabilities = status.capabilities as Array<Record<string, unknown>>;
  assert.deepEqual(
    capabilities.map((operation) => operation.operationId),
    ["createReply"],
  );
  assert.equal(capabilities[0]?.requiredScope, "replies:write");
  assert.equal(
    (capabilities[0]?.pathParameters as Array<{ name: string }>)[0]?.name,
    "record",
  );

  const reply = await api.run({
    action: "call",
    operationId: "createReply",
    pathParams: { record: "root-post" },
    body: { bodyMarkdown: "Reply through OAuth" },
    idempotencyKey: "reply-key-1",
  });
  assert.equal(reply.status, 201);
  assert.equal(stateCalls, 3);

  revoked = true;
  await assert.rejects(
    () => api.run({ action: "list" }),
    /mcp_authorization_invalid: Revoked/u,
  );
  await assert.rejects(
    () => api.run({ action: "status" }),
    /mcp_authorization_invalid: Revoked/u,
  );
  await assert.rejects(
    () => api.run({ action: "call", operationId: "listPublicFeed" }),
    /mcp_authorization_invalid: Revoked/u,
  );
  assert.equal(stateCalls, 6);
});

test("rejects live identity or scope drift from token-bound OAuth props", async () => {
  const tokenScopes: OrbitGrantScope[] = ["feed:read", "posts:write"];
  const liveScopes: OrbitGrantScope[] = ["feed:read"];
  const api = new OrbitAgentApi(
    publicApi(),
    new OrbitMcpApi({
      ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
      ORBIT_SERVICE: service(() => jsonResponse(state(liveScopes))),
    }),
    props(tokenScopes),
  );

  await assert.rejects(
    () => api.run({ action: "list" }),
    /does not match the OAuth grant/u,
  );
});
