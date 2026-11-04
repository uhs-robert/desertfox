import assert from "node:assert/strict";
import { test } from "node:test";
import { STYLE } from "../../src/content/toast.ts";

// Each toast kind frames itself in the color of one theme role.
const KIND_ROLES = { error: "error", warning: "warn", info: "info", success: "ok" };

test("each toast kind takes its frame color from its own role variable", () => {
  for (const [kind, role] of Object.entries(KIND_ROLES)) {
    const rule = new RegExp(`\\.oasisfox-toast\\.${kind} \\{([^}]*)\\}`).exec(STYLE)?.[1];
    assert.match(rule ?? "", new RegExp(`border: 1px solid var\\(--oasisfox-${role}, #[0-9a-f]{6}\\)`), kind);
  }
});

test("the toast text stays on the core colors in every kind", () => {
  assert.doesNotMatch(STYLE.replace(/\.oasisfox-toast\.[a-z]+ \{[^}]*\}/g, ""), /--oasisfox-(error|warn|ok|info)/);
});
