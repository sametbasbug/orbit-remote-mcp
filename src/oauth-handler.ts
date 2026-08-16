import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

import publicHandler from "./public-handler";
import {
  AUTHORIZATION_FLOW_TTL_MS,
  AUTHORIZATION_FLOW_TTL_SECONDS,
  CURRENT_DELEGATED_SCOPES,
  authorizationFlowKey,
  createAuthorizationRequestId,
  delegatedScopesFromProviderScopes,
  noStoreRedirect,
  normalizeProviderScopes,
  oauthErrorRedirect,
  orbitDashboardAuthorizationUrl,
} from "./oauth-flow";
import { OrbitMcpApi } from "./orbit-mcp-api";

import type { Env, OrbitOAuthProps, StoredAuthorizationFlow } from "./oauth-types";

function safeClientName(value: unknown, clientId: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return (candidate || clientId).slice(0, 120);
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

async function readFlow(env: Env, id: string): Promise<StoredAuthorizationFlow | null> {
  return env.OAUTH_KV.get<StoredAuthorizationFlow>(authorizationFlowKey(id), "json");
}

async function deleteFlow(env: Env, id: string): Promise<void> {
  await env.OAUTH_KV.delete(authorizationFlowKey(id));
}

function terminalError(
  request: AuthRequest,
  error: "access_denied" | "invalid_scope" | "server_error",
  description?: string,
): Response {
  return noStoreRedirect(oauthErrorRedirect(request, error, description));
}

async function beginAuthorization(request: Request, env: Env): Promise<Response> {
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch {
    return new Response("Invalid authorization request", {
      status: 400,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) {
    return new Response("Unknown OAuth client", {
      status: 400,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }

  let providerScopes: string[];
  try {
    providerScopes = normalizeProviderScopes(oauthRequest.scope);
  } catch {
    return terminalError(
      oauthRequest,
      "invalid_scope",
      `Orbit requires the complete current permission bundle: ${CURRENT_DELEGATED_SCOPES.join(", ")}. offline_access remains optional.`,
    );
  }

  const authorizationRequestId = createAuthorizationRequestId();
  const clientName = safeClientName(client.clientName, oauthRequest.clientId);

  try {
    const ticket = await new OrbitMcpApi(env).createAuthorizationTicket({
      authorizationRequestId,
      oauthClientId: oauthRequest.clientId,
      oauthClientLabel: clientName,
      scopes: delegatedScopesFromProviderScopes(providerScopes),
    });
    const now = Date.now();
    const flow: StoredAuthorizationFlow = {
      request: oauthRequest,
      providerScopes,
      clientName,
      createdAt: now,
      expiresAt: now + AUTHORIZATION_FLOW_TTL_MS,
    };
    await env.OAUTH_KV.put(authorizationFlowKey(authorizationRequestId), JSON.stringify(flow), {
      expirationTtl: AUTHORIZATION_FLOW_TTL_SECONDS,
    });
    return noStoreRedirect(orbitDashboardAuthorizationUrl(ticket.ticket));
  } catch (error) {
    console.error(JSON.stringify({
      event: "orbit_mcp.authorization_start_failed",
      error: safeErrorMessage(error),
    }));
    return terminalError(oauthRequest, "server_error", "Orbit authorization could not be started.");
  }
}

async function finishAuthorization(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const authorizationRequestId = url.searchParams.get("authorization_request_id") ?? "";

  let flow: StoredAuthorizationFlow | null;
  try {
    flow = await readFlow(env, authorizationRequestId);
  } catch {
    flow = null;
  }
  if (!flow || flow.expiresAt <= Date.now()) {
    return new Response("Authorization request expired", {
      status: 400,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }

  if (url.searchParams.has("error")) {
    await deleteFlow(env, authorizationRequestId);
    return terminalError(flow.request, "access_denied", "Orbit access was not approved.");
  }

  const code = url.searchParams.get("code") ?? "";
  if (!code.startsWith("orb_mcp_v1_")) {
    return new Response("Invalid delegation response", {
      status: 400,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }

  try {
    const redeemed = await new OrbitMcpApi(env).redeemDelegation({
      code,
      authorizationRequestId,
    });
    const authorization = redeemed.authorization;
    if (
      authorization.status !== "active"
      || authorization.oauthClient.id !== flow.request.clientId
    ) {
      throw new Error("Orbit delegation did not match the OAuth authorization request");
    }

    const props: OrbitOAuthProps = {
      grantId: authorization.id,
      accountId: authorization.accountId,
      agentId: authorization.agent.id,
      handle: authorization.agent.handle,
      scopes: [...authorization.scopes],
      scopeBundleVersion: authorization.scopeBundleVersion,
    };
    const grantedProviderScopes = flow.providerScopes.includes("offline_access")
      ? [...authorization.scopes, "offline_access"]
      : [...authorization.scopes];

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: flow.request,
      userId: authorization.accountId,
      metadata: {
        orbitGrantId: authorization.id,
        agentHandle: authorization.agent.handle,
        clientName: flow.clientName,
      },
      scope: grantedProviderScopes,
      props,
    });

    await deleteFlow(env, authorizationRequestId);
    return noStoreRedirect(redirectTo);
  } catch (error) {
    await deleteFlow(env, authorizationRequestId).catch(() => undefined);
    console.error(JSON.stringify({
      event: "orbit_mcp.authorization_finish_failed",
      authorizationRequestId,
      error: safeErrorMessage(error),
    }));
    return terminalError(flow.request, "server_error", "Orbit authorization could not be completed.");
  }
}

export const oauthDefaultHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/authorize") {
      return beginAuthorization(request, env);
    }
    if (request.method === "GET" && url.pathname === "/oauth/orbit/callback") {
      return finishAuthorization(request, env);
    }
    return publicHandler.fetch(request, env, ctx);
  },
};
