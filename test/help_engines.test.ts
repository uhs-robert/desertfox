import assert from "node:assert/strict";
import { test } from "node:test";
import { can_save, create_engines_session, form_problems } from "../src/help/engines_model.ts";
import type { ChangeEngines, ListEngines } from "../src/shared/messages.ts";

function session(answer: (message: ListEngines | ChangeEngines) => unknown) {
  const sent: (ListEngines | ChangeEngines)[] = [];
  return { sent, session: create_engines_session({ send: async (message) => (sent.push(message), answer(message)), on_change: () => undefined }) };
}

test("the form names a bad address, keyword and key letter while typing and keeps Save off", () => {
  const { session: engines } = session(() => ({ ok: true, engines: [] }));
  assert.deepEqual(form_problems(engines.state.form), []);
  engines.set_field("name", "wiki");
  engines.set_field("url", "https://w.test/");
  assert.match(form_problems(engines.state.form)[0]!, /\{query\}/);
  assert.equal(can_save(engines.state), false);
  engines.set_field("url", "https://w.test/?q={query}");
  engines.set_field("keyword", "TOOLONGKEYWORD");
  engines.set_field("letter", "ab");
  assert.equal(form_problems(engines.state.form).length, 2);
  engines.set_field("keyword", "w");
  engines.set_field("letter", "w");
  assert.equal(can_save(engines.state), true);
});

test("a save sends the fields and clears the form, a refusal keeps it and shows every problem", async () => {
  let refuse = true;
  const { session: engines, sent } = session((message) => (message.type === "list_engines" ? { ok: true, engines: [] } : refuse ? { ok: false, message: "Edit not saved.", problems: ["one bad", "two bad"] } : { ok: true, message: "Saved." }));
  engines.set_field("name", "wiki");
  engines.set_field("url", "https://w.test/?q={query}");
  await engines.save();
  assert.deepEqual(sent[0], { type: "change_engines", action: "set", name: "wiki", url: "https://w.test/?q={query}" });
  assert.equal(engines.state.message?.text, "Edit not saved.\none bad\ntwo bad");
  assert.equal(engines.state.form.name, "wiki");
  refuse = false;
  await engines.save();
  assert.equal(engines.state.message?.ok, true);
  assert.equal(engines.state.form.name, "");
});
