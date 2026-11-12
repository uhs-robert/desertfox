import assert from "node:assert/strict";
import { test } from "node:test";
import { template_for } from "../src/help/file_templates.ts";
import { create_user_css_gate } from "../src/help/user_css_gate.ts";
import { create_files_session } from "../src/help/files_model.ts";

function session_with(answer_of: (message: { op: string; path?: string; text?: string | null; accepted?: string }) => unknown, user_css_hold?: import("../src/help/user_css_gate.ts").UserCssHold) {
  const sent: { op: string; path?: string; text?: string | null; accepted?: string }[] = [];
  const session = create_files_session({
    send: async (message) => {
      sent.push(message as never);
      return answer_of(message as never);
    },
    on_change: () => undefined,
    ...(user_css_hold && { user_css_hold }),
  });
  return { session, sent };
}

test("a new file starts from its template, and a bad path or a taken one is refused", async () => {
  const { session } = session_with((message) => (message.op === "read" ? { ok: true, files: { "keymap.toml": "x" } } : { ok: true, message: "Saved." }));
  await session.load();
  assert.match(session.start_new("notes.txt") ?? "", /not a config file/);
  assert.match(session.start_new("keymap.toml") ?? "", /exists already/);
  assert.equal(session.start_new("search_engines.toml"), undefined);
  assert.equal(session.state.open?.is_new, true);
  assert.equal(session.state.open?.text, template_for("search_engines.toml"));
  assert.match(session.state.open!.text, /^#/);
  for (const path of ["keymap.toml", "keymap.d/a.toml", "search_engines.toml", "command_aliases.toml", "quickmarks.toml", "settings.toml", "style.css", "themes/x.toml", "snippets/x.js"]) assert.notEqual(template_for(path), "", path);
});

test("a refused save shows every problem and keeps the draft", async () => {
  const problems = ["a: x", "b: y", "c: z", "d: w", "e: v"];
  const { session } = session_with((message) => (message.op === "read" ? { ok: true, files: { "settings.toml": "ok" } } : { ok: false, message: "File not saved", problems }));
  await session.load();
  session.open("settings.toml");
  session.edit("broken");
  await session.save();
  assert.deepEqual(session.state.problems, problems);
  assert.equal(session.state.message?.ok, false);
  assert.equal(session.state.open?.text, "broken");
  assert.equal(session.state.files["settings.toml"], "ok");
});

test("a snippet save waits for consent to its exact code, and an edit voids the consent", async () => {
  const consent = { path: "snippets/a.js", code: "A", replaces: false, problems: [], matches: [], requires: [] };
  const { session, sent } = session_with((message) => {
    if (message.op === "read") return { ok: true, files: {} };
    return message.accepted === message.text ? { ok: true, message: "Saved." } : { ok: false, message: "consent", consent: { ...consent, code: message.text } };
  });
  await session.load();
  session.start_new("snippets/a.js");
  session.edit("A");
  await session.save();
  assert.equal(session.state.consent?.code, "A");
  assert.equal(sent.at(-1)?.accepted, undefined);
  session.edit("AB");
  assert.equal(session.state.consent, undefined);
  await session.save();
  session.accept(true);
  await session.save();
  assert.equal(sent.findLast((message) => message.op === "save")?.accepted, "AB");
  assert.equal(session.state.consent, undefined);
  assert.equal(session.state.message?.ok, true);
});

test("a delete sends text null and closes the open file", async () => {
  const { session, sent } = session_with((message) => (message.op === "read" ? { ok: true, files: { "style.css": "a" } } : { ok: true, message: "Deleted." }));
  await session.load();
  session.open("style.css");
  await session.remove("style.css");
  assert.deepEqual(sent.at(-2), { type: "config_files", op: "save", path: "style.css", text: null, base: "a" });
  assert.equal(session.state.open, undefined);
});

test("text typed while a save runs stays as typed, and the save carries the text read at open", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { session, sent } = session_with(async (message) => {
    if (message.op === "read") return { ok: true, files: { "keymap.toml": "old" } };
    await gate;
    return { ok: true, message: "Saved." };
  });
  await session.load();
  session.open("keymap.toml");
  session.edit("first");
  const saving = session.save();
  session.edit("first and more");
  release();
  await saving;
  assert.equal(session.state.open?.text, "first and more");
  assert.equal(session.state.open?.base, "first");
  assert.deepEqual(sent.find((message) => message.op === "save"), { type: "config_files", op: "save", path: "keymap.toml", text: "first", base: "old" });
});

