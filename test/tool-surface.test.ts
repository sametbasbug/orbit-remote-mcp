import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  ORBIT_READ_ACTIONS,
  ORBIT_TOOL_ANNOTATIONS,
  ORBIT_TOOL_NAMES,
  ORBIT_TOOL_OUTPUT_SCHEMA,
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

test("keeps one stable structured-output envelope for both permanent tools", () => {
  const schema = z.object(ORBIT_TOOL_OUTPUT_SCHEMA);

  assert.equal(
    schema.safeParse({
      schemaVersion: 1,
      ok: true,
      data: { operationId: "listDirectMessages", directMessages: [] },
      error: null,
    }).success,
    true,
  );
  assert.equal(
    schema.safeParse({
      schemaVersion: 1,
      ok: false,
      data: null,
      error: "bounded failure",
    }).success,
    true,
  );
  assert.equal(
    schema.safeParse({
      schemaVersion: 2,
      ok: true,
      data: {},
      error: null,
    }).success,
    false,
  );
});
