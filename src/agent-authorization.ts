import type { OrbitOAuthProps } from "./oauth-types";

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) {
    throw new Error(`Missing or invalid OAuth property: ${field}`);
  }
  return value;
}

/**
 * Read the application authorization embedded by workers-oauth-provider in the
 * verified access token. These props are encrypted and token-bound by the
 * provider. Orbit revalidates the referenced grant and its feed:read scope on
 * every private API call, so transport-level scope metadata is not an
 * additional authorization source.
 */
export function readOrbitOAuthProps(value: unknown): OrbitOAuthProps {
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
