import assert from "node:assert/strict";
import { test } from "node:test";
import { read_folder_files, read_zip_file, accepted_code, create_transfer_session } from "../src/help/transfer_model.ts";
import type { PickedFile } from "../src/help/transfer_model.ts";
import type { ConfigImportPreview, SnippetPreview } from "../src/shared/messages.ts";
import { DEFAULT_ZIP_LIMITS, read_zip } from "../src/shared/zip.ts";

// A file whose content must not be read: reading it fails the test.
const unread_file = (name: string, size: number): PickedFile => ({
  name,
  size,
  webkitRelativePath: `cfg/${name}`,
  text: async () => assert.fail(`${name} was read`),
  arrayBuffer: async () => assert.fail(`${name} was read`),
});
const text_file = (name: string, text: string): PickedFile => ({ name, size: text.length, webkitRelativePath: `cfg/${name}`, text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) });

test("the page checks File.size against the zip limits before it reads any file", async () => {
  const { max_entry_bytes, max_total_bytes, max_entries } = DEFAULT_ZIP_LIMITS;
  await assert.rejects(read_folder_files([text_file("a.toml", "x = 1\n"), unread_file("big.toml", max_entry_bytes + 1)]), /big\.toml is too large/);
  await assert.rejects(read_folder_files([text_file("a.toml", "x"), unread_file("one.toml", max_entry_bytes), unread_file("two.toml", 1)]), /folder is too large/);
  await assert.rejects(read_folder_files(Array.from({ length: max_entries + 1 }, (_, index) => unread_file(`f${index}.toml`, 1))), /too many files/);
  await assert.rejects(read_zip_file(unread_file("huge.zip", max_total_bytes * 2)), /huge\.zip is too large/);
  const ok = await read_folder_files([text_file("settings.toml", "x = 1\n")]);
  assert.deepEqual(ok, { kind: "folder", entries: [{ path: "cfg/settings.toml", text: "x = 1\n" }] });
});

const snippet = (path: string, code: string, extra: Partial<SnippetPreview> = {}): SnippetPreview => ({ path, code, replaces: false, problems: [], id: path, matches: ["https://a.test/*"], requires: [], ...extra });
const preview_of = (snippets: SnippetPreview[], extra: Partial<Extract<ConfigImportPreview, { ok: true }>> = {}): ConfigImportPreview => ({ ok: true, replaces_config: true, config_files: ["settings.toml"], snippets, problems: [], warnings: [], ...extra });

function session_with(answers: Record<string, unknown>) {
  const sent: { type: string; [key: string]: unknown }[] = [];
  const session = create_transfer_session({
    send: async (message) => {
      sent.push(message as never);
      const answer = answers[message.type];
      return typeof answer === "function" ? answer(message) : answer;
    },
    on_change: () => undefined,
  });
  return { session, sent };
}
const source_reader = async () => ({ kind: "folder" as const, entries: [{ path: "cfg/settings.toml", text: "x = 1\n" }] });

test("a pick sends the preview only: nothing is committed before the user accepts", async () => {
  const { session, sent } = session_with({ preview_config_import: preview_of([snippet("snippets/a.js", "A"), snippet("snippets/b.js", "B")]) });
  await session.choose(source_reader);
  assert.deepEqual(sent.map((message) => message.type), ["preview_config_import"]);
  assert.equal(session.state.review?.accepted.size, 0);
  assert.deepEqual(accepted_code(session.state.review!), {});
});

test("the commit sends only the ticked snippets, with the exact code the preview showed", async () => {
  const { session, sent } = session_with({
    preview_config_import: preview_of([snippet("snippets/a.js", "A code"), snippet("snippets/b.js", "B code")]),
    commit_config_import: { ok: true, message: "Imported" },
    list_snippets: { ok: true, snippets: [] },
  });
  await session.choose(source_reader);
  session.accept("snippets/b.js", true);
  session.accept("snippets/a.js", true);
  session.accept("snippets/a.js", false);
  await session.commit();
  const commit = sent.find((message) => message.type === "commit_config_import")!;
  assert.deepEqual(commit.accepted, { "snippets/b.js": "B code" });
  assert.equal(session.state.review, undefined);
  assert.deepEqual(session.state.message, { ok: true, text: "Imported" });
});

test("a snippet with a header problem cannot be committed, and a refused import ends the review with the message", async () => {
  const bad = session_with({ preview_config_import: preview_of([snippet("snippets/a.js", "A")], { problems: ["keymap.toml: binds a missing command"] }) });
  await bad.session.choose(source_reader);
  await bad.session.commit();
  assert.deepEqual(bad.sent.map((message) => message.type), ["preview_config_import"]);

  const refused = session_with({
    preview_config_import: preview_of([snippet("snippets/a.js", "A")]),
    commit_config_import: { ok: false, message: "Config not imported, the current one stays. A problem." },
    list_snippets: { ok: true, snippets: [] },
  });
  await refused.session.choose(source_reader);
  refused.session.accept("snippets/a.js", true);
  await refused.session.commit();
  assert.equal(refused.session.state.review, undefined);
  assert.deepEqual(refused.session.state.message, { ok: false, text: "Config not imported, the current one stays. A problem." });
  assert.ok(!refused.sent.some((message) => message.type === "export_config"));
});

test("a failed read or preview shows the message and sends no commit", async () => {
  const { session, sent } = session_with({ preview_config_import: { ok: false, message: "Config not imported, the current one stays. The zip is refused." } });
  await session.choose(source_reader);
  assert.equal(session.state.review, undefined);
  assert.match(session.state.message!.text, /zip is refused/);
  await session.choose(() => read_folder_files([unread_file("big.toml", DEFAULT_ZIP_LIMITS.max_entry_bytes + 1)]));
  assert.match(session.state.message!.text, /^Config not imported, the current one stays\. The import is refused: .*too large/);
  assert.deepEqual(sent.map((message) => message.type), ["preview_config_import"]);
});

test("an export with nothing to write says so and builds no zip", async () => {
  const { session } = session_with({ export_config: { ok: true, config_files: { "settings.toml": "x = 1\n" }, snippet_files: {} } });
  assert.equal(await session.export_zip("snippets"), undefined);
  assert.match(session.state.message!.text, /no snippet is installed/);
  const file = await session.export_zip("config");
  assert.equal(file?.name, "desertfox-config.zip");
  assert.deepEqual([...(await read_zip(file!.bytes))], [["settings.toml", "x = 1\n"]]);
});

test("a superseded pick cannot replace the newer review, and a cancel drops a pick still waiting", async () => {
  const release: (() => void)[] = [];
  const sent: unknown[] = [];
  const session = create_transfer_session({
    send: async (message) => {
      sent.push(message);
      const { source } = message as { source: { entries: { text: string }[] } };
      const code = source.entries[0]!.text;
      if (code === "old") await new Promise<void>((resolve) => release.push(resolve));
      return preview_of([snippet("snippets/a.js", code)]);
    },
    on_change: () => undefined,
  });
  const pick = (text: string) => async () => ({ kind: "folder" as const, entries: [{ path: "cfg/snippets/a.js", text }] });
  const older = session.choose(pick("old"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await session.choose(pick("new"));
  release[0]!();
  await older;
  assert.equal(session.state.review?.preview.snippets[0]?.code, "new");
  assert.equal((session.state.review!.source as { entries: { text: string }[] }).entries[0]!.text, "new");

  const waiting = session.choose(pick("old"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  session.cancel();
  release[1]!();
  await waiting;
  assert.equal(session.state.review, undefined);
  assert.equal(session.state.busy, false);
});
