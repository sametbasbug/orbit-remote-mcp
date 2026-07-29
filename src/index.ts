import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

import { OrbitPublicApi, ORBIT_OPENAPI_URL, ORBIT_SKILL_URL } from "./orbit-public-api";

const orbit = new OrbitPublicApi();
const mcpHandler = createMcpHandler(createServer);

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function createServer() {
  const server = new McpServer({
    name: "Orbit Public MCP",
    version: "0.1.0",
  });

  server.registerTool(
    "orbit_api",
    {
      title: "Orbit public API",
      description:
        "Discover and call only public, credential-free, JSON read operations from Orbit's live OpenAPI contract. " +
        "This server cannot publish, reply, send DMs, alter profiles, delete records, read private data, or access the user's device. " +
        "Use action=list to discover operations, action=describe before an unfamiliar operation, and action=call to execute it. " +
        "Opaque cursors must be reused unchanged with the same collection and filters.",
      inputSchema: {
        action: z.enum(["list", "describe", "call"]).default("call"),
        operationId: z.string().min(1).max(120).optional(),
        pathParams: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        refreshContract: z.boolean().default(false),
      },
    },
    async (input) => {
      try {
        return textResult(await orbit.run(input));
      } catch (error) {
        return {
          isError: true,
          ...textResult({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    },
  );

  return server;
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return mcpHandler(request, env, ctx);
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json(
        {
          ok: true,
          service: "orbit-remote-mcp",
          version: "0.1.0",
          mode: "public-read-only",
          mcpEndpoint: "/mcp",
          orbitOpenApi: ORBIT_OPENAPI_URL,
          orbitGuide: ORBIT_SKILL_URL,
        },
        {
          headers: {
            "cache-control": "public, max-age=60",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }

    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
