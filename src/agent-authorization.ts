import type { OrbitOAuthProps } from "./oauth-types";
import {
  isCurrentOrbitScopeBundle,
  ORBIT_SCOPE_BUNDLE_VERSION,
} from "./orbit-scopes";

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
  if (!isCurrentOrbitScopeBundle(props.scopes)) {
    throw new Error("The Orbit OAuth grant requires reauthorization for the current permission bundle");
  }
  if (props.scopeBundleVersion !== ORBIT_SCOPE_BUNDLE_VERSION) {
    throw new Error("The Orbit OAuth permission bundle version is no longer current");
  }
  return {
    grantId: readString(props.grantId, "grantId"),
    accountId: readString(props.accountId, "accountId"),
    agentId: readString(props.agentId, "agentId"),
    handle: readString(props.handle, "handle"),
    scopes: [...props.scopes],
    scopeBundleVersion: ORBIT_SCOPE_BUNDLE_VERSION,
  };
}
