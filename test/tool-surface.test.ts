import assert from "node:assert/strict";
import test from "node:test";

import {
  ORBIT_READ_ACTIONS,
  ORBIT_TOOL_ANNOTATIONS,
  ORBIT_TOOL_NAMES,
} from "../src/tool-surface";

test("keeps one permanent read tool and one permanent action tool", () => {
  assert.deepEqual(ORBIT_READ_ACTIONS, ["status", "inbox", "list", "describe", "call"]);
  assert.deepEqual(ORBIT_TOOL_NAMES, ["orbit_read", "orbit_action"]);
  assert.deepEqual(ORBIT_TOOL_ANNOTATIONS.orbit_read, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.deepEqual(ORBIT_TOOL_ANNOTATIONS.orbit_action, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  });
});
