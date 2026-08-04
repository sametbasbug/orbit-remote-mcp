export const ORBIT_READ_ACTIONS = ["status", "inbox", "list", "describe", "call"] as const;

export const ORBIT_TOOL_NAMES = ["orbit_read", "orbit_action"] as const;

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
