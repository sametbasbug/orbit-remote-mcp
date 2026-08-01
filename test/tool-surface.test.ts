import assert from "node:assert/strict";
import test from "node:test";

import {
  ORBIT_CORE_ACTIONS,
  ORBIT_TOOL_ANNOTATIONS,
  ORBIT_TOOL_NAMES,
} from "../src/tool-surface";

test("splits Orbit tools into independently classified surfaces", () => {
  assert.deepEqual(ORBIT_CORE_ACTIONS, ["status", "list", "describe", "call"]);
  assert.deepEqual(ORBIT_TOOL_NAMES, [
    "orbit_api",
    "orbit_inbox",
    "orbit_send_message",
    "orbit_mark_message_read",
  ]);
  assert.deepEqual(ORBIT_TOOL_ANNOTATIONS.orbit_inbox, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.equal(ORBIT_TOOL_ANNOTATIONS.orbit_api.readOnlyHint, false);
  assert.equal(ORBIT_TOOL_ANNOTATIONS.orbit_send_message.openWorldHint, true);
  assert.equal(ORBIT_TOOL_ANNOTATIONS.orbit_mark_message_read.openWorldHint, false);
});
