import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { answer_config_files } from "../../src/background/config_files.ts";
import { ConfigRefusal } from "../../src/background/config_reload.ts";
import { FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
const fresh_startup = async (tag: string) => (await import(`../../src/background/startup.ts?files_${tag}`)) as Startup;

const snippet_code = "// id: files.mine\n// label: Mine\n// intent: Run mine.\n// matches: https://a.test/*\nglobalThis.ran = true;\n";
const slot_of = (local: Record<string, unknown>) => ({ files: (local[FILES_SOURCE_STORAGE_KEY] as { files: Files } | undefined)?.files, config: local[FILES_CONFIG_STORAGE_KEY] });

// No host files: a profile that never installed the host, which is the editor's case.
async function started(tag: string, host_files: Files = {}) {
  const host = { files: host_files, granted: false };
  const browser = install_fake_browser(host);
  const startup = await fresh_startup(tag);
  await startup.get_config();
  const answer = (request: Parameters<typeof answer_config_files>[0]) =>
    answer_config_files(request, { read_files: async () => slot_of(browser.local).files ?? {}, save: startup.save_config_file });
  // `base` is what the editor read: by default the stored text now.
  const save = (path: string, text: string | null, accepted?: string, base: string | null = slot_of(browser.local).files?.[path] ?? null) => answer({ type: "config_files", op: "save", path, text, base, ...(accepted !== undefined && { accepted }) });
  return { host, startup, save, answer, ...browser };
}

test("a save stores one file and builds the config from the stored files", async () => {
  const { save, local, answer } = await started("save");
  const first = await save("settings.toml", 'hint_letters = "ab"\n');
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(((await save("search_engines.toml", '[mine]\nurl = "https://e.test/?q={query}"\n')) as { ok: boolean }).ok, true);
  const slot = slot_of(local);
  assert.deepEqual(Object.keys(slot.files!).sort(), ["search_engines.toml", "settings.toml"]);
  assert.match(JSON.stringify(slot.config), /"hint_letters":"ab"/);
  assert.match(JSON.stringify(slot.config), /e\.test/);
  assert.deepEqual(await answer({ type: "config_files", op: "read" }), { ok: true, files: slot.files });
  const deleted = await save("settings.toml", null);
  assert.equal(deleted.ok, true);
  assert.deepEqual(Object.keys(slot_of(local).files!), ["search_engines.toml"]);
});

test("a failed build names every problem and leaves the stored files and the config as they were", async () => {
  const { save, local } = await started("fail");
  await save("settings.toml", 'hint_letters = "ab"\n');
  const before = structuredClone(slot_of(local));
  const bad = ["a", "b", "c", "d", "e"].map((name) => `no_such_${name} = 1`).join("\n");
  const answer = (await save("settings.toml", bad)) as { ok: false; message: string; problems?: string[] };
  assert.equal(answer.ok, false);
  assert.match(answer.message, /^File not saved, the current config stays\. Fix the files and save again\. 5 problem\(s\)/);
  assert.equal(answer.problems?.length, 5);
  assert.deepEqual(slot_of(local), before);
  const syntax = (await save("keymap.toml", "[normal\n")) as { problems?: string[] };
  // The stored name, not the host folder, and each problem once: the message holds the count only.
  assert.match(syntax.problems?.[0] ?? "", /^keymap\.toml:1:\d+/);
  assert.doesNotMatch((syntax as { message: string }).message, /keymap\.toml:1/);
  assert.deepEqual(slot_of(local), before);
});

test("saves queue: overlapping saves apply in order, and a failing one changes nothing for the others", async () => {
  const { save, local, startup } = await started("race");
  const results = await Promise.all([
    save("settings.toml", 'hint_letters = "ab"\n'),
    save("quickmarks.toml", "g = 1\n"),
    save("search_engines.toml", '[mine]\nurl = "https://e.test/?q={query}"\n'),
    save("style.css", "a {}\n"),
  ]);
  assert.deepEqual(results.map((result) => result.ok), [true, false, true, true]);
  const slot = slot_of(local);
  assert.deepEqual(Object.keys(slot.files!).sort(), ["search_engines.toml", "settings.toml", "style.css"]);
  // The stored config is the build of the stored files, so the two never part.
  assert.match(JSON.stringify(slot.config), /"hint_letters":"ab"/);
  assert.match(JSON.stringify(await startup.get_config()), /"hint_letters":"ab"/);
});

test("a save and a reload that overlap run one after the other, whichever came first", async () => {
  const { save, local, host, startup } = await started("reload", { "settings.toml": 'hint_letters = "hj"\n' });
  host.granted = true;
  await startup.reload_config();
  const [saved, reloaded] = await Promise.all([save("keymap.toml", "[normal]\n"), startup.reload_config()]);
  assert.equal(saved.ok, true);
  assert.equal(reloaded.warnings, 0);
  // The reload ran second and replaced the file set with the host's.
  assert.deepEqual(Object.keys(slot_of(local).files!), ["settings.toml"]);
  const [reloaded_first, saved_second] = await Promise.all([startup.reload_config(), save("keymap.toml", "[normal]\n")]);
  assert.equal(reloaded_first.config_dir, "/home/u/.config/desertfox");
  assert.equal(saved_second.ok, true);
  assert.deepEqual(Object.keys(slot_of(local).files!).sort(), ["keymap.toml", "settings.toml"]);
  // A failing save writes nothing: the slot after it is the one the save before it left, and only then does the reload replace it.
  const before = structuredClone(slot_of(local));
  const failed = await save("settings.toml", "no_such = 1\n");
  assert.equal(failed.ok, false);
  assert.deepEqual(slot_of(local), before);
  await startup.reload_config();
  assert.deepEqual(slot_of(local).files, { "settings.toml": 'hint_letters = "hj"\n' });
});

test("a snippet is stored only with consent to its exact code", async () => {
  const { save, local } = await started("consent");
  const first = (await save("snippets/mine.js", snippet_code)) as { ok: false; consent?: { path: string; code: string; matches?: string[]; replaces: boolean } };
  assert.equal(first.ok, false);
  assert.equal(first.consent?.code, snippet_code);
  assert.deepEqual(first.consent?.matches, ["https://a.test/*"]);
  assert.equal(slot_of(local).files, undefined);
  const stale = (await save("snippets/mine.js", snippet_code, "// other\n")) as { consent?: unknown };
  assert.ok(stale.consent);
  assert.equal(slot_of(local).files, undefined);
  assert.equal((await save("snippets/mine.js", snippet_code, snippet_code)).ok, true);
  assert.equal(slot_of(local).files!["snippets/mine.js"], snippet_code);
  // Changing the code asks again.
  const changed = (await save("snippets/mine.js", `${snippet_code}//x\n`)) as { consent?: { replaces: boolean } };
  assert.equal(changed.consent?.replaces, true);
  assert.equal(slot_of(local).files!["snippets/mine.js"], snippet_code);
});

test("a path outside the config layout and a file past the size limit are refused", async () => {
  const { startup } = await started("path");
  for (const path of ["../keymap.toml", "autoconfig.toml", "notes.txt", "snippets/a/b.js", "keymap.d/x.js"]) {
    await assert.rejects(startup.save_config_file(path, "x", null), (error: unknown) => error instanceof ConfigRefusal && /^File not saved/.test(error.message), path);
  }
  await assert.rejects(startup.save_config_file("style.css", "x".repeat(1024 * 1024 + 1), null), /too large/);
});

test("a save refuses when the stored text changed since the editor read it, and writes nothing", async () => {
  const { save, local } = await started("stale");
  await save("keymap.toml", "[normal]\n");
  const stale_base = "[normal]\n";
  // Another save (an import, a reload or another tab) changes the file after the editor read it.
  await save("keymap.toml", "[normal]\n# newer\n");
  const before = structuredClone(slot_of(local));
  const refused = (await save("keymap.toml", "[normal]\n# mine\n", undefined, stale_base)) as { ok: boolean; message: string };
  assert.equal(refused.ok, false);
  assert.match(refused.message, /changed since you opened it/);
  assert.deepEqual(slot_of(local), before);
  // A file the editor saw as absent, and a delete of one that is gone, refuse the same way.
  assert.equal(((await save("keymap.toml", "x", undefined, null)) as { ok: boolean }).ok, false);
  assert.equal(((await save("style.css", null, undefined, "old")) as { ok: boolean }).ok, false);
});

test("a path the zip refuses and a file the export cannot hold are refused, counting bytes", async () => {
  const { startup } = await started("zip_rules");
  for (const path of ["snippets/a\\b.js", "themes/a\nb.toml", `themes/${"n".repeat(400)}.toml`]) {
    await assert.rejects(startup.save_config_file(path, "x", null), (error: unknown) => error instanceof ConfigRefusal && /^File not saved/.test(error.message), path);
  }
  // 600,000 two-byte letters are 1.2 MB in UTF-8 but only 600,000 UTF-16 units.
  await assert.rejects(startup.save_config_file("style.css", "\u00e9".repeat(600_000), null), /too large/);
  await assert.rejects(startup.save_config_file("style.css", "x".repeat(700 * 1024), null).then(() => startup.save_config_file("style.d/a.css", "\u00e9".repeat(200_000), null)), /together/);
});
