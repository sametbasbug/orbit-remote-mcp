import { ORBIT_ORIGIN } from "./service-metadata";
import type { Env } from "./oauth-types";

const MAX_RESPONSE_BYTES = 128 * 1024;

interface OrbitErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
    requestId?: unknown;
  };
}

export interface OrbitAuthorizationTicketResponse {
  ticket: string;
  authorizationRequest: {
    id: string;
    oauthClient: { id: string; label: string };
    scopes: ["feed:read"];
    issuedAt: number;
    expiresAt: number;
  };
}

export interface OrbitDelegationRedemptionResponse {
  authorization: {
    id: string;
    accountId: string;
    agent: { id: string; handle: string };
    scopes: ["feed:read"];
    oauthClient: { id: string; label: string };
    status: "active" | "expired" | "revoked";
    createdAt: number;
    lastUsedAt: number | null;
    expiresAt: number | null;
    revokedAt: number | null;
    revokedReason: string | null;
  };
}

export interface OrbitDelegatedAgentStateResponse {
  authorization: OrbitDelegationRedemptionResponse["authorization"];
  agent: {
    id: string;
    handle: string;
    status: string;
    onboardingState: string;
    publicationMode: string;
  };
  recordCounts: {
    total: number;
    pending: number;
    published: number;
    rejected: number;
    deleted: number;
    pendingReview: number;
    moderated: number;
  };
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 240) : fallback;
}

function assertServiceSecret(secret: string): string {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Orbit MCP service authentication is not configured");
  }
  return secret;
}

function assertFeedReadScopes(value: unknown): asserts value is ["feed:read"] {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== "feed:read") {
    throw new Error("Orbit returned an unexpected delegated scope set");
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Orbit service unexpectedly redirected the request");
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Orbit service response exceeded the safety limit");
  }

  let value: unknown;
  try {
    value = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    throw new Error("Orbit service returned invalid JSON");
  }

  if (!response.ok) {
    const envelope = value as OrbitErrorEnvelope | null;
    const code = safeText(envelope?.error?.code, `http_${response.status}`);
    const message = safeText(envelope?.error?.message, "Orbit service rejected the request");
    throw new Error(`${code}: ${message}`);
  }

  return value as T;
}

export class OrbitMcpApi {
  readonly #service: Fetcher;
  readonly #serviceSecret: string;

  constructor(env: Pick<Env, "ORBIT_SERVICE" | "ORBIT_MCP_SERVICE_SECRET_V1">) {
    this.#service = env.ORBIT_SERVICE;
    this.#serviceSecret = assertServiceSecret(env.ORBIT_MCP_SERVICE_SECRET_V1);
  }

  async createAuthorizationTicket(input: {
    authorizationRequestId: string;
    oauthClientId: string;
    oauthClientLabel: string;
  }): Promise<OrbitAuthorizationTicketResponse> {
    const result = await this.#post<OrbitAuthorizationTicketResponse>(
      "/v1/mcp/authorization-tickets",
      {
        authorizationRequestId: input.authorizationRequestId,
        oauthClientId: input.oauthClientId,
        oauthClientLabel: input.oauthClientLabel,
        scopes: ["feed:read"],
      },
    );
    assertFeedReadScopes(result.authorizationRequest.scopes);
    return result;
  }

  async redeemDelegation(input: {
    code: string;
    authorizationRequestId: string;
  }): Promise<OrbitDelegationRedemptionResponse> {
    const result = await this.#post<OrbitDelegationRedemptionResponse>(
      "/v1/mcp/delegations/redeem",
      input,
    );
    assertFeedReadScopes(result.authorization.scopes);
    return result;
  }

  async getDelegatedAgentState(grantId: string): Promise<OrbitDelegatedAgentStateResponse> {
    const result = await this.#post<OrbitDelegatedAgentStateResponse>(
      `/v1/mcp/grants/${encodeURIComponent(grantId)}/agent/state`,
      {},
    );
    assertFeedReadScopes(result.authorization.scopes);
    return result;
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    const request = new Request(`${ORBIT_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#serviceSecret}`,
        "content-type": "application/json; charset=utf-8",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    const response = await this.#service.fetch(request);
    return parseJsonResponse<T>(response);
  }
}
