import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  ORBIT_SERVICE: Fetcher;
  ORBIT_MCP_SERVICE_SECRET_V1: string;
}

export interface OrbitOAuthProps {
  grantId: string;
  accountId: string;
  agentId: string;
  handle: string;
  scopes: ["feed:read"];
}

export interface StoredAuthorizationFlow {
  request: AuthRequest;
  providerScopes: string[];
  clientName: string;
  createdAt: number;
  expiresAt: number;
}
