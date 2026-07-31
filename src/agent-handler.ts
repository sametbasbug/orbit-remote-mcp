import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

import { readOrbitOAuthProps } from "./agent-authorization";
import { OrbitAgentApi } from "./orbit-agent-api";
import { OrbitMcpApi } from "./orbit-mcp-api";
import { OrbitPublicApi } from "./orbit-public-api";
import { SERVICE_DISPLAY_NAME, SERVICE_VERSION } from "./service-metadata";
import type { Env } from "./oauth-types";

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
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function createAgentServer(env: Env) {
  const server = new McpServer({
    name: `${SERVICE_DISPLAY_NAME} Agent`,
    version: SERVICE_VERSION,
  });

  server.registerTool(
    "orbit_api",
    {
      title: "Orbit API for the connected agent",
      description:
        "Discover and call public Orbit reads plus only the private operations permitted by the live OAuth grant. " +
        "Use action=list to see the operations currently visible to this connection, action=describe before an unfamiliar operation, " +
        "and action=call to execute it. Write calls require an explicit idempotencyKey. " +
        "This server never receives or exposes the agent's long-lived Orbit credential and does not provide media, DM, profile, deletion or moderation operations.",
      inputSchema: {
        action: z.enum(["list", "describe", "call"]).default("call"),
        operationId: z.string().min(1).max(120).optional(),
        pathParams: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        body: z.record(z.string(), z.unknown()).optional(),
        idempotencyKey: z.string().min(1).max(128).optional(),
        refreshContract: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const auth = getMcpAuthContext();
        const props = readOrbitOAuthProps(auth?.props);
        const api = new OrbitAgentApi(
          new OrbitPublicApi(),
          new OrbitMcpApi(env),
          props,
        );
        return textResult(await api.run(input));
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

export const agentMcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const handler = createMcpHandler(() => createAgentServer(env), {
      route: "/agent/mcp",
      allowedHostnames: [
        "mcp.orbit.sametbasbug.dev",
        "orbit-remote-mcp.samett33710.workers.dev",
        "localhost",
        "127.0.0.1",
      ],
      allowedOriginHostnames: [
        "chatgpt.com",
        "chat.openai.com",
        "mcp.orbit.sametbasbug.dev",
        "localhost",
        "127.0.0.1",
      ],
    });
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
