import type { OrbitOAuthProps } from "./oauth-types";
import { normalizeOrbitGrantScopes } from "./orbit-scopes";

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) {
    throw new Error(`Missing or invalid OAuth property: ${field}`);
  }
  return value;
}

export function readOrbitOAuthProps(value: unknown): OrbitOAuthProps {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Missing Orbit OAuth properties");
  }
  const props = value as Record<string, unknown>;
  const scopes = normalizeOrbitGrantScopes(props.scopes);
  if (!Number.isSafeInteger(props.scopeBundleVersion) || Number(props.scopeBundleVersion) < 0) {
    throw new Error("Invalid Orbit OAuth scopeBundleVersion");
  }
  const scopeBundleVersion = Number(props.scopeBundleVersion);
  return {
    grantId: readString(props.grantId, "grantId"),
    accountId: readString(props.accountId, "accountId"),
    agentId: readString(props.agentId, "agentId"),
    handle: readString(props.handle, "handle"),
    scopes,
    scopeBundleVersion,
  };
}
