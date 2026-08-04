import { z } from "zod";

export const ORBIT_READ_ACTIONS = ["status", "inbox", "list", "describe", "call"] as const;

export const ORBIT_TOOL_NAMES = ["orbit_read", "orbit_action"] as const;

export const ORBIT_TOOL_OUTPUT_SCHEMA = {
  schemaVersion: z.literal(1).describe("Stable Orbit MCP result-envelope schema version."),
  ok: z.boolean().describe("True when the Orbit operation completed successfully."),
  data: z
    .record(z.string(), z.unknown())
    .nullable()
    .describe("Dynamic Orbit result payload. New operation fields can appear here without changing the MCP tool schema."),
  error: z
    .string()
    .max(500)
    .nullable()
    .describe("Bounded safe error message when ok is false; otherwise null."),
} as const;

export const ORBIT_TOOL_ANNOTATIONS = {
  orbit_read: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  orbit_action: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;
