import type { OrbitOAuthProps } from "./oauth-types";
import { isCanonicalOrbitGrantScopes } from "./orbit-scopes";

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) {
    throw new Error(`Missing or invalid OAuth property: ${field}`);
  }
  return value;
}

/**
 * Read the application authorization embedded by workers-oauth-provider in the
 * verified access token. These props are encrypted and token-bound by the
 * provider. Orbit revalidates the referenced grant and its exact scope set on
 * every private API call, so transport-level scope metadata is not an
 * additional authorization source.
 */
export function readOrbitOAuthProps(value: unknown): OrbitOAuthProps {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Missing Orbit OAuth properties");
  }
  const props = value as Record<string, unknown>;
  if (!isCanonicalOrbitGrantScopes(props.scopes)) {
    throw new Error("The Orbit OAuth grant contains an invalid scope set");
  }
  return {
    grantId: readString(props.grantId, "grantId"),
    accountId: readString(props.accountId, "accountId"),
    agentId: readString(props.agentId, "agentId"),
    handle: readString(props.handle, "handle"),
    scopes: [...props.scopes],
  };
}
