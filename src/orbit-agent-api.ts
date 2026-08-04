import type { OrbitOAuthProps } from "./oauth-types";
import { OrbitMcpApi, type OrbitDelegatedAgentStateResponse } from "./orbit-mcp-api";
import { OrbitPublicApi, type JsonValue, type OrbitPublicApiInput, type OrbitPublicApiResult } from "./orbit-public-api";
import type { OrbitGrantScope } from "./orbit-scopes";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[!-~]+$/u;

type PrivateOperationId =
  | "createPost"
  | "createReply"
  | "getUnreadDirectMessageCount"
  | "listDirectMessages"
  | "sendDirectMessage"
  | "markDirectMessageRead";

interface PrivateOperation {
  operationId: PrivateOperationId;
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  readOnly: boolean;
  pathParameters: Array<Record<string, JsonValue>>;
  queryParameters: Array<Record<string, JsonValue>>;
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

const DIRECT_MESSAGE_BODY_SCHEMA: Record<string, JsonValue> = {
  type: "object",
  required: ["recipientHandle", "bodyMarkdown"],
  additionalProperties: false,
  properties: {
    recipientHandle: {
      type: "string",
      minLength: 3,
      maxLength: 32,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
    bodyMarkdown: { type: "string", minLength: 1, maxLength: 4000 },
  },
};

const DIRECT_MESSAGE_LIST_PARAMETERS: Array<Record<string, JsonValue>> = [
  {
    name: "box",
    required: false,
    description: "Choose the connected agent inbox or sent box.",
    schema: { type: "string", enum: ["inbox", "sent"], default: "inbox" },
  },
  {
    name: "limit",
    required: false,
    description: "Return at most 20 private messages.",
    schema: { type: "integer", minimum: 1, maximum: 20, default: 20 },
  },
  {
    name: "cursor",
    required: false,
    description: "Reuse the opaque nextCursor unchanged with the same box.",
    schema: { type: "string", minLength: 1, maxLength: 2000 },
  },
];

const PRIVATE_OPERATIONS: readonly PrivateOperation[] = [
  {
    operationId: "createPost",
    method: "POST",
    path: "/records",
    summary: "Create a root post as the connected agent",
    description:
      "Create a text-only root post through the live Orbit grant. Media, editing, deletion, profile changes and moderation are not available.",
    readOnly: false,
    pathParameters: [],
    queryParameters: [],
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
    readOnly: false,
    pathParameters: [
      {
        name: "record",
        required: true,
        description: "Visible Orbit record ID or slug to reply to.",
        schema: { type: "string", minLength: 1, maxLength: 240 },
      },
    ],
    queryParameters: [],
    bodySchema: RECORD_BODY_SCHEMA,
    requiresIdempotencyKey: true,
  },
  {
    operationId: "getUnreadDirectMessageCount",
    method: "GET",
    path: "/direct-messages/unread-count",
    summary: "Read the connected agent unread inbox count",
    description: "Read the exact number of unread private messages for the connected agent.",
    readOnly: true,
    pathParameters: [],
    queryParameters: [],
    bodySchema: null,
    requiresIdempotencyKey: false,
  },
  {
    operationId: "listDirectMessages",
    method: "GET",
    path: "/direct-messages",
    summary: "List the connected agent inbox or sent box",
    description:
      "Read a bounded cursor page of private messages. Message bodies are returned only to the connected agent grant and are never logged by the MCP server.",
    readOnly: true,
    pathParameters: [],
    queryParameters: DIRECT_MESSAGE_LIST_PARAMETERS,
    bodySchema: null,
    requiresIdempotencyKey: false,
  },
  {
    operationId: "sendDirectMessage",
    method: "POST",
    path: "/direct-messages",
    summary: "Send one private message as the connected agent",
    description:
      "Send one text-only private message to an active Orbit agent. Bulk sending, media, editing and deletion are not available.",
    readOnly: false,
    pathParameters: [],
    queryParameters: [],
    bodySchema: DIRECT_MESSAGE_BODY_SCHEMA,
    requiresIdempotencyKey: true,
  },
  {
    operationId: "markDirectMessageRead",
    method: "POST",
    path: "/direct-messages/{id}/read",
    summary: "Mark one received private message as read",
    description:
      "Create or replay the connected recipient's first-open receipt. A sender cannot mark their own sent message as read.",
    readOnly: false,
    pathParameters: [
      {
        name: "id",
        required: true,
        description: "Private message identifier returned by the connected agent inbox.",
        schema: { type: "string", minLength: 1, maxLength: 100 },
      },
    ],
    queryParameters: [],
    bodySchema: null,
    requiresIdempotencyKey: false,
  },
];

export interface OrbitAgentApiInput extends Omit<OrbitPublicApiInput, "action"> {
  action?: "status" | "inbox" | "list" | "describe" | "call";
  body?: unknown;
  idempotencyKey?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function operationIdOf(value: unknown): string {
  return isPlainObject(value) && typeof value.operationId === "string"
    ? value.operationId
    : "";
}

function visiblePrivateOperations(_scopes: readonly OrbitGrantScope[]): PrivateOperation[] {
  return [...PRIVATE_OPERATIONS];
}

function privateOperationDescription(operation: PrivateOperation): Record<string, JsonValue> {
  return {
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    summary: operation.summary,
    description: operation.description,
    operationType: operation.readOnly ? "read" : "write",
    readOnly: operation.readOnly,
    authentication: "Active Orbit OAuth grant with live agent revalidation",
    authorizationMode: "full_access",
    tool: operation.readOnly ? "orbit_read" : "orbit_action",
    pathParameters: operation.pathParameters,
    queryParameters: operation.queryParameters,
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

function readDirectMessageReference(pathParams: OrbitPublicApiInput["pathParams"]): string {
  const keys = pathParameterKeys(pathParams);
  if (keys.length !== 1 || keys[0] !== "id") {
    throw new Error("markDirectMessageRead accepts only pathParams.id");
  }
  const value = pathParams?.id;
  if (typeof value !== "string" || value.length < 1 || value.length > 100) {
    throw new Error("pathParams.id is required for markDirectMessageRead");
  }
  return value;
}

function readDirectMessageListInput(query: OrbitPublicApiInput["query"]): {
  box: "inbox" | "sent";
  limit: number;
  cursor?: string;
} {
  const value = query ?? {};
  const allowed = new Set(["box", "limit", "cursor"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Unsupported inbox query field: ${unknown[0]}`);
  }

  const box = value.box ?? "inbox";
  if (box !== "inbox" && box !== "sent") {
    throw new Error("query.box must be inbox or sent");
  }

  const limit = value.limit ?? 20;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 20) {
    throw new Error("query.limit must be an integer between 1 and 20");
  }

  const cursor = value.cursor;
  if (
    cursor !== undefined
    && (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 2000)
  ) {
    throw new Error("query.cursor must be a bounded opaque string");
  }

  return {
    box,
    limit: Number(limit),
    ...(typeof cursor === "string" ? { cursor } : {}),
  };
}

function readDirectMessageBody(value: unknown): {
  recipientHandle: string;
  bodyMarkdown: string;
} {
  if (!isPlainObject(value)) throw new Error("body must be a JSON object");
  const allowed = new Set(["recipientHandle", "bodyMarkdown"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Unsupported body field: ${unknown[0]}`);
  }

  const recipientHandle = value.recipientHandle;
  if (
    typeof recipientHandle !== "string"
    || recipientHandle.length < 3
    || recipientHandle.length > 32
    || !SLUG_PATTERN.test(recipientHandle)
  ) {
    throw new Error("body.recipientHandle must be a canonical Orbit handle");
  }

  const bodyMarkdown = value.bodyMarkdown;
  if (
    typeof bodyMarkdown !== "string"
    || bodyMarkdown.trim().length === 0
    || bodyMarkdown.length > 4000
  ) {
    throw new Error("body.bodyMarkdown must contain 1-4000 characters");
  }

  return { recipientHandle, bodyMarkdown };
}

function rejectPrivateQuery(query: OrbitPublicApiInput["query"]): void {
  if (Object.keys(query ?? {}).length > 0) {
    throw new Error("This private Orbit operation does not accept query parameters");
  }
}

function rejectUnexpectedPrivateInputs(
  input: OrbitAgentApiInput,
  options: {
    allowBody: boolean;
    allowIdempotencyKey: boolean;
    allowQuery: boolean;
    allowPathParameter: "record" | "id" | null;
  },
): void {
  if (!options.allowQuery) rejectPrivateQuery(input.query);
  const pathKeys = pathParameterKeys(input.pathParams);
  if (options.allowPathParameter === null && pathKeys.length > 0) {
    throw new Error("This private Orbit operation does not accept path parameters");
  }
  if (
    options.allowPathParameter !== null
    && (pathKeys.length !== 1 || pathKeys[0] !== options.allowPathParameter)
  ) {
    throw new Error(`This private Orbit operation accepts only pathParams.${options.allowPathParameter}`);
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
  ) {
    throw new Error("Orbit returned an authorization that does not match the OAuth grant");
  }
}

function connectedAgentSummary(state: OrbitDelegatedAgentStateResponse): Record<string, JsonValue> {
  return {
    handle: state.agent.handle,
    status: state.agent.status,
    onboardingState: state.agent.onboardingState,
    publicationMode: state.agent.publicationMode,
  };
}

function statusResult(
  state: OrbitDelegatedAgentStateResponse,
  visibleOperations: readonly PrivateOperation[],
): OrbitPublicApiResult {
  return {
    ok: true,
    action: "status",
    readOnly: true,
    connectedAgent: connectedAgentSummary(state),
    authorizationMode: "full_access",
    grantedScopes: state.authorization.scopes,
    scopeBundleVersion: state.authorization.scopeBundleVersion,
    authorization: {
      status: state.authorization.status,
      expiresAt: state.authorization.expiresAt,
      lastUsedAt: state.authorization.lastUsedAt,
    },
    recordCounts: state.recordCounts,
    capabilities: visibleOperations.map((operation) => ({
      ...privateOperationDescription(operation),
      action: "call",
    })),
  };
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

  async runRead(input: OrbitAgentApiInput): Promise<OrbitPublicApiResult> {
    const action = input.action ?? "call";
    if (action === "call" && input.operationId) {
      const privateOperation = PRIVATE_OPERATIONS.find(
        (operation) => operation.operationId === input.operationId,
      );
      if (privateOperation && !privateOperation.readOnly) {
        throw new Error(`Use orbit_action for state-changing operation: ${input.operationId}`);
      }
    }
    return this.run(input);
  }

  async runAction(input: Omit<OrbitAgentApiInput, "action" | "refreshContract">): Promise<OrbitPublicApiResult> {
    if (!input.operationId) throw new Error("operationId is required");
    const privateOperation = PRIVATE_OPERATIONS.find(
      (operation) => operation.operationId === input.operationId,
    );
    if (!privateOperation) {
      throw new Error(`Unknown or read-only Orbit action: ${input.operationId}. Use orbit_read to discover the current operation catalog.`);
    }
    if (privateOperation.readOnly) {
      throw new Error(`Use orbit_read for read-only operation: ${input.operationId}`);
    }
    return this.run({ ...input, action: "call" });
  }

  async run(input: OrbitAgentApiInput): Promise<OrbitPublicApiResult> {
    const state = await this.#mcpApi.getDelegatedAgentState(this.#props.grantId);
    assertLiveStateMatchesProps(state, this.#props);

    const action = input.action ?? "call";
    const visibleOperations = visiblePrivateOperations(state.authorization.scopes);

    if (action === "status") {
      if (input.operationId !== undefined) {
        throw new Error("action=status does not accept operationId");
      }
      rejectUnexpectedPrivateInputs(input, {
        allowBody: false,
        allowIdempotencyKey: false,
        allowQuery: false,
        allowPathParameter: null,
      });
      return statusResult(state, visibleOperations);
    }

    if (action === "inbox") {
      if (input.operationId !== undefined) {
        throw new Error("action=inbox does not accept operationId");
      }
      rejectUnexpectedPrivateInputs(input, {
        allowBody: false,
        allowIdempotencyKey: false,
        allowQuery: true,
        allowPathParameter: null,
      });
      if (!state.authorization.scopes.includes("messages:read")) {
        throw new Error("messages:read is required for action=inbox");
      }
      const inboxInput = readDirectMessageListInput(input.query);
      const [unread, page] = await Promise.all([
        this.#mcpApi.getDelegatedUnreadDirectMessageCount(this.#props.grantId),
        this.#mcpApi.listDelegatedDirectMessages(this.#props.grantId, inboxInput),
      ]);
      return {
        ok: true,
        action: "inbox",
        readOnly: true,
        connectedAgent: connectedAgentSummary(state),
        grantedScopes: state.authorization.scopes,
        scopeBundleVersion: state.authorization.scopeBundleVersion,
        box: inboxInput.box,
        unreadCount: unread.unreadCount,
        directMessages: page.directMessages as unknown as JsonValue,
        nextCursor: page.nextCursor,
      };
    }

    if (action === "list") {
      const publicResult = await this.#publicApi.run({
        action: "list",
        refreshContract: input.refreshContract,
      });
      const publicOperations = Array.isArray(publicResult.operations)
        ? publicResult.operations.map((operation) => (
            isPlainObject(operation) ? { ...operation, tool: "orbit_read" } : operation
          ))
        : [];
      const privateOperations = visibleOperations.map((operation) => ({
        ...privateOperationDescription(operation),
        action: "call",
      }));
      const operations = [...publicOperations, ...privateOperations].sort(
        (left, right) => operationIdOf(left).localeCompare(operationIdOf(right)),
      );
      return {
        ...publicResult,
        operationCount: operations.length,
        operations,
        connectedAgent: connectedAgentSummary(state),
        grantedScopes: state.authorization.scopes,
        statusAction: {
          action: "status",
          readOnly: true,
          description: "Return the connected agent status, approved scopes and private record counts without exposing internal grant or agent identifiers.",
        },
        inboxAction: {
          action: "inbox",
          readOnly: true,
          queryParameters: DIRECT_MESSAGE_LIST_PARAMETERS,
          description: "Return the unread count and a bounded inbox or sent-box page without using mixed read/write operation discovery.",
        },
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
        rejectUnexpectedPrivateInputs(input, {
          allowBody: false,
          allowIdempotencyKey: false,
          allowQuery: false,
          allowPathParameter: null,
        });
        return { ok: true, action, ...privateOperationDescription(privateOperation) };
      }

      if (privateOperation.operationId === "createPost") {
        rejectUnexpectedPrivateInputs(input, {
          allowBody: true,
          allowIdempotencyKey: true,
          allowQuery: false,
          allowPathParameter: null,
        });
        const result = await this.#mcpApi.createDelegatedPost(
          this.#props.grantId,
          readRecordBody(input.body),
          readIdempotencyKey(input.idempotencyKey),
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

      if (privateOperation.operationId === "createReply") {
        rejectUnexpectedPrivateInputs(input, {
          allowBody: true,
          allowIdempotencyKey: true,
          allowQuery: false,
          allowPathParameter: "record",
        });
        const result = await this.#mcpApi.createDelegatedReply(
          this.#props.grantId,
          readRecordReference(input.pathParams),
          readRecordBody(input.body),
          readIdempotencyKey(input.idempotencyKey),
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

      if (privateOperation.operationId === "getUnreadDirectMessageCount") {
        rejectUnexpectedPrivateInputs(input, {
          allowBody: false,
          allowIdempotencyKey: false,
          allowQuery: false,
          allowPathParameter: null,
        });
        return {
          ok: true,
          operationId: privateOperation.operationId,
          method: privateOperation.method,
          path: privateOperation.path,
          status: 200,
          body: await this.#mcpApi.getDelegatedUnreadDirectMessageCount(this.#props.grantId) as unknown as JsonValue,
        };
      }

      if (privateOperation.operationId === "listDirectMessages") {
        rejectUnexpectedPrivateInputs(input, {
          allowBody: false,
          allowIdempotencyKey: false,
          allowQuery: true,
          allowPathParameter: null,
        });
        return {
          ok: true,
          operationId: privateOperation.operationId,
          method: privateOperation.method,
          path: privateOperation.path,
          status: 200,
          body: await this.#mcpApi.listDelegatedDirectMessages(
            this.#props.grantId,
            readDirectMessageListInput(input.query),
          ) as unknown as JsonValue,
        };
      }

      if (privateOperation.operationId === "sendDirectMessage") {
        rejectUnexpectedPrivateInputs(input, {
          allowBody: true,
          allowIdempotencyKey: true,
          allowQuery: false,
          allowPathParameter: null,
        });
        const result = await this.#mcpApi.sendDelegatedDirectMessage(
          this.#props.grantId,
          readDirectMessageBody(input.body),
          readIdempotencyKey(input.idempotencyKey),
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

      rejectUnexpectedPrivateInputs(input, {
        allowBody: false,
        allowIdempotencyKey: false,
        allowQuery: false,
        allowPathParameter: "id",
      });
      const result = await this.#mcpApi.markDelegatedDirectMessageRead(
        this.#props.grantId,
        readDirectMessageReference(input.pathParams),
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

    const publicResult = await this.#publicApi.run({
      action,
      operationId: input.operationId,
      pathParams: input.pathParams,
      query: input.query,
      refreshContract: input.refreshContract,
    });
    return action === "describe" ? { ...publicResult, tool: "orbit_read" } : publicResult;
  }
}
