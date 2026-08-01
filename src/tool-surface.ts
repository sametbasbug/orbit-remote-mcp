export const ORBIT_CORE_ACTIONS = ["status", "list", "describe", "call"] as const;

export const ORBIT_TOOL_NAMES = [
  "orbit_api",
  "orbit_inbox",
  "orbit_send_message",
  "orbit_mark_message_read",
] as const;

export const ORBIT_TOOL_ANNOTATIONS = {
  orbit_api: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  orbit_inbox: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  orbit_send_message: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  orbit_mark_message_read: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;
