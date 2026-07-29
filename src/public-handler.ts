import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

import { OrbitPublicApi, ORBIT_OPENAPI_URL, ORBIT_SKILL_URL } from "./orbit-public-api";
import {
  AGENT_MCP_URL,
  FALLBACK_MCP_URL,
  OAUTH_AUTHORIZE_URL,
  OAUTH_REGISTER_URL,
  OAUTH_TOKEN_URL,
  PRIMARY_MCP_URL,
  SERVICE_DISPLAY_NAME,
  SERVICE_MODE,
  SERVICE_NAME,
  SERVICE_VERSION,
} from "./service-metadata";

const orbit = new OrbitPublicApi();
const mcpHandler = createMcpHandler(createServer);

const JSON_SECURITY_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

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

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

function createServer() {
  const server = new McpServer({
    name: SERVICE_DISPLAY_NAME,
    version: SERVICE_VERSION,
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return textResult(await orbit.run(input));
      } catch (error) {
        return {
          isError: true,
          ...textResult({ ok: false, error: safeErrorMessage(error) }),
        };
      }
    },
  );

  return server;
}

function rootResponse(): Response {
  return Response.json(
    {
      ok: true,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      mode: SERVICE_MODE,
      publicMcpEndpoint: PRIMARY_MCP_URL,
      agentMcpEndpoint: AGENT_MCP_URL,
      fallbackMcpEndpoint: FALLBACK_MCP_URL,
      oauth: {
        authorizationEndpoint: OAUTH_AUTHORIZE_URL,
        tokenEndpoint: OAUTH_TOKEN_URL,
        registrationEndpoint: OAUTH_REGISTER_URL,
      },
      healthEndpoint: "/health",
      orbitOpenApi: ORBIT_OPENAPI_URL,
      orbitGuide: ORBIT_SKILL_URL,
    },
    {
      headers: {
        ...JSON_SECURITY_HEADERS,
        "cache-control": "public, max-age=300",
      },
    },
  );
}

async function healthResponse(refreshContract: boolean): Promise<Response> {
  try {
    const contract = await orbit.run({ action: "list", refreshContract });
    const operations = Array.isArray(contract.operations) ? contract.operations : [];

    return Response.json(
      {
        ok: true,
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        mode: SERVICE_MODE,
        checkedAt: new Date().toISOString(),
        publicMcpEndpoint: PRIMARY_MCP_URL,
        agentMcpEndpoint: AGENT_MCP_URL,
        orbit: {
          status: "reachable",
          contractVersion: contract.contractVersion ?? null,
          contractUrl: contract.contractUrl ?? ORBIT_OPENAPI_URL,
          guideUrl: contract.guideUrl ?? ORBIT_SKILL_URL,
          operationCount: operations.length,
          staleContract: contract.staleContract === true,
          contractLoadedAt: contract.contractLoadedAt ?? null,
        },
      },
      {
        headers: {
          ...JSON_SECURITY_HEADERS,
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        mode: SERVICE_MODE,
        checkedAt: new Date().toISOString(),
        orbit: {
          status: "unreachable",
          error: safeErrorMessage(error),
        },
      },
      {
        status: 503,
        headers: {
          ...JSON_SECURITY_HEADERS,
          "cache-control": "no-store",
        },
      },
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return mcpHandler(request, env, ctx);
    }

    if (url.pathname === "/") return rootResponse();

    if (url.pathname === "/health") {
      return healthResponse(url.searchParams.get("refresh") === "1");
    }

    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    }

    return new Response("Not found", {
      status: 404,
      headers: { "x-content-type-options": "nosniff" },
    });
  },
} satisfies ExportedHandler;
