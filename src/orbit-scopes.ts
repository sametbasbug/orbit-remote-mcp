export const ORBIT_GRANT_SCOPES = [
  "feed:read",
  "posts:write",
  "replies:write",
  "reactions:write",
  "messages:read",
  "messages:write",
] as const;

export const ORBIT_SCOPE_BUNDLE_VERSION = 3;
export const CURRENT_ORBIT_SCOPE_BUNDLE = [...ORBIT_GRANT_SCOPES] as const;

export type OrbitGrantScope = (typeof ORBIT_GRANT_SCOPES)[number];

const ORBIT_GRANT_SCOPE_SET = new Set<string>(ORBIT_GRANT_SCOPES);

export function normalizeOrbitGrantScopes(value: unknown): OrbitGrantScope[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > ORBIT_GRANT_SCOPES.length) {
    throw new Error("Orbit returned an unexpected delegated scope set");
  }

  const requested = value.map((scope) => {
    if (typeof scope !== "string" || !ORBIT_GRANT_SCOPE_SET.has(scope)) {
      throw new Error("Orbit returned an unexpected delegated scope set");
    }
    return scope as OrbitGrantScope;
  });

  if (new Set(requested).size !== requested.length || !requested.includes("feed:read")) {
    throw new Error("Orbit returned an unexpected delegated scope set");
  }

  return ORBIT_GRANT_SCOPES.filter((scope) => requested.includes(scope));
}

export function isCanonicalOrbitGrantScopes(value: unknown): value is OrbitGrantScope[] {
  try {
    const normalized = normalizeOrbitGrantScopes(value);
    return Array.isArray(value)
      && value.length === normalized.length
      && normalized.every((scope, index) => value[index] === scope);
  } catch {
    return false;
  }
}

export function isCurrentOrbitScopeBundle(value: unknown): value is OrbitGrantScope[] {
  try {
    const normalized = normalizeOrbitGrantScopes(value);
    return normalized.length === CURRENT_ORBIT_SCOPE_BUNDLE.length
      && CURRENT_ORBIT_SCOPE_BUNDLE.every((scope, index) => normalized[index] === scope);
  } catch {
    return false;
  }
}

export function normalizeCurrentOrbitScopeBundle(value: unknown): OrbitGrantScope[] {
  if (!isCurrentOrbitScopeBundle(value)) {
    throw new Error("Orbit requires the complete current permission bundle");
  }
  return [...CURRENT_ORBIT_SCOPE_BUNDLE];
}

export function sameOrbitGrantScopes(
  left: readonly OrbitGrantScope[],
  right: readonly OrbitGrantScope[],
): boolean {
  return left.length === right.length && left.every((scope, index) => scope === right[index]);
}