test("a refusal because the file changed keeps the draft and reloads the list", async () => {
  let stored = "old";
  const { session, sent } = session_with((message) => {
    if (message.op === "read") return { ok: true, files: { "keymap.toml": stored } };
    return { ok: false, message: "changed since you opened it" };
  });
  await session.load();
  session.open("keymap.toml");
  stored = "imported";
  session.edit("mine");
  await session.save();
  assert.equal(session.state.files["keymap.toml"], "imported");
  assert.equal(session.state.open?.text, "mine");
  assert.equal(session.state.open?.base, "old");
  assert.equal(sent.filter((message) => message.op === "read").length, 2);
});

test("the consent card holds user css off while it shows, and a mount that is gone cannot release the next one", async () => {
  const sheet = { media: "" };
  const open_hold = create_user_css_gate(sheet);
  const consent = { path: "snippets/a.js", code: "A", replaces: false, problems: [] };
  const answers = (message: { op: string; text?: string | null; accepted?: string }) =>
    message.op === "read" ? { ok: true, files: {} } : message.accepted === message.text ? { ok: true, message: "Saved." } : { ok: false, message: "consent", consent: { ...consent, code: message.text } };
  const old_hold = open_hold();
  const { session: old_session } = session_with(answers, old_hold);
  await old_session.load();
  old_session.start_new("snippets/a.js");
  old_session.edit("A");
  assert.equal(sheet.media, "");
  await old_session.save();
  assert.equal(sheet.media, "not all");
  // An edit voids the consent and releases the hold.
  old_session.edit("AB");
  assert.equal(sheet.media, "");
  await old_session.save();
  assert.equal(sheet.media, "not all");
  // The route is rebuilt: the old mount is disposed and the new mount holds for its own consent card.
  old_hold.dispose();
  const new_hold = open_hold();
  const { session: new_session } = session_with(answers, new_hold);
  await new_session.load();
  new_session.start_new("snippets/b.js");
  new_session.edit("B");
  await new_session.save();
  assert.equal(sheet.media, "not all");
  // A late callback of the old mount changes nothing.
  old_session.edit("late");
  assert.equal(sheet.media, "not all");
  new_session.accept(true);
  await new_session.save();
  assert.equal(sheet.media, "");
});

test("deleting the open file clears its consent card and releases the css hold", async () => {
  const sheet = { media: "" };
  const hold = create_user_css_gate(sheet)();
  const { session } = session_with((message) => {
    if (message.op === "read") return { ok: true, files: { "snippets/a.js": "A" } };
    if (message.text === null) return { ok: true, message: "Deleted." };
    return { ok: false, message: "consent", consent: { path: "snippets/a.js", code: "A", replaces: true, problems: [] } };
  }, hold);
  await session.load();
  session.open("snippets/a.js");
  await session.save();
  assert.equal(sheet.media, "not all");
  await session.remove("snippets/a.js");
  assert.equal(session.state.consent, undefined);
  assert.equal(sheet.media, "");
});

test("a session kept across a remount keeps its draft, and attach moves the hold to the new mount", async () => {
  const sheet = { media: "" };
  const open_hold = create_user_css_gate(sheet);
  const answers = (message: { op: string; text?: string | null }) =>
    message.op === "read" ? { ok: true, files: { "snippets/a.js": "A" } } : { ok: false, message: "consent", consent: { path: "snippets/a.js", code: message.text, replaces: true, problems: [] } };
  const first = open_hold();
  const { session } = session_with(answers, first);
  await session.load();
  session.open("snippets/a.js");
  session.edit("A2");
  await session.save();
  assert.equal(sheet.media, "not all");
  let redraws = 0;
  first.dispose();
  const second = open_hold();
  session.attach(() => redraws++, second);
  assert.equal(session.state.open?.text, "A2");
  assert.equal(sheet.media, "not all");
  session.edit("A3");
  assert.equal(redraws, 1);
  assert.equal(sheet.media, "");
});

test("a change of the stored file loads into an unedited draft and leaves an edited one", async () => {
  let stored = "old";
  const { session } = session_with((message) => (message.op === "read" ? { ok: true, files: { "keymap.toml": stored } } : { ok: true, message: "Saved." }));
  await session.load();
  session.open("keymap.toml");
  stored = "imported";
  await session.load();
  assert.deepEqual([session.state.open?.text, session.state.open?.base], ["imported", "imported"]);
  session.edit("mine");
  stored = "imported again";
  await session.load();
  assert.deepEqual([session.state.open?.text, session.state.open?.base], ["mine", "imported"]);
});
