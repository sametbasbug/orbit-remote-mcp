export const ORBIT_ORIGIN = "https://orbit.sametbasbug.dev";
export const ORBIT_API_BASE = `${ORBIT_ORIGIN}/v1`;
export const ORBIT_OPENAPI_URL = `${ORBIT_API_BASE}/openapi.json`;
export const ORBIT_SKILL_URL = `${ORBIT_ORIGIN}/skill.md`;

const CONTRACT_CACHE_MS = 5 * 60 * 1000;
const CONTRACT_STALE_MS = 60 * 60 * 1000;
const CONTRACT_MAX_BYTES = 2 * 1024 * 1024;
const RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

const BLOCKED_OPERATION_IDS = new Set([
  "getAgentApiContract",
  "readVisibleMedia",
  "registerOrRenewAgent",
]);

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type OpenApiDocument = {
  openapi?: unknown;
  info?: { version?: unknown };
  servers?: Array<{ url?: unknown }>;
  externalDocs?: { url?: unknown };
  paths?: Record<string, unknown>;
  components?: Record<string, unknown>;
};

type Parameter = {
  name?: unknown;
  in?: unknown;
  required?: unknown;
  description?: unknown;
  schema?: unknown;
  $ref?: unknown;
};

type Operation = {
  operationId?: unknown;
  summary?: unknown;
  description?: unknown;
  security?: unknown;
  parameters?: unknown;
  responses?: unknown;
};

type OperationDescriptor = {
  operationId: string;
  method: "GET";
  path: string;
  summary: string;
  description: string | null;
  pathParameters: Parameter[];
  queryParameters: Parameter[];
};

type ContractCache = {
  loadedAt: number;
  document: OpenApiDocument;
  operations: Map<string, OperationDescriptor>;
};

export type OrbitPublicApiInput = {
  action?: "list" | "describe" | "call";
  operationId?: string;
  pathParams?: Record<string, JsonPrimitive>;
  query?: Record<string, JsonPrimitive>;
  refreshContract?: boolean;
};

export type OrbitPublicApiResult = JsonObject;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toSafeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

