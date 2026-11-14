import assert from "node:assert/strict";
import { test } from "node:test";
import { can_save, create_themes_session, name_problem } from "../src/help/themes_model.ts";
import type { ChangeImportedThemes, ListImportedThemes } from "../src/shared/messages.ts";

const SCHEME = Array.from({ length: 16 }, (_, at) => `base${at.toString(16).padStart(2, "0")}: "${(at * 17).toString(16).padStart(2, "0").repeat(3)}"`).join("\n");
const NAMED = `scheme: "My Scheme"\n${SCHEME}\n`;

function session(answer: (message: ListImportedThemes | ChangeImportedThemes) => unknown) {
  const sent: (ListImportedThemes | ChangeImportedThemes)[] = [];
  return { sent, themes: create_themes_session({ send: async (message) => (sent.push(message), answer(message)), on_change: () => undefined }) };
}

test("typing a scheme gives a live preview and a suggested name, with no request sent", () => {
  const { themes, sent } = session(() => ({ ok: true, names: [] }));
  themes.set_text(NAMED);
  assert.equal(themes.state.scheme?.name, "My Scheme");
  assert.equal(themes.state.name, "my_scheme");
  assert.equal(can_save(themes.state), true);
  assert.deepEqual(sent, []);
});

test("a half-typed scheme shows its problem, drops the preview and keeps Save off", () => {
  const { themes } = session(() => ({ ok: true, names: [] }));
  themes.set_text(NAMED);
  themes.set_text(NAMED.split("\n").slice(0, 6).join("\n"));
  assert.equal(themes.state.scheme, undefined);
  assert.match(themes.state.text_problem ?? "", /lacks/);
  assert.equal(can_save(themes.state), false);
  themes.set_text("");
  assert.equal(themes.state.text_problem, undefined);
});

test("a built-in or malformed name keeps Save off, and a typed name stops following the scheme", () => {
  const { themes } = session(() => ({ ok: true, names: [] }));
  themes.set_text(NAMED);
  themes.set_name("oasis_luna");
  assert.match(name_problem(themes.state) ?? "", /built-in/);
  assert.equal(can_save(themes.state), false);
  themes.set_name("mine");
  themes.set_text(`scheme: "Renamed"\n${SCHEME}\n`);
  assert.equal(themes.state.name, "mine");
  assert.equal(can_save(themes.state), true);
});

test("a save sends the text and the name, then clears the form and lists the names", async () => {
  const { themes, sent } = session((message) => (message.type === "list_imported_themes" ? { ok: true, names: ["my_scheme"] } : { ok: true, message: "Saved the theme my_scheme." }));
  themes.set_text(NAMED);
  await themes.save();
  assert.deepEqual(sent[0], { type: "change_imported_themes", action: "save", name: "my_scheme", text: NAMED });
  assert.equal(themes.state.text, "");
  assert.equal(themes.state.message?.text, "Saved the theme my_scheme.");
  assert.deepEqual(themes.state.names, ["my_scheme"]);
});

test("a name that is taken asks before replacing, and a refusal keeps the draft", async () => {
  let taken = true;
  const { themes, sent } = session((message) => {
    if (message.type === "list_imported_themes") return { ok: true, names: ["my_scheme"] };
    if (message.action === "save" && taken && !message.replace) return { ok: false, needs_replace: true, message: "taken" };
    return { ok: true, message: "Replaced." };
  });
  themes.set_text(NAMED);
  await themes.save();
  assert.equal(themes.state.replacing, "my_scheme");
  assert.equal(themes.state.text, NAMED);
  assert.equal(can_save(themes.state) && themes.state.replacing === undefined, false);
  themes.cancel_replace();
  assert.equal(themes.state.replacing, undefined);
  await themes.save();
  taken = true;
  await themes.confirm_replace();
  assert.equal(sent.filter((message) => message.type === "change_imported_themes" && message.action === "save" && message.replace === true).length, 1);
  assert.equal(themes.state.replacing, undefined);
  assert.equal(themes.state.text, "");
});

test("a refusal from the background shows its message and keeps the text", async () => {
  const { themes } = session((message) => (message.type === "list_imported_themes" ? { ok: true, names: [] } : { ok: false, message: "Theme not saved: nope" }));
  themes.set_text(NAMED);
  await themes.save();
  assert.deepEqual(themes.state.message, { ok: false, text: "Theme not saved: nope" });
  assert.equal(themes.state.text, NAMED);
});

test("a picked file fills the box, and a file far past the scheme size is refused unread", async () => {
  const { themes } = session(() => ({ ok: true, names: [] }));
  const file = (text: string, size = text.length) => ({ name: "x.yaml", size, text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) });
  await themes.load_file(file(NAMED));
  assert.equal(themes.state.scheme?.name, "My Scheme");
  let read = false;
  await themes.load_file({ ...file("", 10_000_000), text: async () => ((read = true), "") });
  assert.equal(read, false);
  assert.match(themes.state.message?.text ?? "", /too large/);
});

test("remove sends the name and lists again", async () => {
  const { themes, sent } = session((message) => (message.type === "list_imported_themes" ? { ok: true, names: [] } : { ok: true, message: "Removed the theme a." }));
  await themes.remove("a");
  assert.deepEqual(sent[0], { type: "change_imported_themes", action: "remove", name: "a" });
  assert.equal(themes.state.message?.text, "Removed the theme a.");
  assert.equal(themes.state.loaded, true);
});
