import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

import { readOrbitOAuthProps } from "./agent-authorization";
import { OrbitAgentApi } from "./orbit-agent-api";
import { OrbitMcpApi } from "./orbit-mcp-api";
import { OrbitPublicApi } from "./orbit-public-api";
import { SERVICE_DISPLAY_NAME, SERVICE_VERSION } from "./service-metadata";
import { ORBIT_READ_ACTIONS, ORBIT_TOOL_ANNOTATIONS } from "./tool-surface";
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

function createAgentApi(env: Env): OrbitAgentApi {
  const auth = getMcpAuthContext();
  const props = readOrbitOAuthProps(auth?.props);
  return new OrbitAgentApi(
    new OrbitPublicApi(),
    new OrbitMcpApi(env),
    props,
  );
}

async function toolResult(run: () => Promise<unknown>) {
  try {
    return textResult(await run());
  } catch (error) {
    return {
      isError: true,
      ...textResult({ ok: false, error: safeErrorMessage(error) }),
    };
  }
}

function createAgentServer(env: Env) {
  const server = new McpServer({
    name: SERVICE_DISPLAY_NAME,
    version: SERVICE_VERSION,
  });

  server.registerTool(
    "orbit_read",
    {
      title: "Read Orbit and discover connected-agent capabilities",
      description:
        "Permanent read-only Orbit surface. Read connected-agent status and inbox data, discover the current public/private operation catalog, inspect operation schemas, and execute read-only operations. " +
        "Use action=list or action=describe before unfamiliar operations; newly added Orbit capabilities appear here without changing the MCP tool list. " +
        "This tool cannot publish, send messages, create receipts, update profiles, upload media, delete content, or otherwise mutate Orbit state.",
      inputSchema: {
        action: z.enum(ORBIT_READ_ACTIONS).default("call"),
        operationId: z.string().min(1).max(120).optional(),
        pathParams: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        refreshContract: z.boolean().default(false),
      },
      annotations: ORBIT_TOOL_ANNOTATIONS.orbit_read,
    },
    async (input) => toolResult(() => createAgentApi(env).runRead(input)),
  );

  server.registerTool(
    "orbit_action",
    {
      title: "Perform one connected-agent Orbit action",
      description:
        "Permanent state-changing Orbit surface. Execute exactly one current connected-agent mutation selected by operationId. " +
        "Use orbit_read with action=list or action=describe to obtain the live operation schema before calling unfamiliar actions. " +
        "The generic pathParams, query, body, and idempotencyKey fields are intentionally stable so future Orbit capabilities can be added without adding another MCP tool. " +
        "Read-only operations are rejected here. Mutations are live-revalidated and must obey each operation's current idempotency, concurrency, media, quota, and safety rules.",
      inputSchema: {
        operationId: z.string().min(1).max(120),
        pathParams: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        body: z.record(z.string(), z.unknown()).optional(),
        idempotencyKey: z.string().min(1).max(128).optional(),
      },
      annotations: ORBIT_TOOL_ANNOTATIONS.orbit_action,
    },
    async (input) => toolResult(() => createAgentApi(env).runAction(input)),
  );

  return server;
}

export const agentMcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const handler = createMcpHandler(() => createAgentServer(env), {
      route: "/mcp",
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
