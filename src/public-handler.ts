import { OrbitPublicApi, ORBIT_OPENAPI_URL, ORBIT_SKILL_URL } from "./orbit-public-api";
import {
  OAUTH_AUTHORIZE_URL,
  OAUTH_REGISTER_URL,
  OAUTH_TOKEN_URL,
  PRIMARY_MCP_URL,
  RETIRED_AGENT_MCP_URL,
  SERVICE_MODE,
  SERVICE_NAME,
  SERVICE_VERSION,
} from "./service-metadata";

const orbit = new OrbitPublicApi();

const JSON_SECURITY_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

function rootResponse(): Response {
  return Response.json(
    {
      ok: true,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      mode: SERVICE_MODE,
      mcpEndpoint: PRIMARY_MCP_URL,
      retiredEndpoint: RETIRED_AGENT_MCP_URL,
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
        mcpEndpoint: PRIMARY_MCP_URL,
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
        mcpEndpoint: PRIMARY_MCP_URL,
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

function retiredAgentEndpoint(): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code: "mcp_endpoint_retired",
        message: "The /agent/mcp endpoint is retired. Create a new OAuth connection using /mcp.",
      },
      mcpEndpoint: PRIMARY_MCP_URL,
    },
    {
      status: 410,
      headers: {
        ...JSON_SECURITY_HEADERS,
        "cache-control": "no-store",
      },
    },
  );
}

export default {
  async fetch(request, _env, _ctx) {
    const url = new URL(request.url);

    if (url.pathname === RETIRED_AGENT_MCP_URL.replace(new URL(RETIRED_AGENT_MCP_URL).origin, "")
      || url.pathname.startsWith("/agent/mcp/")) {
      return retiredAgentEndpoint();
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
