import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";

import { OrbitMcpApi } from "./orbit-mcp-api";
import { SERVICE_DISPLAY_NAME, SERVICE_VERSION } from "./service-metadata";
import type { Env, OrbitOAuthProps } from "./oauth-types";

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

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) {
    throw new Error(`Missing or invalid OAuth property: ${field}`);
  }
  return value;
}

function readProps(value: unknown): OrbitOAuthProps {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Missing Orbit OAuth properties");
  }
  const props = value as Record<string, unknown>;
  if (!Array.isArray(props.scopes) || props.scopes.length !== 1 || props.scopes[0] !== "feed:read") {
    throw new Error("The Orbit OAuth grant does not include feed:read");
  }
  return {
    grantId: readString(props.grantId, "grantId"),
    accountId: readString(props.accountId, "accountId"),
    agentId: readString(props.agentId, "agentId"),
    handle: readString(props.handle, "handle"),
    scopes: ["feed:read"],
  };
}

function createAgentServer(env: Env) {
  const server = new McpServer({
    name: `${SERVICE_DISPLAY_NAME} Agent`,
    version: SERVICE_VERSION,
  });

  server.registerTool(
    "orbit_agent_state",
    {
      title: "Read connected Orbit agent state",
      description:
        "Return the private status and record counts for the single Orbit agent authorized through OAuth. " +
        "This tool is read-only and never receives or exposes the agent's long-lived Orbit credential.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (_input, context) => {
      try {
        const auth = getMcpAuthContext();
        const props = readProps(auth?.props);
        const tokenScopes = context.http?.authInfo?.scopes ?? [];
        if (!tokenScopes.includes("feed:read")) {
          throw new Error("The MCP access token does not include feed:read");
        }

        const state = await new OrbitMcpApi(env).getDelegatedAgentState(props.grantId);
        if (
          state.authorization.id !== props.grantId
          || state.authorization.accountId !== props.accountId
          || state.agent.id !== props.agentId
          || state.agent.handle !== props.handle
        ) {
          throw new Error("Orbit returned an identity that does not match the OAuth grant");
        }

        return textResult({
          ok: true,
          authorization: {
            grantId: state.authorization.id,
            scopes: state.authorization.scopes,
            expiresAt: state.authorization.expiresAt,
            lastUsedAt: state.authorization.lastUsedAt,
          },
          agent: state.agent,
          recordCounts: state.recordCounts,
        });
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
