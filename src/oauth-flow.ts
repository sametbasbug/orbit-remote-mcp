import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

import {
  normalizeOrbitGrantScopes,
  ORBIT_GRANT_SCOPES,
  type OrbitGrantScope,
} from "./orbit-scopes";
import { ORBIT_DASHBOARD_URL } from "./service-metadata";

export const AUTHORIZATION_FLOW_TTL_SECONDS = 10 * 60;
export const AUTHORIZATION_FLOW_TTL_MS = AUTHORIZATION_FLOW_TTL_SECONDS * 1000;
export const OPTIONAL_SCOPE = "offline_access";

const FLOW_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createAuthorizationRequestId(): string {
  return crypto.randomUUID();
}

export function authorizationFlowKey(id: string): string {
  if (!FLOW_ID_PATTERN.test(id)) throw new Error("Invalid authorization request identifier");
  return `orbit-mcp-flow:v1:${id.toLowerCase()}`;
}

export function normalizeProviderScopes(requested: readonly string[]): string[] {
  const values = [...new Set(requested)];
  const allowed = new Set<string>([...ORBIT_GRANT_SCOPES, OPTIONAL_SCOPE]);
  if (values.some((scope) => !allowed.has(scope))) {
    throw new Error("The authorization request contains an unsupported scope");
  }

  let delegated: OrbitGrantScope[];
  try {
    delegated = normalizeOrbitGrantScopes(values.filter((scope) => scope !== OPTIONAL_SCOPE));
  } catch {
    throw new Error("The feed:read scope is required and write scopes must be canonical");
  }

  return values.includes(OPTIONAL_SCOPE)
    ? [...delegated, OPTIONAL_SCOPE]
    : delegated;
}

export function delegatedScopesFromProviderScopes(
  providerScopes: readonly string[],
): OrbitGrantScope[] {
  return normalizeOrbitGrantScopes(
    providerScopes.filter((scope) => scope !== OPTIONAL_SCOPE),
  );
}

export function orbitDashboardAuthorizationUrl(ticket: string): string {
  if (!ticket.startsWith("orb_mcp_auth_v1.")) {
    throw new Error("Invalid Orbit authorization ticket");
  }
  const url = new URL(ORBIT_DASHBOARD_URL);
  url.hash = new URLSearchParams({ mcp_authorization: ticket }).toString();
  return url.toString();
}

export function oauthErrorRedirect(
  request: AuthRequest,
  error: "access_denied" | "invalid_scope" | "server_error",
  description?: string,
): string {
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("error", error);
  if (description) redirect.searchParams.set("error_description", description.slice(0, 240));
  redirect.searchParams.set("state", request.state);
  return redirect.toString();
}

export function noStoreRedirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
      pragma: "no-cache",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
