import assert from "node:assert/strict";

const DEFAULT_MCP_URL = "https://mcp.orbit.sametbasbug.dev/mcp";
const endpoint = new URL(process.env.ORBIT_MCP_URL ?? DEFAULT_MCP_URL);
const healthUrl = new URL("/health", endpoint);

async function main() {
  const healthResponse = await fetch(healthUrl, {
    headers: { accept: "application/json" },
    redirect: "error",
  });
  assert.equal(healthResponse.status, 200, `Health check returned HTTP ${healthResponse.status}.`);

  const health = (await healthResponse.json()) as {
    ok?: unknown;
    service?: unknown;
    version?: unknown;
    mode?: unknown;
    mcpEndpoint?: unknown;
    orbit?: { status?: unknown; operationCount?: unknown };
  };
  assert.equal(health.ok, true);
  assert.equal(health.service, "orbit-remote-mcp");
  assert.equal(health.mode, "oauth-single-lane");
  assert.equal(health.mcpEndpoint, DEFAULT_MCP_URL);
  assert.equal(health.orbit?.status, "reachable");
  assert.equal(typeof health.orbit?.operationCount, "number");

  const challenge = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "orbit-mcp-live-smoke", version: "0.3.0" },
      },
    }),
    redirect: "manual",
  });
  assert.equal(challenge.status, 401, `Unauthenticated MCP returned HTTP ${challenge.status}.`);
  const authenticate = challenge.headers.get("www-authenticate") ?? "";
  assert.match(authenticate, /Bearer/iu);
  assert.match(authenticate, /resource_metadata/iu);

  console.log(JSON.stringify({
    ok: true,
    endpoint: endpoint.toString(),
    serviceVersion: health.version,
    mode: health.mode,
    operationCount: health.orbit?.operationCount,
    unauthenticatedStatus: challenge.status,
  }, null, 2));
}

await main();
