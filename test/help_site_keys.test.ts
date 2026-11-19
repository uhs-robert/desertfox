import assert from "node:assert/strict";
import { test } from "node:test";
import { create_site_keys_session, OFF_NOTE, SITE_PROBLEM } from "../src/help/site_keys_model.ts";
import type { SiteRuleRow } from "../src/shared/match_pattern.ts";

const MAIL = "*://*.mail.test/*";
const BINDINGS = [
  { mode: "normal", keys: "j", text: "scroll.down", origin: "default" },
  { mode: "normal", keys: "k", text: "scroll.up", origin: "default" },
  { mode: "normal", keys: "gg", text: "scroll.top", origin: "default" },
  { mode: "insert", keys: "<C-x>", text: "x", origin: "default" },
];

function make(rules: SiteRuleRow[] = []) {
  const sent: unknown[] = [];
  let current = rules;
  let reply: unknown = { ok: true, message: "Keys kept" };
  const session = create_site_keys_session({
    send: async (message) => (sent.push(message), message.type === "list_bindings" ? { ok: true, bindings: BINDINGS } : reply),
    read_rules: async () => current,
    on_change: () => undefined,
  });
  return { session, sent, set_rules: (next: SiteRuleRow[]) => void (current = next), set_reply: (next: unknown) => void (reply = next) };
}

test("the popup's site fills the form, and captured keys become chips that Save sends as one pass string", async () => {
  const { session, sent } = make();
  await session.load(MAIL);
  assert.equal(session.view().site, MAIL);
  assert.equal(session.view().can_save, false);
  session.capture("j");
  session.capture("k");
  session.capture("j");
  assert.deepEqual(session.view().chips, ["j", "k"]);
  assert.equal(session.view().effect, "Pass 2 keys: j k");
  await session.save();
  assert.deepEqual(sent.at(-1), { type: "site_keys", pattern: MAIL, keys: "j k" });
  assert.deepEqual(session.view().message, { ok: true, text: "Keys kept" });
});

test("the list offers the bound normal mode keys once, filters them, and a tick adds or drops the chip", async () => {
  const { session } = make();
  await session.load(MAIL);
  assert.deepEqual(session.view().picks.map((row) => row.keys), ["j", "k", "gg"]);
  session.set_filter("scroll.t");
  assert.deepEqual(session.view().picks.map((row) => row.keys), ["gg"]);
  session.toggle_pick("gg");
  assert.deepEqual(session.view().chips, ["gg"]);
  session.toggle_pick("gg");
  assert.deepEqual(session.view().chips, []);
});

test("backspace and a chip's x drop keys, and the text fold stays in step both ways", async () => {
  const { session } = make();
  await session.load(MAIL);
  ["j", "k", "<C-x>"].forEach((token) => session.capture(token));
  assert.equal(session.view().text, "j k <C-x>");
  session.capture_backspace();
  session.remove_chip("j");
  assert.deepEqual(session.view().chips, ["k"]);
  session.set_text("g g  q");
  assert.deepEqual(session.view().chips, ["g", "q"]);
  session.set_text("q <x>");
  assert.deepEqual(session.view().chips, ["g", "q"], "a line that does not read leaves the chips");
  assert.ok(session.view().text_problem);
  assert.equal(session.view().can_save, false);
});

test("a site that already has a pass row opens filled, Save needs a change, and Remove sends null", async () => {
  const { session, sent } = make([{ site: MAIL, pass: "j k" }]);
  await session.load(MAIL);
  assert.deepEqual(session.view().chips, ["j", "k"]);
  assert.equal(session.view().has_row, true);
  assert.equal(session.view().can_save, false);
  session.toggle_pick("k");
  assert.equal(session.view().can_save, true);
  await session.remove();
  assert.deepEqual(sent.at(-1), { type: "site_keys", pattern: MAIL, keys: null });
  assert.deepEqual(session.view().chips, []);
});

test("an earlier rule that sets the key column shows the refusal and blocks Save", async () => {
  const { session } = make([{ site: "*://*.test/*", pass: "q" }]);
  await session.load(MAIL);
  session.capture("j");
  assert.match(session.view().refusal ?? "", /\*:\/\/\*\.test\/\*/);
  assert.equal(session.view().can_save, false);
});

test("a rule with other fields on the site is named as not editable here", async () => {
  const { session } = make([{ site: MAIL, only: "j" }]);
  await session.load(MAIL);
  assert.match(session.view().refusal ?? "", /sets only with other fields/);
});

test("a site that is not an address pattern is said so, and an off site is noted", async () => {
  const { session } = make([{ site: MAIL, off: true }]);
  await session.load(MAIL);
  assert.equal(session.view().off_note, OFF_NOTE);
  session.set_site("mail");
  session.capture("j");
  assert.equal(session.view().site_problem, SITE_PROBLEM);
  assert.equal(session.view().can_save, false);
});

test("a refused write shows the answer's text and keeps the chips", async () => {
  const { session, set_reply } = make();
  await session.load(MAIL);
  session.capture("j");
  set_reply({ ok: false, message: "Not saved. no" });
  await session.save();
  assert.deepEqual(session.view().message, { ok: false, text: "Not saved. no" });
  assert.deepEqual(session.view().chips, ["j"]);
});

test("a refresh after another tab changed the row updates a clean form and keeps a typed one", async () => {
  const { session, set_rules } = make([{ site: MAIL, pass: "j" }]);
  await session.load(MAIL);
  set_rules([{ site: MAIL, pass: "j k" }]);
  await session.refresh();
  assert.deepEqual(session.view().chips, ["j", "k"]);
  session.capture("c");
  set_rules([{ site: MAIL, pass: "q" }]);
  await session.refresh();
  assert.deepEqual(session.view().chips, ["j", "k", "c"]);
});
