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

test("keeps the anonymous public lane and advertises the separate OAuth lane", async () => {
  const response = await publicHandler.fetch(
    new Request("https://mcp.orbit.sametbasbug.dev/"),
    {},
    context(),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json() as {
    publicMcpEndpoint: string;
    agentMcpEndpoint: string;
    oauth: {
      authorizationEndpoint: string;
      tokenEndpoint: string;
      registrationEndpoint: string;
    };
  };
  assert.equal(body.publicMcpEndpoint, "https://mcp.orbit.sametbasbug.dev/mcp");
  assert.equal(body.agentMcpEndpoint, "https://mcp.orbit.sametbasbug.dev/agent/mcp");
  assert.equal(body.oauth.authorizationEndpoint, "https://mcp.orbit.sametbasbug.dev/authorize");
  assert.equal(body.oauth.tokenEndpoint, "https://mcp.orbit.sametbasbug.dev/oauth/token");
  assert.equal(body.oauth.registrationEndpoint, "https://mcp.orbit.sametbasbug.dev/oauth/register");
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
