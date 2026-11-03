import assert from "node:assert/strict";
import { test } from "node:test";
import { edit_forwarded, run_token, run_token_without_keymap } from "../../src/cmdline/key_input.ts";
import { create_session } from "../../src/cmdline/session.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch } from "../../src/shared/prefix_tree.ts";

// A keymap with just the cmdline mode, built from the default bindings.
const leaf = (id: string) => ({ kind: "leaf" as const, steps: [{ invocation: { id }, runs_in: "content" as const, count_rule: "ignore" as const }] });

function cmdline_keymap(extra: TreeBranch["children"] = {}): CompiledKeymap {
  const children: TreeBranch["children"] = { ...extra };
  for (const [token, binding] of Object.entries(DEFAULT_KEYMAP.cmdline ?? {})) children[token] = leaf((binding as { id: string }).id);
  return { format_version: COMPILED_KEYMAP_VERSION, modes: { cmdline: { kind: "branch", children } }, ignore_sites: [], mode_indicator: "always", which_key_delay_ms: 0 };
}

const setup = (extra: TreeBranch["children"] = {}) => ({
  matcher: create_matcher(cmdline_keymap(extra)),
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
  const at_end = { text: "ab", start: 2, end: 2 };
  assert.deepEqual(edit_forwarded(at_end, "c"), { text: "abc", caret: 3 });
  assert.deepEqual(edit_forwarded(at_end, "<Space>"), { text: "ab ", caret: 3 });
  assert.deepEqual(edit_forwarded(at_end, "<Backspace>"), { text: "a", caret: 1 });
  assert.equal(edit_forwarded(at_end, "<C-w>"), undefined);
  assert.equal(edit_forwarded(at_end, "<F5>"), undefined);
});

test("forwarded editing keys move the caret and delete, as in a text field", () => {
  const field = (text: string, caret: number, end = caret) => ({ text, start: caret, end });
  // Left then Backspace on a prefilled line removes the character before the caret, not the last one.
  const left = edit_forwarded(field("open x", 6), "<ArrowLeft>")!;
  assert.deepEqual(left, { text: "open x", caret: 5 });
  assert.deepEqual(edit_forwarded(field(left.text, left.caret), "<Backspace>"), { text: "openx", caret: 4 });
  assert.deepEqual(edit_forwarded(field("abc", 1), "<ArrowRight>"), { text: "abc", caret: 2 });
  assert.deepEqual(edit_forwarded(field("abc", 2), "<Home>"), { text: "abc", caret: 0 });
  assert.deepEqual(edit_forwarded(field("abc", 0), "<End>"), { text: "abc", caret: 3 });
  assert.deepEqual(edit_forwarded(field("abc", 0), "<Delete>"), { text: "bc", caret: 0 });
  assert.deepEqual(edit_forwarded(field("abc", 0, 2), "<Delete>"), { text: "c", caret: 0 });
  assert.deepEqual(edit_forwarded(field("abc", 3), "<ArrowRight>"), { text: "abc", caret: 3 });
  assert.deepEqual(edit_forwarded(field("abc", 0), "<Backspace>"), { text: "abc", caret: 0 });
});

test("a user sequence in cmdline mode waits for its second key", () => {
  const { matcher, session } = setup({ "<C-x>": { kind: "branch", children: { "<C-k>": leaf("cmdline.clear") } } });
  session.edit("open x");
  assert.deepEqual(run_token(matcher, session, "<C-x>"), { kind: "effect", effect: { kind: "render" } });
  run_token(matcher, session, "<C-k>");
  assert.equal(session.get_text(), "");
});

test("a key that breaks a sequence runs as if typed alone", () => {
  const { matcher, session } = setup({ "<C-x>": { kind: "branch", children: { "<C-k>": leaf("cmdline.clear") } } });
  run_token(matcher, session, "<C-x>");
  assert.deepEqual(run_token(matcher, session, "<Escape>"), { kind: "effect", effect: { kind: "close" } });
  run_token(matcher, session, "<C-x>");
  assert.deepEqual(run_token(matcher, session, "a"), { kind: "unbound" });
});

test("with no stored keymap Enter still submits and Escape still closes", () => {
  const session = create_session({ history: [], parse: () => ({ kind: "invocation", invocation: { id: "scroll.down" } }) });
  assert.deepEqual(run_token_without_keymap(session, "<Escape>"), { kind: "effect", effect: { kind: "close" } });
  session.edit("scroll down");
  assert.equal((run_token_without_keymap(session, "<Enter>") as { effect: { kind: string } }).effect.kind, "submit");
  assert.deepEqual(run_token_without_keymap(session, "a"), { kind: "unbound" });
});

test("a cmdline binding with several commands runs them in order", () => {
  const steps = (...ids: string[]) => ({ kind: "leaf" as const, steps: ids.map((id) => ({ invocation: { id }, runs_in: "content" as const, count_rule: "ignore" as const })) });
  const { matcher, session } = setup({ "<C-k>": steps("cmdline.clear", "mode.escape") });
  session.edit("open x");
  assert.deepEqual(run_token(matcher, session, "<C-k>"), { kind: "effect", effect: { kind: "close" } });
  assert.equal(session.get_text(), "");
});
