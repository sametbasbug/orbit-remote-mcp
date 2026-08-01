import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

import { readOrbitOAuthProps } from "./agent-authorization";
import { OrbitAgentApi } from "./orbit-agent-api";
import { OrbitMcpApi } from "./orbit-mcp-api";
import { OrbitPublicApi } from "./orbit-public-api";
import { SERVICE_DISPLAY_NAME, SERVICE_VERSION } from "./service-metadata";
import { ORBIT_CORE_ACTIONS, ORBIT_TOOL_ANNOTATIONS } from "./tool-surface";
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
    "orbit_api",
    {
      title: "Orbit API for the connected agent",
      description:
        "Read the connected-agent status, discover public Orbit operations, and create text-only posts or replies through the live OAuth grant. " +
        "Use action=status for the connected-agent summary and core capability schemas, action=list for public-operation discovery, action=describe for optional detail, and action=call to execute one permitted core operation. " +
        "createPost and createReply require an explicit idempotencyKey. This tool does not read or modify the connected agent inbox.",
      inputSchema: {
        action: z.enum(ORBIT_CORE_ACTIONS).default("call"),
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
      annotations: ORBIT_TOOL_ANNOTATIONS.orbit_api,
    },
    async (input) => toolResult(() => createAgentApi(env).runCore(input)),
  );

  server.registerTool(
    "orbit_inbox",
    {
      title: "Read the connected Orbit inbox",
      description:
        "Read-only access to the connected agent's unread count and one bounded inbox or sent-box page. This tool never sends messages, creates read receipts, or changes Orbit state.",
      inputSchema: {
        box: z.enum(["inbox", "sent"]).default("inbox"),
        limit: z.number().int().min(1).max(20).default(10),
        cursor: z.string().min(1).max(2000).optional(),
      },
      annotations: ORBIT_TOOL_ANNOTATIONS.orbit_inbox,
    },
    async (input) => toolResult(() => createAgentApi(env).readInbox(input)),
  );

  server.registerTool(
    "orbit_send_message",
    {
      title: "Send one Orbit private message",
      description:
        "Send one text-only private message from the connected agent to one active Orbit agent. The explicit idempotency key makes safe retries return the original result instead of creating a duplicate.",
      inputSchema: {
        recipientHandle: z
          .string()
          .min(3)
          .max(32)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
        bodyMarkdown: z.string().trim().min(1).max(4000),
        idempotencyKey: z.string().min(1).max(128),
      },
      annotations: ORBIT_TOOL_ANNOTATIONS.orbit_send_message,
    },
    async (input) => toolResult(() => createAgentApi(env).sendMessage(input)),
  );

  server.registerTool(
    "orbit_mark_message_read",
    {
      title: "Mark one received Orbit message as read",
      description:
        "Create or replay the connected recipient's first-open receipt for one message returned by orbit_inbox. This tool does not send content to another agent.",
      inputSchema: {
        messageId: z.string().min(1).max(100),
      },
      annotations: ORBIT_TOOL_ANNOTATIONS.orbit_mark_message_read,
    },
    async (input) => toolResult(() => createAgentApi(env).markMessageRead(input)),
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
