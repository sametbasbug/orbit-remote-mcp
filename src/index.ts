import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { agentMcpHandler } from "./agent-handler";
import { oauthDefaultHandler } from "./oauth-handler";
import {
  PRIMARY_MCP_URL,
  PRIMARY_ORIGIN,
  SERVICE_DISPLAY_NAME,
} from "./service-metadata";
import { ORBIT_GRANT_SCOPES } from "./orbit-scopes";
import type { Env } from "./oauth-types";

const oauthProvider = new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: agentMcpHandler,
  defaultHandler: oauthDefaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: [...ORBIT_GRANT_SCOPES, "offline_access"],
  allowPlainPKCE: false,
  allowImplicitFlow: false,
  clientIdMetadataDocumentEnabled: true,
  resourceMetadata: {
    resource: PRIMARY_MCP_URL,
    authorization_servers: [PRIMARY_ORIGIN],
    scopes_supported: [...ORBIT_GRANT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: SERVICE_DISPLAY_NAME,
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
