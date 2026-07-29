import assert from "node:assert/strict";
import test from "node:test";

import { OrbitPublicApi, ORBIT_API_BASE, ORBIT_OPENAPI_URL } from "../src/orbit-public-api";

const contract = {
  openapi: "3.2.0",
  info: { version: "test" },
  servers: [{ url: ORBIT_API_BASE }],
  externalDocs: { url: "https://orbit.sametbasbug.dev/skill.md" },
  paths: {
    "/feed": {
      get: {
        operationId: "listPublicFeed",
        summary: "List feed",
        security: [],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
      },
      post: {
        operationId: "createPost",
        security: [{ agentCredential: [] }],
        responses: { "201": { content: { "application/json": { schema: { type: "object" } } } } },
      },
    },
    "/records/{record}": {
      get: {
        operationId: "getPublicRecord",
        security: [],
        parameters: [
          {
            name: "record",
            in: "path",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 240 },
          },
        ],
        responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
      },
    },
    "/media/{id}": {
      get: {
        operationId: "readVisibleMedia",
        security: [],
        responses: { "200": { content: { "image/webp": { schema: {} } } } },
      },
    },
    "/agent/state": {
      get: {
        operationId: "getOwnAgentState",
        security: [{ agentCredential: [] }],
        responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
      },
    },
  },
};

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), {
    ...init,
    status: init.status ?? 200,
    headers,
  });
}

test("lists only public JSON GET operations", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const api = new OrbitPublicApi(async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse(contract);
  });

  const result = await api.run({ action: "list" });
  const operationIds = (result.operations as Array<{ operationId: string }>).map((item) => item.operationId);

  assert.deepEqual(operationIds, ["getPublicRecord", "listPublicFeed"]);
  assert.equal(result.operationCount, 2);
  assert.equal(result.staleContract, false);
  assert.equal(typeof result.contractLoadedAt, "string");
  assert.equal(calls[0]?.url, ORBIT_OPENAPI_URL);
  assert.equal(calls[0]?.init?.redirect, "manual");
});

test("calls a public operation without credentials and preserves cursor", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const api = new OrbitPublicApi(async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input) === ORBIT_OPENAPI_URL) return jsonResponse(contract);
    return jsonResponse(
      { records: [], nextCursor: "opaque.cursor.value" },
      { headers: { "x-request-id": "req_test" } },
    );
  });

  const result = await api.run({
    action: "call",
    operationId: "listPublicFeed",
    query: { limit: 20, cursor: "opaque.cursor.value" },
  });

  assert.equal(calls[1]?.url, `${ORBIT_API_BASE}/feed?limit=20&cursor=opaque.cursor.value`);
  const headers = new Headers(calls[1]?.init?.headers);
  assert.equal(headers.get("authorization"), null);
  assert.equal(calls[1]?.init?.redirect, "manual");
  assert.equal(result.status, 200);
  assert.equal(result.requestId, "req_test");
});

test("encodes path parameters", async () => {
  const calls: string[] = [];
  const api = new OrbitPublicApi(async (input) => {
    calls.push(String(input));
    if (String(input) === ORBIT_OPENAPI_URL) return jsonResponse(contract);
    return jsonResponse({ record: { id: "x" } });
  });

  await api.run({
    action: "call",
    operationId: "getPublicRecord",
    pathParams: { record: "slug with spaces" },
  });

  assert.equal(calls[1], `${ORBIT_API_BASE}/records/slug%20with%20spaces`);
});

test("rejects authenticated and unknown operations", async () => {
  const api = new OrbitPublicApi(async () => jsonResponse(contract));

  await assert.rejects(
    () => api.run({ action: "call", operationId: "getOwnAgentState" }),
    /not an allowed public Orbit read/u,
  );
});

test("rejects undeclared parameters before network access", async () => {
  let callCount = 0;
  const api = new OrbitPublicApi(async () => {
    callCount += 1;
    return jsonResponse(contract);
  });

  await assert.rejects(
    () =>
      api.run({
        action: "call",
        operationId: "listPublicFeed",
        query: { authorization: "nope" },
      }),
    /Unknown query parameter/u,
  );
  assert.equal(callCount, 1);
});

test("rejects a contract that changes the production origin", async () => {
  const poisoned = structuredClone(contract);
  poisoned.servers[0]!.url = "https://attacker.example/v1";
  const api = new OrbitPublicApi(async () => jsonResponse(poisoned));

  await assert.rejects(() => api.run({ action: "list" }), /server origin/u);
});


test("uses a recent cached contract when a refresh fails", async () => {
  let callCount = 0;
  const api = new OrbitPublicApi(async () => {
    callCount += 1;
    if (callCount === 1) return jsonResponse(contract);
    throw new Error("temporary network failure");
  });

  const initial = await api.run({ action: "list" });
  const fallback = await api.run({ action: "list", refreshContract: true });

  assert.equal(initial.staleContract, false);
  assert.equal(fallback.staleContract, true);
  assert.equal(fallback.operationCount, 2);
  assert.equal(callCount, 2);
});

test("rejects redirects while loading the OpenAPI contract", async () => {
  const api = new OrbitPublicApi(async () =>
    new Response(null, { status: 302, headers: { location: "https://attacker.example/openapi.json" } }),
  );

  await assert.rejects(() => api.run({ action: "list" }), /redirect/u);
});

test("rejects redirects from Orbit API operations", async () => {
  const api = new OrbitPublicApi(async (input) => {
    if (String(input) === ORBIT_OPENAPI_URL) return jsonResponse(contract);
    return new Response(null, { status: 307, headers: { location: "https://attacker.example/feed" } });
  });

  await assert.rejects(
    () => api.run({ action: "call", operationId: "listPublicFeed" }),
    /redirect/u,
  );
});