function rejectRedirect(response: Response, label: string): void {
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${label} attempted an HTTP redirect, which is not allowed.`);
  }
}

function resolvePointer(document: OpenApiDocument, reference: string): unknown {
  if (!reference.startsWith("#/")) {
    throw new Error(`Only local OpenAPI references are supported: ${reference}`);
  }

  let current: unknown = document;
  for (const encodedPart of reference.slice(2).split("/")) {
    const part = encodedPart.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (!isPlainObject(current) || !(part in current)) {
      throw new Error(`OpenAPI reference could not be resolved: ${reference}`);
    }
    current = current[part];
  }
  return current;
}

function resolveParameter(document: OpenApiDocument, value: unknown): Parameter {
  if (!isPlainObject(value)) throw new Error("Invalid OpenAPI parameter object.");
  if (typeof value.$ref === "string") {
    return resolveParameter(document, resolvePointer(document, value.$ref));
  }
  return value as Parameter;
}

function responseHasJson(document: OpenApiDocument, operation: Operation): boolean {
  if (!isPlainObject(operation.responses)) return false;
  for (const [status, rawResponse] of Object.entries(operation.responses)) {
    if (!/^2\d\d$/u.test(status)) continue;
    let response = rawResponse;
    if (isPlainObject(response) && typeof response.$ref === "string") {
      response = resolvePointer(document, response.$ref);
    }
    if (!isPlainObject(response) || !isPlainObject(response.content)) continue;
    if ("application/json" in response.content) return true;
  }
  return false;
}

function collectParameters(
  document: OpenApiDocument,
  pathItem: Record<string, unknown>,
  operation: Operation,
): Parameter[] {
  const values: unknown[] = [];
  if (Array.isArray(pathItem.parameters)) values.push(...pathItem.parameters);
  if (Array.isArray(operation.parameters)) values.push(...operation.parameters);
  return values.map((value) => resolveParameter(document, value));
}

function normalizeContract(document: OpenApiDocument): Map<string, OperationDescriptor> {
  if (
    typeof document.openapi !== "string" ||
    !document.openapi.startsWith("3.") ||
    !isPlainObject(document.paths)
  ) {
    throw new Error("Orbit contract is not a valid OpenAPI 3.x document.");
  }

  if (document.servers?.[0]?.url !== ORBIT_API_BASE) {
    throw new Error("Orbit contract server origin does not match the fixed production API base.");
  }

  const operations = new Map<string, OperationDescriptor>();
  for (const [pathTemplate, rawPathItem] of Object.entries(document.paths)) {
    if (
      !pathTemplate.startsWith("/") ||
      pathTemplate.startsWith("//") ||
      pathTemplate.includes("..") ||
      !isPlainObject(rawPathItem)
    ) {
      throw new Error(`Unsafe OpenAPI path: ${pathTemplate}`);
    }

    for (const [method, rawOperation] of Object.entries(rawPathItem)) {
      if (!HTTP_METHODS.has(method) || !isPlainObject(rawOperation)) continue;
      const operation = rawOperation as Operation;
      if (method !== "get") continue;
      if (!Array.isArray(operation.security) || operation.security.length !== 0) continue;
      if (typeof operation.operationId !== "string" || !operation.operationId) continue;
      if (BLOCKED_OPERATION_IDS.has(operation.operationId)) continue;
      if (!responseHasJson(document, operation)) continue;

      const parameters = collectParameters(document, rawPathItem, operation);
      const descriptor: OperationDescriptor = {
        operationId: operation.operationId,
        method: "GET",
        path: pathTemplate,
        summary: typeof operation.summary === "string" ? operation.summary : operation.operationId,
        description: typeof operation.description === "string" ? operation.description : null,
        pathParameters: parameters.filter((parameter) => parameter.in === "path"),
        queryParameters: parameters.filter((parameter) => parameter.in === "query"),
      };

      if (operations.has(descriptor.operationId)) {
        throw new Error(`Duplicate OpenAPI operationId: ${descriptor.operationId}`);
      }
      operations.set(descriptor.operationId, descriptor);
    }
  }

  if (operations.size === 0) {
    throw new Error("Orbit contract exposed no permitted public JSON read operations.");
  }
  return operations;
}

function validateScalar(value: JsonPrimitive, schema: unknown, label: string): void {
  if (!isPlainObject(schema)) return;

  if (Array.isArray(schema.oneOf)) {
    const accepted = schema.oneOf.some((candidate) => {
      try {
        validateScalar(value, candidate, label);
        return true;
      } catch {
        return false;
      }
    });
    if (!accepted) throw new Error(`${label} does not match any allowed schema.`);
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    throw new Error(`${label} must be one of: ${schema.enum.join(", ")}`);
  }

  if (schema.type === "string" && typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  if (schema.type === "integer" && !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  if (schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${label} must be a finite number.`);
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  if (schema.type === "null" && value !== null) {
    throw new Error(`${label} must be null.`);
  }

  if (typeof value === "string") {
    const length = [...value].length;
    if (Number.isInteger(schema.minLength) && length < Number(schema.minLength)) {
      throw new Error(`${label} must be at least ${schema.minLength} characters.`);
    }
    if (Number.isInteger(schema.maxLength) && length > Number(schema.maxLength)) {
      throw new Error(`${label} must be at most ${schema.maxLength} characters.`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      throw new Error(`${label} does not match the required format.`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      throw new Error(`${label} must be at least ${schema.minimum}.`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      throw new Error(`${label} must be at most ${schema.maximum}.`);
    }
  }
}

function parameterName(parameter: Parameter): string {
  if (typeof parameter.name !== "string" || !parameter.name) {
    throw new Error("OpenAPI parameter is missing a name.");
  }
  return parameter.name;
}

function describeParameter(parameter: Parameter): JsonObject {
  return {
    name: parameterName(parameter),
    required: parameter.required === true,
    description: typeof parameter.description === "string" ? parameter.description : null,
    schema: isPlainObject(parameter.schema) ? (parameter.schema as JsonObject) : {},
  };
}

function buildRequestUrl(
  document: OpenApiDocument,
  descriptor: OperationDescriptor,
  pathParams: Record<string, JsonPrimitive>,
  query: Record<string, JsonPrimitive>,
): URL {
  const allowedPathNames = new Set(descriptor.pathParameters.map(parameterName));
  const allowedQueryNames = new Set(descriptor.queryParameters.map(parameterName));

  for (const key of Object.keys(pathParams)) {
    if (!allowedPathNames.has(key)) throw new Error(`Unknown path parameter: ${key}`);
  }
  for (const key of Object.keys(query)) {
    if (!allowedQueryNames.has(key)) throw new Error(`Unknown query parameter: ${key}`);
  }

  let path = descriptor.path;
  for (const parameter of descriptor.pathParameters) {
    const name = parameterName(parameter);
    const value = pathParams[name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing required path parameter: ${name}`);
    }
    validateScalar(value, parameter.schema, `pathParams.${name}`);
    path = path.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
  }
  if (/\{[^}]+\}/u.test(path)) throw new Error("Not all path parameters were resolved.");

  const url = new URL(`${ORBIT_API_BASE}${path}`);
  for (const parameter of descriptor.queryParameters) {
    const name = parameterName(parameter);
    const value = query[name];
    if (value === undefined || value === null || value === "") {
      if (parameter.required === true) throw new Error(`Missing required query parameter: ${name}`);
      continue;
    }
    validateScalar(value, parameter.schema, `query.${name}`);
    url.searchParams.set(name, String(value));
  }

  if (url.origin !== ORBIT_ORIGIN || !url.pathname.startsWith("/v1/")) {
    throw new Error("Orbit request escaped the fixed production API boundary.");
  }
  return url;
}

async function readJsonResponse(response: Response, maximumBytes: number): Promise<JsonValue | null> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new Error(`Orbit response exceeded the ${maximumBytes}-byte safety limit.`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new Error("Orbit returned a non-JSON response where JSON was required.");
  }
}

export class OrbitPublicApi {
  readonly fetchImpl: FetchLike;
  private cache: ContractCache | null = null;

  constructor(fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  private async fetchWithTimeout(url: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadContract(refresh = false): Promise<ContractCache> {
    const now = Date.now();
    if (!refresh && this.cache && now - this.cache.loadedAt < CONTRACT_CACHE_MS) return this.cache;

    try {
      const response = await this.fetchWithTimeout(
        ORBIT_OPENAPI_URL,
        { method: "GET", headers: { accept: "application/json" }, redirect: "manual" },
        REQUEST_TIMEOUT_MS,
      );
      rejectRedirect(response, "Orbit OpenAPI");
      if (!response.ok) throw new Error(`Orbit OpenAPI returned HTTP ${response.status}.`);
      const document = (await readJsonResponse(response, CONTRACT_MAX_BYTES)) as OpenApiDocument;
      const nextCache = { loadedAt: now, document, operations: normalizeContract(document) };
      this.cache = nextCache;
      return nextCache;
    } catch (error) {
      if (this.cache && now - this.cache.loadedAt < CONTRACT_STALE_MS) return this.cache;
      throw new Error(`Orbit OpenAPI could not be loaded: ${toSafeMessage(error)}`);
    }
  }

  async run(input: OrbitPublicApiInput): Promise<OrbitPublicApiResult> {
    const action = input.action ?? "call";
    const contract = await this.loadContract(input.refreshContract === true);

    if (action === "list") {
      return {
        ok: true,
        action,
        contractVersion:
          typeof contract.document.info?.version === "string" ? contract.document.info.version : null,
        contractUrl: ORBIT_OPENAPI_URL,
        guideUrl:
          typeof contract.document.externalDocs?.url === "string"
            ? contract.document.externalDocs.url
            : ORBIT_SKILL_URL,
        operations: [...contract.operations.values()]
          .sort((a, b) => a.operationId.localeCompare(b.operationId))
          .map((operation) => ({
            operationId: operation.operationId,
            method: operation.method,
            path: operation.path,
            summary: operation.summary,
          })),
      };
    }

    if (!input.operationId) throw new Error(`operationId is required for action=${action}.`);
    const descriptor = contract.operations.get(input.operationId);
    if (!descriptor) throw new Error(`Operation is not an allowed public Orbit read: ${input.operationId}`);

    if (action === "describe") {
      return {
        ok: true,
        action,
        operationId: descriptor.operationId,
        method: descriptor.method,
        path: descriptor.path,
        summary: descriptor.summary,
        description: descriptor.description,
        authentication: "public; no credential is sent",
        pathParameters: descriptor.pathParameters.map(describeParameter),
        queryParameters: descriptor.queryParameters.map(describeParameter),
      };
    }

    const url = buildRequestUrl(
      contract.document,
      descriptor,
      input.pathParams ?? {},
      input.query ?? {},
    );
    const response = await this.fetchWithTimeout(
      url,
      { method: "GET", headers: { accept: "application/json" }, redirect: "manual" },
      REQUEST_TIMEOUT_MS,
    );
    rejectRedirect(response, `Orbit operation ${descriptor.operationId}`);
    const body = await readJsonResponse(response, RESPONSE_MAX_BYTES);

    const result: OrbitPublicApiResult = {
      ok: response.ok,
      operationId: descriptor.operationId,
      method: descriptor.method,
      path: descriptor.path,
      status: response.status,
      body,
      requestId: response.headers.get("x-request-id"),
      etag: response.headers.get("etag"),
    };

    if (!response.ok) {
      const errorMessage =
        isPlainObject(body) && isPlainObject(body.error) && typeof body.error.message === "string"
          ? body.error.message
          : `Orbit API returned HTTP ${response.status}.`;
      throw new Error(errorMessage);
    }
    return result;
  }
}
