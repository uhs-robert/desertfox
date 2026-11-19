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
  assert.equal(themes.state.replacing?.name, "my_scheme");
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

test("a name change after the replace question asks again, and a confirm sends the name and text that were asked", async () => {
  const { themes, sent } = session((message) => (message.type === "list_imported_themes" ? { ok: true, names: ["my_scheme"] } : message.action === "save" && !message.replace ? { ok: false, needs_replace: true, message: "taken" } : { ok: true, message: "Replaced." }));
  themes.set_text(NAMED);
  await themes.save();
  assert.deepEqual(themes.state.replacing, { name: "my_scheme", text: NAMED });
  themes.set_name("other_name");
  assert.equal(themes.state.replacing, undefined);
  const before = sent.length;
  await themes.confirm_replace();
  assert.equal(sent.length, before, "a confirm with no question sent a request");
  await themes.save();
  assert.equal((themes.state.replacing as { name: string } | undefined)?.name, "other_name");
});

test("a draft changed while the save ran gets no replace question for the old one", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { themes } = session(async (message) => {
    if (message.type === "list_imported_themes") return { ok: true, names: [] };
    await gate;
    return { ok: false, needs_replace: true, message: "taken" };
  });
  themes.set_text(NAMED);
  const saving = themes.save();
  themes.set_name("changed");
  release();
  await saving;
  assert.equal(themes.state.replacing, undefined);
});

test("an older file read does not replace newer input, and the last pick wins", async () => {
  const { themes } = session(() => ({ ok: true, names: [] }));
  const slow = (text: string) => {
    let done!: () => void;
    const read = new Promise<string>((resolve) => (done = () => resolve(text)));
    return { file: { name: "x.yaml", size: text.length, text: () => read, arrayBuffer: async () => new ArrayBuffer(0) }, done };
  };
  const first = slow(NAMED);
  const second = slow(NAMED.replace("My Scheme", "Second"));
  const one = themes.load_file(first.file);
  const two = themes.load_file(second.file);
  second.done();
  await two;
  first.done();
  await one;
  assert.equal(themes.state.scheme?.name, "Second");
  const third = slow(NAMED);
  const three = themes.load_file(third.file);
  themes.set_text("typed after the pick");
  third.done();
  await three;
  assert.equal(themes.state.text, "typed after the pick");
});

test("a slow file read cannot refill the draft after Clear or after an oversized pick", async () => {
  const { themes } = session(() => ({ ok: true, names: [] }));
  let done!: () => void;
  const read = new Promise<string>((resolve) => (done = () => resolve(NAMED)));
  const loading = themes.load_file({ name: "x.yaml", size: 10, text: () => read, arrayBuffer: async () => new ArrayBuffer(0) });
  themes.clear();
  done();
  await loading;
  assert.equal(themes.state.text, "");
  let finish!: () => void;
  const slow = new Promise<string>((resolve) => (finish = () => resolve(NAMED)));
  const again = themes.load_file({ name: "y.yaml", size: 10, text: () => slow, arrayBuffer: async () => new ArrayBuffer(0) });
  await themes.load_file({ name: "big.yaml", size: 10_000_000, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) });
  finish();
  await again;
  assert.equal(themes.state.text, "");
  assert.match(themes.state.message?.text ?? "", /too large/);
});

test("a file that cannot be read shows a message and a stale failure stays quiet", async () => {
  const { themes } = session(() => ({ ok: true, names: [] }));
  const failing = { name: "bad.yaml", size: 10, text: async () => Promise.reject(new Error("denied")), arrayBuffer: async () => new ArrayBuffer(0) };
  await themes.load_file(failing);
  assert.match(themes.state.message?.text ?? "", /bad\.yaml could not be read: denied/);
  let fail!: () => void;
  const late = new Promise<string>((_, reject) => (fail = () => reject(new Error("late"))));
  const loading = themes.load_file({ ...failing, text: () => late });
  themes.set_text(NAMED);
  fail();
  await loading;
  assert.equal(themes.state.message, undefined);
});

test("a save clears the form only when both the name and the text are still the ones sent", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { themes } = session(async (message) => {
    if (message.type === "list_imported_themes") return { ok: true, names: [] };
    await gate;
    return { ok: true, message: "Saved." };
  });
  themes.set_text(NAMED);
  const saving = themes.save();
  themes.set_name("renamed");
  release();
  await saving;
  assert.equal(themes.state.name, "renamed");
  assert.equal(themes.state.text, NAMED);
});

test("theme files the host does not write are listed apart, so the page offers no Remove for them", async () => {
  const { themes } = session(() => ({ ok: true, names: ["dusk"], kept_names: ["Nord"] }));
  await themes.refresh();
  assert.deepEqual([themes.state.names, themes.state.kept_names], [["dusk"], ["Nord"]]);
});
