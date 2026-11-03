import assert from "node:assert/strict";
import { test } from "node:test";
import { run_token, typed_edit } from "../../src/cmdline/key_input.ts";
import { create_session } from "../../src/cmdline/session.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch } from "../../src/shared/prefix_tree.ts";

// A keymap with just the cmdline mode, built from the default bindings.
function cmdline_keymap(): CompiledKeymap {
  const children: TreeBranch["children"] = {};
  for (const [token, binding] of Object.entries(DEFAULT_KEYMAP.cmdline ?? {})) {
    children[token] = { kind: "leaf", steps: [{ invocation: binding as { id: string }, runs_in: "content", count_rule: "ignore" }] };
  }
  return { format_version: COMPILED_KEYMAP_VERSION, modes: { cmdline: { kind: "branch", children } }, ignore_sites: [], mode_indicator: "always", which_key_delay_ms: 0 };
}

const setup = () => ({
  matcher: create_matcher(cmdline_keymap()),
  session: create_session({ history: ["old"], parse: () => ({ kind: "error", error: "no" }) }),
});

test("every default cmdline key resolves to an effect", () => {
  const { matcher, session } = setup();
  for (const token of ["<Tab>", "<S-Tab>", "<C-n>", "<C-p>", "<Escape>", "<C-u>", "<ArrowUp>", "<ArrowDown>", "<Enter>"]) {
    assert.equal(run_token(matcher, session, token).kind, "effect", token);
  }
});

test("Escape closes, Up recalls history, and plain letters are left to the text", () => {
  const { matcher, session } = setup();
  assert.deepEqual(run_token(matcher, session, "<Escape>"), { kind: "effect", effect: { kind: "close" } });
  run_token(matcher, session, "<ArrowUp>");
  assert.equal(session.get_text(), "old");
  assert.deepEqual(run_token(matcher, session, "a"), { kind: "unbound" });
});

test("a forwarded token types a character, a space or a backspace, and drops other keys", () => {
  assert.deepEqual(typed_edit("a"), { insert: "a" });
  assert.deepEqual(typed_edit("<Space>"), { insert: " " });
  assert.deepEqual(typed_edit("<Backspace>"), { backspace: true });
  assert.equal(typed_edit("<C-w>"), undefined);
  assert.equal(typed_edit("<F5>"), undefined);
});
