import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { agentMcpHandler } from "./agent-handler";
import { oauthDefaultHandler } from "./oauth-handler";
import {
  AGENT_MCP_URL,
  PRIMARY_ORIGIN,
  SERVICE_DISPLAY_NAME,
} from "./service-metadata";
import type { Env } from "./oauth-types";

const oauthProvider = new OAuthProvider<Env>({
  apiRoute: "/agent/mcp",
  apiHandler: agentMcpHandler,
  defaultHandler: oauthDefaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: ["feed:read", "offline_access"],
  allowPlainPKCE: false,
  allowImplicitFlow: false,
  clientIdMetadataDocumentEnabled: true,
  resourceMetadata: {
    resource: AGENT_MCP_URL,
    authorization_servers: [PRIMARY_ORIGIN],
    scopes_supported: ["feed:read"],
    bearer_methods_supported: ["header"],
    resource_name: `${SERVICE_DISPLAY_NAME} Agent`,
  },
  onError({ status, code, description }) {
    console.warn(JSON.stringify({
      event: "orbit_mcp.oauth_error",
      status,
      code,
      description: description?.slice(0, 240),
    }));
  },
});

export default {
  fetch(request, env, ctx) {
    return oauthProvider.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      oauthProvider.purgeExpiredData(env, { batchSize: 100 }).then((result) => {
        console.log(JSON.stringify({ event: "orbit_mcp.oauth_cleanup", ...result }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
