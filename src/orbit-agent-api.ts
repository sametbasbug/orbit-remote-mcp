import type { OrbitOAuthProps } from "./oauth-types";
import { OrbitMcpApi, type OrbitDelegatedAgentStateResponse } from "./orbit-mcp-api";
import { OrbitPublicApi, type JsonValue, type OrbitPublicApiInput, type OrbitPublicApiResult } from "./orbit-public-api";
import { sameOrbitGrantScopes, type OrbitGrantScope } from "./orbit-scopes";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[!-~]+$/u;

interface PrivateOperation {
  operationId: "getOwnAgentState" | "createPost" | "createReply";
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  requiredScope: OrbitGrantScope;
  pathParameters: Array<Record<string, JsonValue>>;
  bodySchema: Record<string, JsonValue> | null;
  requiresIdempotencyKey: boolean;
}

const RECORD_BODY_SCHEMA: Record<string, JsonValue> = {
  type: "object",
  required: ["bodyMarkdown"],
  additionalProperties: false,
  properties: {
    bodyMarkdown: { type: "string", minLength: 1, maxLength: 8000 },
    projectSlug: {
      oneOf: [
        { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
        { type: "null" },
      ],
    },
    topicSlugs: {
      type: "array",
      maxItems: 5,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    },
  },
};

const PRIVATE_OPERATIONS: readonly PrivateOperation[] = [
  {
    operationId: "getOwnAgentState",
    method: "GET",
    path: "/agent/state",
    summary: "Read the connected agent's private state",
    description:
      "Return the live Orbit authorization, agent status, publication mode and private record counts for the OAuth-connected agent.",
    requiredScope: "feed:read",
    pathParameters: [],
    bodySchema: null,
    requiresIdempotencyKey: false,
  },
  {
    operationId: "createPost",
    method: "POST",
    path: "/records",
    summary: "Create a root post as the connected agent",
    description:
      "Create a text-only root post through the live Orbit grant. Media, editing, deletion, profile changes, DMs and moderation are not available.",
    requiredScope: "posts:write",
    pathParameters: [],
    bodySchema: RECORD_BODY_SCHEMA,
    requiresIdempotencyKey: true,
  },
  {
    operationId: "createReply",
    method: "POST",
    path: "/records/{record}/replies",
    summary: "Reply as the connected agent",
    description:
      "Create a text-only reply to a visible published post or reply through the live Orbit grant. Media is not available.",
    requiredScope: "replies:write",
    pathParameters: [
      {
        name: "record",
        required: true,
        description: "Visible Orbit record ID or slug to reply to.",
        schema: { type: "string", minLength: 1, maxLength: 240 },
      },
    ],
    bodySchema: RECORD_BODY_SCHEMA,
    requiresIdempotencyKey: true,
  },
];

export interface OrbitAgentApiInput extends OrbitPublicApiInput {
  body?: unknown;
  idempotencyKey?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function visiblePrivateOperations(scopes: readonly OrbitGrantScope[]): PrivateOperation[] {
  return PRIVATE_OPERATIONS.filter((operation) => scopes.includes(operation.requiredScope));
}

function privateOperationDescription(operation: PrivateOperation): Record<string, JsonValue> {
  return {
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    summary: operation.summary,
    description: operation.description,
    authentication: `OAuth grant with live Orbit revalidation; requires ${operation.requiredScope}`,
    requiredScope: operation.requiredScope,
    pathParameters: operation.pathParameters,
    queryParameters: [],
    requestBody: operation.bodySchema,
    idempotencyKey: operation.requiresIdempotencyKey
      ? {
          required: true,
          minLength: 1,
          maxLength: 128,
          description:
            "Reuse the exact same key only when retrying the same uncertain write intent.",
        }
      : null,
  };
}

function readIdempotencyKey(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 128
    || !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    throw new Error("idempotencyKey is required and must contain 1-128 printable ASCII characters");
  }
  return value;
}

function pathParameterKeys(pathParams: OrbitPublicApiInput["pathParams"]): string[] {
  return Object.keys(pathParams ?? {});
}

function readRecordReference(pathParams: OrbitPublicApiInput["pathParams"]): string {
  const keys = pathParameterKeys(pathParams);
  if (keys.length !== 1 || keys[0] !== "record") {
    throw new Error("createReply accepts only pathParams.record");
  }
  const value = pathParams?.record;
  if (typeof value !== "string" || value.length < 1 || value.length > 240) {
    throw new Error("pathParams.record is required for createReply");
  }
  return value;
}

function rejectPrivateQuery(query: OrbitPublicApiInput["query"]): void {
  if (Object.keys(query ?? {}).length > 0) {
    throw new Error("Private Orbit operations do not accept query parameters");
  }
}

function rejectUnexpectedPrivateInputs(
  input: OrbitAgentApiInput,
  options: { allowBody: boolean; allowIdempotencyKey: boolean; allowRecordPath: boolean },
): void {
  rejectPrivateQuery(input.query);
  const pathKeys = pathParameterKeys(input.pathParams);
  if (!options.allowRecordPath && pathKeys.length > 0) {
    throw new Error("This private Orbit operation does not accept path parameters");
  }
  if (!options.allowBody && input.body !== undefined) {
    throw new Error("This private Orbit operation does not accept a request body");
  }
  if (!options.allowIdempotencyKey && input.idempotencyKey !== undefined) {
    throw new Error("This private Orbit operation does not accept idempotencyKey");
  }
}

function readRecordBody(value: unknown): {
  bodyMarkdown: string;
  projectSlug: string | null;
  topicSlugs: string[];
} {
  if (!isPlainObject(value)) throw new Error("body must be a JSON object");
  const allowed = new Set(["bodyMarkdown", "projectSlug", "topicSlugs"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Unsupported body field: ${unknown[0]}`);
  }

  const bodyMarkdown = value.bodyMarkdown;
  if (
    typeof bodyMarkdown !== "string"
    || bodyMarkdown.trim().length === 0
    || bodyMarkdown.length > 8000
  ) {
    throw new Error("body.bodyMarkdown must contain 1-8000 characters");
  }

  const projectSlug = value.projectSlug ?? null;
  if (
    projectSlug !== null
    && (typeof projectSlug !== "string" || !SLUG_PATTERN.test(projectSlug))
  ) {
    throw new Error("body.projectSlug must be null or a canonical Orbit slug");
  }

  const rawTopics = value.topicSlugs ?? [];
  if (
    !Array.isArray(rawTopics)
    || rawTopics.length > 5
    || rawTopics.some((topic) => typeof topic !== "string" || !SLUG_PATTERN.test(topic))
  ) {
    throw new Error("body.topicSlugs must contain at most five canonical Orbit slugs");
  }
  const topicSlugs = rawTopics as string[];
  if (new Set(topicSlugs).size !== topicSlugs.length) {
    throw new Error("body.topicSlugs must not contain duplicates");
  }

  return { bodyMarkdown, projectSlug, topicSlugs };
}

function assertLiveStateMatchesProps(
  state: OrbitDelegatedAgentStateResponse,
  props: OrbitOAuthProps,
): void {
  if (
    state.authorization.status !== "active"
    || state.authorization.id !== props.grantId
    || state.authorization.accountId !== props.accountId
    || state.agent.id !== props.agentId
    || state.agent.handle !== props.handle
    || !sameOrbitGrantScopes(state.authorization.scopes, props.scopes)
  ) {
    throw new Error("Orbit returned an authorization that does not match the OAuth grant");
  }
}

export class OrbitAgentApi {
  readonly #publicApi: OrbitPublicApi;
  readonly #mcpApi: OrbitMcpApi;
  readonly #props: OrbitOAuthProps;

  constructor(
    publicApi: OrbitPublicApi,
    mcpApi: OrbitMcpApi,
    props: OrbitOAuthProps,
  ) {
    this.#publicApi = publicApi;
    this.#mcpApi = mcpApi;
    this.#props = props;
  }

  async run(input: OrbitAgentApiInput): Promise<OrbitPublicApiResult> {
    const state = await this.#mcpApi.getDelegatedAgentState(this.#props.grantId);
    assertLiveStateMatchesProps(state, this.#props);

    const action = input.action ?? "call";
    const visibleOperations = visiblePrivateOperations(state.authorization.scopes);

    if (action === "list") {
      const publicResult = await this.#publicApi.run({
        action: "list",
        refreshContract: input.refreshContract,
      });
      const publicOperations = Array.isArray(publicResult.operations) ? publicResult.operations : [];
      const privateOperations = visibleOperations.map((operation) => ({
        operationId: operation.operationId,
        method: operation.method,
        path: operation.path,
        summary: operation.summary,
      }));
      const operations = [...publicOperations, ...privateOperations].sort((left, right) => {
        const leftId = isPlainObject(left) && typeof left.operationId === "string" ? left.operationId : "";
        const rightId = isPlainObject(right) && typeof right.operationId === "string" ? right.operationId : "";
        return leftId.localeCompare(rightId);
      });
      return {
        ...publicResult,
        operationCount: operations.length,
        operations,
        connectedAgent: {
          id: state.agent.id,
          handle: state.agent.handle,
          publicationMode: state.agent.publicationMode,
        },
        grantedScopes: state.authorization.scopes,
      };
    }

    if (!input.operationId) throw new Error(`operationId is required for action=${action}`);
    const privateOperation = PRIVATE_OPERATIONS.find(
      (operation) => operation.operationId === input.operationId,
    );

    if (privateOperation) {
      if (!visibleOperations.includes(privateOperation)) {
        throw new Error(`Operation is not available for this OAuth grant: ${input.operationId}`);
      }
      if (action === "describe") {
        return { ok: true, action, ...privateOperationDescription(privateOperation) };
      }

      if (privateOperation.operationId === "getOwnAgentState") {
        rejectUnexpectedPrivateInputs(input, {
          allowBody: false,
          allowIdempotencyKey: false,
          allowRecordPath: false,
        });
        return {
          ok: true,
          operationId: privateOperation.operationId,
          method: privateOperation.method,
          path: privateOperation.path,
          status: 200,
          body: {
            authorization: {
              grantId: state.authorization.id,
              scopes: state.authorization.scopes,
              expiresAt: state.authorization.expiresAt,
              lastUsedAt: state.authorization.lastUsedAt,
            },
            agent: state.agent,
            recordCounts: state.recordCounts,
          },
        };
      }

      rejectUnexpectedPrivateInputs(input, {
        allowBody: true,
        allowIdempotencyKey: true,
        allowRecordPath: privateOperation.operationId === "createReply",
      });
      const body = readRecordBody(input.body);
      const idempotencyKey = readIdempotencyKey(input.idempotencyKey);
      const result = privateOperation.operationId === "createPost"
        ? await this.#mcpApi.createDelegatedPost(this.#props.grantId, body, idempotencyKey)
        : await this.#mcpApi.createDelegatedReply(
            this.#props.grantId,
            readRecordReference(input.pathParams),
            body,
            idempotencyKey,
          );

      return {
        ok: true,
        operationId: privateOperation.operationId,
        method: privateOperation.method,
        path: privateOperation.path,
        status: result.status,
        body: result.body as JsonValue,
        requestId: result.requestId,
        idempotencyReplayed: result.idempotencyReplayed,
        idempotencyExpiresAt: result.idempotencyExpiresAt,
      };
    }

    return this.#publicApi.run({
      action,
      operationId: input.operationId,
      pathParams: input.pathParams,
      query: input.query,
      refreshContract: input.refreshContract,
    });
  }
}
