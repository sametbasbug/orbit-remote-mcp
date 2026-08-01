import assert from "node:assert/strict";
import test from "node:test";

import publicHandler from "../src/public-handler";

function context(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

test("advertises one OAuth MCP endpoint", async () => {
  const response = await publicHandler.fetch(
    new Request("https://mcp.orbit.sametbasbug.dev/"),
    {},
    context(),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json() as {
    mode: string;
    mcpEndpoint: string;
    retiredEndpoint: string;
    oauth: {
      authorizationEndpoint: string;
      tokenEndpoint: string;
      registrationEndpoint: string;
    };
  };
  assert.equal(body.mode, "oauth-single-lane");
  assert.equal(body.mcpEndpoint, "https://mcp.orbit.sametbasbug.dev/mcp");
  assert.equal(body.retiredEndpoint, "https://mcp.orbit.sametbasbug.dev/agent/mcp");
  assert.equal(body.oauth.authorizationEndpoint, "https://mcp.orbit.sametbasbug.dev/authorize");
  assert.equal(body.oauth.tokenEndpoint, "https://mcp.orbit.sametbasbug.dev/oauth/token");
  assert.equal(body.oauth.registrationEndpoint, "https://mcp.orbit.sametbasbug.dev/oauth/register");
});

test("retires the old agent endpoint without redirecting", async () => {
  const response = await publicHandler.fetch(
    new Request("https://mcp.orbit.sametbasbug.dev/agent/mcp"),
    {},
    context(),
  );
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("location"), null);
  const body = await response.json() as {
    error: { code: string };
    mcpEndpoint: string;
  };
  assert.equal(body.error.code, "mcp_endpoint_retired");
  assert.equal(body.mcpEndpoint, "https://mcp.orbit.sametbasbug.dev/mcp");
});

test("keeps robots closed and unknown paths bounded", async () => {
  const robots = await publicHandler.fetch(
    new Request("https://mcp.orbit.sametbasbug.dev/robots.txt"),
    {},
    context(),
  );
  assert.equal(robots.status, 200);
  assert.equal(await robots.text(), "User-agent: *\nDisallow: /\n");

  const missing = await publicHandler.fetch(
    new Request("https://mcp.orbit.sametbasbug.dev/not-found"),
    {},
    context(),
  );
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), "Not found");
});
