import assert from "node:assert/strict";
import { test } from "node:test";
import { ALIASES_KIND, can_save, create_pairs_session, form_problems, QUICKMARKS_KIND } from "../src/help/pairs_model.ts";
import type { PairsKind, PairsRequest } from "../src/help/pairs_model.ts";

function session(kind: PairsKind, answer: (message: PairsRequest) => unknown) {
  const sent: PairsRequest[] = [];
  return { sent, session: create_pairs_session(kind, { send: async (message) => (sent.push(message), answer(message)), on_change: () => undefined }) };
}

test("the alias form names a name with whitespace and keeps Save off until both fields are filled", () => {
  const { session: aliases } = session(ALIASES_KIND, () => ({ ok: true, aliases: [] }));
  assert.deepEqual(form_problems(ALIASES_KIND, aliases.state.form), []);
  aliases.set_field("key", "two words");
  aliases.set_field("value", "tab.prev");
  assert.equal(form_problems(ALIASES_KIND, aliases.state.form).length, 1);
  assert.equal(can_save(ALIASES_KIND, aliases.state), false);
  aliases.set_field("key", "up");
  assert.equal(can_save(ALIASES_KIND, aliases.state), true);
});

test("the quickmark form takes one letter or digit and an address", () => {
  const { session: marks } = session(QUICKMARKS_KIND, () => ({ ok: true, quickmarks: [] }));
  marks.set_field("key", "ab");
  marks.set_field("value", "https://a.test/");
  assert.match(form_problems(QUICKMARKS_KIND, marks.state.form)[0]!, /one letter or digit/);
  assert.equal(can_save(QUICKMARKS_KIND, marks.state), false);
  marks.set_field("key", "a");
  assert.equal(can_save(QUICKMARKS_KIND, marks.state), true);
  marks.set_field("value", " ");
  assert.equal(can_save(QUICKMARKS_KIND, marks.state), false);
});

test("a save sends the alias and clears the form, a refusal keeps it and shows every problem", async () => {
  let refuse = true;
  const { session: aliases, sent } = session(ALIASES_KIND, (message) => (message.type === "list_aliases" ? { ok: true, aliases: [{ name: "up", target: "tab.prev" }, { name: "gone", target: "tab.x", left_out: "unknown command id" }] } : refuse ? { ok: false, message: "Edit not saved.", problems: ["one bad", "two bad"] } : { ok: true, message: "Saved." }));
  aliases.set_field("key", "up");
  aliases.set_field("value", "tab.prev");
  await aliases.save();
  assert.deepEqual(sent[0], { type: "change_aliases", action: "set", name: "up", target: "tab.prev" });
  assert.equal(aliases.state.message?.text, "Edit not saved.\none bad\ntwo bad");
  assert.equal(aliases.state.form.key, "up");
  refuse = false;
  await aliases.save();
  assert.equal(aliases.state.form.key, "");
  assert.deepEqual(aliases.state.rows.map((row) => [row.key, row.left_out]), [["up", undefined], ["gone", "unknown command id"]]);
  await aliases.remove("up");
  assert.deepEqual(sent.at(-2), { type: "change_aliases", action: "remove", name: "up" });
});

test("quickmark rows from quickmarks.toml cannot be removed, and a save that lands after Edit keeps the draft", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { session: marks } = session(QUICKMARKS_KIND, async (message) => {
    if (message.type === "list_quickmarks") return { ok: true, quickmarks: [{ key: "f", url: "https://file.test/", saved: false }, { key: "m", url: "https://mail.test/", saved: true }] };
    await gate;
    return { ok: true, message: "Saved." };
  });
  await marks.refresh();
  assert.deepEqual(marks.state.rows.map((row) => [row.key, row.removable]), [["f", false], ["m", true]]);
  marks.set_field("key", "n");
  marks.set_field("value", "https://n.test/");
  const saving = marks.save();
  marks.edit(marks.state.rows[0]!);
  release();
  await saving;
  assert.equal(marks.state.form.key, "f");
  assert.equal(marks.state.editing, "f");
});
