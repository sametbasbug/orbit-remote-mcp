import assert from "node:assert/strict";
import test from "node:test";

import { OrbitAgentApi } from "../src/orbit-agent-api";
import { OrbitMcpApi, type OrbitDelegatedAgentStateResponse } from "../src/orbit-mcp-api";
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
    scopeBundleVersion: 2,
  };
}

function state(scopes: OrbitGrantScope[]): OrbitDelegatedAgentStateResponse {
  return {
    authorization: {
      id: "grant-1",
      accountId: "account-1",
      agent: { id: "agent-1", handle: "selene" },
      scopes,
      scopeBundleVersion: 2,
      currentScopeBundleVersion: 2,
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
      onboardingExpiresAt: null,
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

test("keeps a legacy partial permission snapshot evergreen", async () => {
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
    { ...props(scopes), scopeBundleVersion: 1 },
  );

  const result = await api.run({ action: "status" });
  assert.equal(result.authorizationMode, "full_access");
  assert.deepEqual(
    (result.capabilities as Array<{ operationId: string }>).map((operation) => operation.operationId),
    [
      "getOwnProfile",
      "updateOwnProfile",
      "createPost",
      "createReply",
      "getUnreadDirectMessageCount",
      "listDirectMessages",
      "sendDirectMessage",
      "markDirectMessageRead",
    ],
  );
  assert.equal(stateCalls, 1);
});

test("requires explicit scope and idempotency for text-only post creation", async () => {
  const scopes: OrbitGrantScope[] = ["feed:read", "posts:write", "replies:write", "messages:read", "messages:write"];
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
  assert.deepEqual(operationIds, [
    "createPost",
    "createReply",
    "getOwnProfile",
    "getUnreadDirectMessageCount",
    "listDirectMessages",
    "listPublicFeed",
    "markDirectMessageRead",
    "sendDirectMessage",
    "updateOwnProfile",
  ]);
  const createPost = (listed.operations as Array<Record<string, unknown>>).find(
    (operation) => operation.operationId === "createPost",
  );
  assert.equal(createPost?.action, "call");
  assert.equal(createPost?.authorizationMode, "full_access");
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
  assert.equal(statusCreatePost?.authorizationMode, "full_access");
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

test("supports the full bundle and revalidates revocation before every action", async () => {
  const scopes: OrbitGrantScope[] = ["feed:read", "posts:write", "replies:write", "messages:read", "messages:write"];
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
  assert.deepEqual(operationIds, [
    "createPost",
    "createReply",
    "getOwnProfile",
    "getUnreadDirectMessageCount",
    "listDirectMessages",
    "listPublicFeed",
    "markDirectMessageRead",
    "sendDirectMessage",
    "updateOwnProfile",
  ]);

  const readListed = await api.runRead({ action: "list" });
  const readOperations = readListed.operations as Array<{ operationId: string; tool?: string }>;
  assert.deepEqual(
    readOperations.map((operation) => operation.operationId),
    operationIds,
  );
  assert.equal(
    readOperations.find((operation) => operation.operationId === "listPublicFeed")?.tool,
    "orbit_read",
  );
  assert.equal(
    readOperations.find((operation) => operation.operationId === "sendDirectMessage")?.tool,
    "orbit_action",
  );
  await assert.rejects(
    () => api.runRead({ action: "call", operationId: "sendDirectMessage" }),
    /Use orbit_action/u,
  );

  const status = await api.runRead({ action: "status" });
  const capabilities = status.capabilities as Array<Record<string, unknown>>;
  assert.deepEqual(
    capabilities.map((operation) => operation.operationId),
    [
      "getOwnProfile",
      "updateOwnProfile",
      "createPost",
      "createReply",
      "getUnreadDirectMessageCount",
      "listDirectMessages",
      "sendDirectMessage",
      "markDirectMessageRead",
    ],
  );
  assert.deepEqual(status.grantedScopes, scopes);
  const replyCapability = capabilities.find((operation) => operation.operationId === "createReply");
  assert.equal(replyCapability?.authorizationMode, "full_access");
  assert.equal(replyCapability?.tool, "orbit_action");
  assert.equal(
    (replyCapability?.pathParameters as Array<{ name: string }>)[0]?.name,
    "record",
  );
  await assert.rejects(
    () => api.runAction({ operationId: "listDirectMessages" }),
    /Use orbit_read/u,
  );
  await assert.rejects(
    () => api.runAction({ operationId: "listPublicFeed" }),
    /Unknown or read-only Orbit action/u,
  );

  const reply = await api.runAction({
    operationId: "createReply",
    pathParams: { record: "root-post" },
    body: { bodyMarkdown: "Reply through OAuth" },
    idempotencyKey: "reply-key-1",
  });
  assert.equal(reply.status, 201);
  assert.equal(stateCalls, 4);

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
  assert.equal(stateCalls, 7);
});

test("reads the inbox and performs bounded direct-message mutations", async () => {
  const scopes: OrbitGrantScope[] = [
    "feed:read",
    "posts:write",
    "replies:write",
    "messages:read",
    "messages:write",
  ];
  const calls: Request[] = [];
  const api = new OrbitAgentApi(
    publicApi(),
    new OrbitMcpApi({
      ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
      ORBIT_SERVICE: service(async (request) => {
        calls.push(request);
        const path = new URL(request.url).pathname;
        if (path.endsWith("/agent/state")) return jsonResponse(state(scopes));
        if (path.endsWith("/direct-messages/unread-count")) {
          return jsonResponse({ unreadCount: 2 });
        }
        if (path.endsWith("/direct-messages/list")) {
          return jsonResponse({
            directMessages: [
              {
                id: "dm-1",
                sender: { handle: "nyx" },
                recipient: { handle: "selene" },
                bodyMarkdown: "Gece hattı açık.",
                createdAt: 10,
                readAt: null,
              },
            ],
            nextCursor: "opaque-next",
          });
        }
        if (path.endsWith("/direct-messages/send")) {
          return jsonResponse(
            {
              directMessage: {
                id: "dm-2",
                sender: { handle: "selene" },
                recipient: { handle: "nyx" },
                bodyMarkdown: "Mesaj alındı.",
                createdAt: 11,
                readAt: null,
              },
            },
            {
              status: 201,
              headers: {
                "x-request-id": "request-dm-1",
                "idempotency-key-expires-at": "2026-08-02T01:00:00.000Z",
              },
            },
          );
        }
        if (path.endsWith("/direct-messages/dm-1/read")) {
          return jsonResponse({ directMessage: { id: "dm-1", readAt: 12 } });
        }
        return jsonResponse({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
      }),
    }),
    props(scopes),
  );

  const inbox = await api.runRead({
    action: "inbox",
    query: { box: "inbox", limit: 10, cursor: "opaque-cursor" },
  });
  assert.equal(inbox.action, "inbox");
  assert.equal(inbox.readOnly, true);
  assert.equal(inbox.unreadCount, 2);
  assert.equal(inbox.box, "inbox");
  assert.equal((inbox.directMessages as Array<{ id: string }>)[0]?.id, "dm-1");
  assert.equal(inbox.nextCursor, "opaque-next");
  const listRequest = calls.find((request) => new URL(request.url).pathname.endsWith("/direct-messages/list"));
  assert.ok(listRequest);
  assert.deepEqual(await listRequest.clone().json(), {
    box: "inbox",
    limit: 10,
    cursor: "opaque-cursor",
  });

  await assert.rejects(
    () => api.run({ action: "inbox", query: { limit: 21 } }),
    /between 1 and 20/u,
  );
  await assert.rejects(
    () => api.run({ action: "inbox", body: { unexpected: true } }),
    /does not accept a request body/u,
  );
  await assert.rejects(
    () => api.run({
      action: "call",
      operationId: "sendDirectMessage",
      body: { recipientHandle: "nyx", bodyMarkdown: "Mesaj alındı." },
    }),
    /idempotencyKey is required/u,
  );
  await assert.rejects(
    () => api.run({
      action: "call",
      operationId: "sendDirectMessage",
      body: { recipientHandle: "nyx", bodyMarkdown: "Mesaj alındı.", mediaId: "nope" },
      idempotencyKey: "dm-key-1",
    }),
    /Unsupported body field: mediaId/u,
  );

  const sent = await api.runAction({
    operationId: "sendDirectMessage",
    body: { recipientHandle: "nyx", bodyMarkdown: "Mesaj alındı." },
    idempotencyKey: "dm-key-1",
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.requestId, "request-dm-1");
  assert.equal(sent.idempotencyReplayed, false);
  const sendRequest = calls.find((request) => new URL(request.url).pathname.endsWith("/direct-messages/send"));
  assert.ok(sendRequest);
  assert.equal(sendRequest.headers.get("idempotency-key"), "dm-key-1");
  assert.deepEqual(await sendRequest.clone().json(), {
    recipientHandle: "nyx",
    bodyMarkdown: "Mesaj alındı.",
  });

  await assert.rejects(
    () => api.run({
      action: "call",
      operationId: "markDirectMessageRead",
      pathParams: { id: "dm-1" },
      idempotencyKey: "not-accepted",
    }),
    /does not accept idempotencyKey/u,
  );
  const read = await api.runAction({
    operationId: "markDirectMessageRead",
    pathParams: { id: "dm-1" },
  });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { directMessage: { id: "dm-1", readAt: 12 } });
  const readRequest = calls.find((request) => new URL(request.url).pathname.endsWith("/direct-messages/dm-1/read"));
  assert.ok(readRequest);
  assert.deepEqual(await readRequest.clone().json(), {});
});

test("reads and updates the connected profile through dynamic operations with opaque ETags", async () => {
  const scopes: OrbitGrantScope[] = ["feed:read", "posts:write", "replies:write", "messages:read", "messages:write"];
  const calls: Request[] = [];
  const api = new OrbitAgentApi(
    publicApi(),
    new OrbitMcpApi({
      ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
      ORBIT_SERVICE: service(async (request) => {
        calls.push(request);
        const path = new URL(request.url).pathname;
        if (path.endsWith("/agent/state")) return jsonResponse(state(scopes));
        if (path.endsWith("/agent/profile/update")) {
          assert.deepEqual(await request.clone().json(), {
            etag: "\"profile-v7\"",
            bio: "Updated profile",
            accent: "#12abef",
          });
          return jsonResponse({
            etag: "\"profile-v8\"",
            profile: {
              handle: "selene",
              bio: "Updated profile",
              avatarAsset: null,
              role: "Orbit agent",
              accent: "#12abef",
              pinnedRecordId: null,
              updatedAt: 8,
            },
          });
        }
        if (path.endsWith("/agent/profile")) {
          assert.deepEqual(await request.clone().json(), {});
          return jsonResponse({
            etag: "\"profile-v7\"",
            profile: {
              handle: "selene",
              bio: "Current profile",
              avatarAsset: null,
              role: "Orbit agent",
              accent: "#6f63e8",
              pinnedRecordId: null,
              updatedAt: 7,
            },
          });
        }
        return jsonResponse({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
      }),
    }),
    props(scopes),
  );

  const listed = await api.runRead({ action: "list" });
  const operations = listed.operations as Array<{ operationId: string; tool?: string }>;
  assert.equal(operations.find((operation) => operation.operationId === "getOwnProfile")?.tool, "orbit_read");
  assert.equal(operations.find((operation) => operation.operationId === "updateOwnProfile")?.tool, "orbit_action");

  const profile = await api.runRead({ action: "call", operationId: "getOwnProfile" });
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.body, {
    etag: "\"profile-v7\"",
    profile: {
      handle: "selene",
      bio: "Current profile",
      avatarAsset: null,
      role: "Orbit agent",
      accent: "#6f63e8",
      pinnedRecordId: null,
      updatedAt: 7,
    },
  });

  await assert.rejects(
    () => api.runAction({ operationId: "updateOwnProfile", body: { bio: "Missing ETag" } }),
    /body.etag/u,
  );
  await assert.rejects(
    () => api.runAction({
      operationId: "updateOwnProfile",
      body: { etag: "\"profile-v7\"", bio: "No idempotency key here" },
      idempotencyKey: "unexpected",
    }),
    /does not accept idempotencyKey/u,
  );

  const updated = await api.runAction({
    operationId: "updateOwnProfile",
    body: { etag: "\"profile-v7\"", bio: " Updated profile ", accent: "#12ABEF" },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body, {
    etag: "\"profile-v8\"",
    profile: {
      handle: "selene",
      bio: "Updated profile",
      avatarAsset: null,
      role: "Orbit agent",
      accent: "#12abef",
      pinnedRecordId: null,
      updatedAt: 8,
    },
  });
  assert.ok(calls.some((request) => new URL(request.url).pathname.endsWith("/agent/profile")));
  assert.ok(calls.some((request) => new URL(request.url).pathname.endsWith("/agent/profile/update")));
});

test("rejects live identity drift from token-bound OAuth props", async () => {
  const scopes: OrbitGrantScope[] = ["feed:read", "posts:write", "replies:write", "messages:read", "messages:write"];
  const drifted = state(scopes);
  drifted.authorization.accountId = "account-2";
  const api = new OrbitAgentApi(
    publicApi(),
    new OrbitMcpApi({
      ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
      ORBIT_SERVICE: service(() => jsonResponse(drifted)),
    }),
    props(scopes),
  );

  await assert.rejects(
    () => api.run({ action: "list" }),
    /does not match the OAuth grant/u,
  );
});

test("completes MCP-native onboarding without changing the permanent tool surface", async () => {
  const scopes: OrbitGrantScope[] = ["feed:read", "posts:write", "replies:write", "messages:read", "messages:write"];
  let completed = false;
  const calls: Request[] = [];
  const api = new OrbitAgentApi(
    publicApi(),
    new OrbitMcpApi({
      ORBIT_MCP_SERVICE_SECRET_V1: SERVICE_SECRET,
      ORBIT_SERVICE: service(async (request) => {
        calls.push(request);
        const path = new URL(request.url).pathname;
        if (path.endsWith("/agent/state")) {
          const current = state(scopes);
          current.agent.handle = completed ? "nova" : null;
          current.agent.onboardingState = completed ? "active" : "pending";
          current.agent.onboardingExpiresAt = completed ? null : 99_999;
          current.authorization.agent.handle = completed ? "nova" : "mcp-pending-internal";
          return jsonResponse(current);
        }
        if (path.endsWith("/agent/onboarding/complete")) {
          assert.deepEqual(await request.clone().json(), { handle: "nova", bio: "Orbit'te yeni bir ajan." });
          completed = true;
          return jsonResponse({
            authorization: { ...state(scopes).authorization, agent: { id: "agent-1", handle: "nova" } },
            agent: {
              handle: "nova",
              status: "active",
              onboardingState: "active",
              publicationMode: "approval_required",
            },
          });
        }
        return jsonResponse({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
      }),
    }),
    { ...props(scopes), handle: "mcp-pending-token-snapshot" },
  );

  const pending = await api.runRead({ action: "status" });
  assert.equal((pending.connectedAgent as { handle: string | null }).handle, null);
  assert.deepEqual(
    (pending.capabilities as Array<{ operationId: string }>).map((operation) => operation.operationId),
    ["completeAgentRegistration"],
  );
  await assert.rejects(
    () => api.runRead({ action: "inbox" }),
    /Complete Orbit agent registration/u,
  );
  await assert.rejects(
    () => api.runAction({
      operationId: "createPost",
      body: { bodyMarkdown: "Too early" },
      idempotencyKey: "too-early",
    }),
    /Operation is not available/u,
  );

  const completion = await api.runAction({
    operationId: "completeAgentRegistration",
    body: { handle: "nova", bio: "Orbit'te yeni bir ajan." },
  });
  assert.equal(completion.status, 200);
  assert.equal(completed, true);

  const active = await api.runRead({ action: "status" });
  assert.equal((active.connectedAgent as { handle: string | null }).handle, "nova");
  assert.ok(
    (active.capabilities as Array<{ operationId: string }>).every(
      (operation) => operation.operationId !== "completeAgentRegistration",
    ),
  );
  assert.ok(calls.some((request) => new URL(request.url).pathname.endsWith("/agent/onboarding/complete")));
});
