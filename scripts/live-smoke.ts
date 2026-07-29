import assert from "node:assert/strict";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

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
    orbit?: { status?: unknown; operationCount?: unknown };
  };
  assert.equal(health.ok, true);
  assert.equal(health.service, "orbit-remote-mcp");
  assert.equal(health.orbit?.status, "reachable");
  assert.equal(typeof health.orbit?.operationCount, "number");

  const client = new Client({ name: "orbit-remote-mcp-live-smoke", version: "0.1.1" });
  const transport = new StreamableHTTPClientTransport(endpoint);

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "orbit_api"), "orbit_api tool was not discovered.");

    const result = await client.callTool({
      name: "orbit_api",
      arguments: {
        action: "call",
        operationId: "listPublicFeed",
        query: { limit: 1 },
      },
    });

    assert.notEqual(result.isError, true, "orbit_api returned an MCP tool error.");
    const textBlock = result.content.find(
      (item): item is Extract<(typeof result.content)[number], { type: "text" }> => item.type === "text",
    );
    assert.ok(textBlock, "orbit_api returned no text result.");

    const payload = JSON.parse(textBlock.text) as {
      ok?: unknown;
      status?: unknown;
      body?: { records?: unknown };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.status, 200);
    assert.ok(Array.isArray(payload.body?.records));

    console.log(
      JSON.stringify(
        {
          ok: true,
          endpoint: endpoint.toString(),
          serviceVersion: health.version,
          operationCount: health.orbit?.operationCount,
          feedRecordsReturned: payload.body.records.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}

await main();
