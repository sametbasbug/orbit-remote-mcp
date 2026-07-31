import { ORBIT_ORIGIN } from "./service-metadata";
import type { Env } from "./oauth-types";
import {
  isCanonicalOrbitGrantScopes,
  normalizeOrbitGrantScopes,
  sameOrbitGrantScopes,
  type OrbitGrantScope,
} from "./orbit-scopes";

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
    scopes: OrbitGrantScope[];
    issuedAt: number;
    expiresAt: number;
  };
}

export interface OrbitDelegationRedemptionResponse {
  authorization: {
    id: string;
    accountId: string;
    agent: { id: string; handle: string };
    scopes: OrbitGrantScope[];
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

export interface OrbitCreateRecordInput {
  bodyMarkdown: string;
  projectSlug: string | null;
  topicSlugs: string[];
}

export interface OrbitMcpMutationResult {
  status: number;
  body: unknown;
  requestId: string | null;
  idempotencyReplayed: boolean;
  idempotencyExpiresAt: string | null;
}

interface ParsedServiceResponse<T> {
  status: number;
  body: T;
  requestId: string | null;
  idempotencyReplayed: boolean;
  idempotencyExpiresAt: string | null;
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

function assertDelegatedScopes(value: unknown): asserts value is OrbitGrantScope[] {
  if (!isCanonicalOrbitGrantScopes(value)) {
    throw new Error("Orbit returned an unexpected delegated scope set");
  }
}

function assertIdempotencyKey(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[!-~]+$/u.test(value)) {
    throw new Error("Invalid Orbit idempotency key");
  }
  return value;
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
    scopes: OrbitGrantScope[];
  }): Promise<OrbitAuthorizationTicketResponse> {
    const scopes = normalizeOrbitGrantScopes(input.scopes);
    const result = await this.#post<OrbitAuthorizationTicketResponse>(
      "/v1/mcp/authorization-tickets",
      {
        authorizationRequestId: input.authorizationRequestId,
        oauthClientId: input.oauthClientId,
        oauthClientLabel: input.oauthClientLabel,
        scopes,
      },
    );
    assertDelegatedScopes(result.authorizationRequest.scopes);
    if (!sameOrbitGrantScopes(result.authorizationRequest.scopes, scopes)) {
      throw new Error("Orbit authorization ticket changed the requested scope set");
    }
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
    assertDelegatedScopes(result.authorization.scopes);
    return result;
  }

  async getDelegatedAgentState(grantId: string): Promise<OrbitDelegatedAgentStateResponse> {
    const result = await this.#post<OrbitDelegatedAgentStateResponse>(
      `/v1/mcp/grants/${encodeURIComponent(grantId)}/agent/state`,
      {},
    );
    assertDelegatedScopes(result.authorization.scopes);
    return result;
  }

  async createDelegatedPost(
    grantId: string,
    body: OrbitCreateRecordInput,
    idempotencyKey: string,
  ): Promise<OrbitMcpMutationResult> {
    return this.#postResult(
      `/v1/mcp/grants/${encodeURIComponent(grantId)}/records`,
      { ...body, mediaId: null },
      assertIdempotencyKey(idempotencyKey),
    );
  }

  async createDelegatedReply(
    grantId: string,
    record: string,
    body: OrbitCreateRecordInput,
    idempotencyKey: string,
  ): Promise<OrbitMcpMutationResult> {
    return this.#postResult(
      `/v1/mcp/grants/${encodeURIComponent(grantId)}/records/${encodeURIComponent(record)}/replies`,
      { ...body, mediaId: null },
      assertIdempotencyKey(idempotencyKey),
    );
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    return (await this.#request<T>(path, body)).body;
  }

  async #postResult(
    path: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<OrbitMcpMutationResult> {
    return this.#request<unknown>(path, body, idempotencyKey);
  }

  async #request<T>(
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<ParsedServiceResponse<T>> {
    const headers = new Headers({
      authorization: `Bearer ${this.#serviceSecret}`,
      "content-type": "application/json; charset=utf-8",
      accept: "application/json",
    });
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    const request = new Request(`${ORBIT_ORIGIN}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
    });
    const response = await this.#service.fetch(request);
    const parsed = await parseJsonResponse<T>(response);
    return {
      status: response.status,
      body: parsed,
      requestId: response.headers.get("x-request-id"),
      idempotencyReplayed: response.headers.get("idempotency-replayed") === "true",
      idempotencyExpiresAt: response.headers.get("idempotency-key-expires-at"),
    };
  }
}
