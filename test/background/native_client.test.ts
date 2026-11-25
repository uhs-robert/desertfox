import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { create_native_client, host_file_of, missing_host_as_undefined, NativeHostError } from "../../src/background/native_client.ts";
import type { NativeFailure } from "../../src/background/native_client.ts";
import { text_sha256 } from "../../src/background/settings_file.ts";
import { make_tmp_dir } from "../support/tmp_dir.ts";

const client_with = (reply: (message: object) => Promise<unknown>, permitted = true) => {
  const sent: object[] = [];
  const client = create_native_client({
    has_permission: async () => permitted,
    send: async (message) => {
      sent.push(message);
      return reply(message);
    },
  });
  return { client, sent };
};

async function failure_of(run: () => Promise<unknown>): Promise<NativeFailure> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof NativeHostError, String(error));
    return error.failure;
  }
  assert.fail("expected a NativeHostError");
}

test("without the permission nothing is sent and the message names the way forward", async () => {
  const { client, sent } = client_with(async () => ({ ok: true, files: {} }), false);
  await assert.rejects(client.read_config(), (error: unknown) => error instanceof NativeHostError && error.failure === "no_permission" && /:native\.install/.test(error.message));
  assert.deepEqual(sent, []);
});

test("a host that Firefox cannot find says it is not installed", async () => {
  const { client } = client_with(async () => Promise.reject(new Error("No such native application desertfox_host")));
  assert.equal(await failure_of(() => client.read_config()), "host_missing");
});

test("any other Firefox failure keeps Firefox's words", async () => {
  const { client } = client_with(async () => Promise.reject(new Error("Native application exited")));
  await assert.rejects(client.read_config(), (error: unknown) => error instanceof NativeHostError && error.failure === "host_failed" && error.message.includes("Native application exited"));
});

test("a host refusal carries the host's reason, for example the size cap", async () => {
  const { client } = client_with(async () => ({ ok: false, error: "the reply is 2000000 bytes, over the cap" }));
  await assert.rejects(client.read_config(), (error: unknown) => error instanceof NativeHostError && error.message.includes("the reply is 2000000 bytes"));
});

test("a reply that is not the protocol is a bad reply", async () => {
  for (const reply of [undefined, "text", { files: {} }, { ok: true }, { ok: true, files: { "a.toml": 3 } }]) {
    const { client } = client_with(async () => reply);
    assert.equal(await failure_of(() => client.read_config()), "bad_reply", JSON.stringify(reply));
  }
});

test("read_config returns the files and write_autoconfig sends the text", async () => {
  const { client, sent } = client_with(async () => ({ ok: true, config_dir: "/c", config_dir_exists: true, files: { "settings.toml": "a = 1\n" } }));
  assert.deepEqual(await client.read_config(), { config_dir: "/c", config_dir_exists: true, files: { "settings.toml": "a = 1\n" } });
  await client.write_autoconfig("x = 1\n");
  assert.deepEqual(sent, [{ cmd: "read_config" }, { cmd: "write_autoconfig", toml: "x = 1\n" }]);
});

// The real host over its real framing, pointed at a temporary folder.
function spawn_host(request: object, config_dir: string): unknown {
  const body = Buffer.from(JSON.stringify(request));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  const done = spawnSync("python3", ["-I", join(import.meta.dirname, "../../host/desertfox-host")], {
    input: Buffer.concat([header, body]),
    env: { PATH: process.env.PATH ?? "", DESERTFOX_CONFIG_DIR: config_dir },
  });
  assert.equal(done.status, 0, String(done.stderr));
  return JSON.parse(done.stdout.subarray(4).toString("utf8"));
}

test("the client and the real host agree on both requests", { skip: spawnSync("python3", ["--version"]).error !== undefined }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-host-"));
  try {
    mkdirSync(join(dir, "snippets"));
    writeFileSync(join(dir, "settings.toml"), "a = 1\n");
    writeFileSync(join(dir, "snippets", "a.js"), "// a\n");
    const client = create_native_client({ has_permission: async () => true, send: async (message) => spawn_host(message, dir) });
    const read = await client.read_config();
    assert.deepEqual(read.files, { "settings.toml": "a = 1\n", "snippets/a.js": "// a\n" });
    await client.write_autoconfig("b = 2\n");
    assert.match(readFileSync(join(dir, "autoconfig.toml"), "utf8"), /b = 2\n$/);
    assert.deepEqual(Object.keys((await client.read_config()).files).sort(), ["settings.toml", "snippets/a.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const one = (path: string, text: string | null, base_sha256: string | null) => [{ path, text, base_sha256 }];

test("write_config_files names each file by kind, reads a hand edit as file_changed, an old file it could not read back as its own failure, and a host from before the verb as outdated", async () => {
  const changed = client_with(async () => ({ ok: false, error: "/c/settings.toml changed on disk since DesertFox last read it, so nothing was written", path: "/c/settings.toml", unrestored: [] }));
  assert.equal(await failure_of(() => changed.client.write_config_files(one("settings.toml", "a = 1\n", null))), "file_changed");
  assert.deepEqual(changed.sent, [{ cmd: "write_config_files", files: [{ kind: "settings", text: "a = 1\n", base_sha256: null }] }]);
  const unread = client_with(async () => ({ ok: false, error: "/c/settings.toml was not written: the old file could not be read back after the rename (Input/output error), so it is back in place" }));
  assert.equal(await failure_of(() => unread.client.write_config_files(one("settings.toml", "a = 1\n", null))), "file_not_read_back");
  const other = client_with(async () => ({ ok: false, error: "cannot write /c/settings.toml: Permission denied" }));
  assert.equal(await failure_of(() => other.client.write_config_files(one("settings.toml", "a = 1\n", null))), "host_failed");
});

test("a host from before write_config_files reads as outdated for every file, settings.toml too, and nothing goes through an older verb", async () => {
  const older = client_with(async (message) => ({ ok: false, error: `unknown cmd: '${(message as { cmd: string }).cmd}'` }));
  assert.equal(await failure_of(() => older.client.write_config_files(one("settings.toml", "a = 1\n", null))), "host_outdated");
  assert.equal(await failure_of(() => older.client.write_config_files(one("themes/nord.toml", "a = 1\n", null))), "host_outdated");
  assert.deepEqual(older.sent.map((message) => (message as { cmd: string }).cmd), ["write_config_files", "write_config_files"]);
  const no_kind = client_with(async () => ({ ok: false, error: "write_config_files has no kind 'quickmarks'. It writes settings, theme" }));
  assert.equal(await failure_of(() => no_kind.client.write_config_files([...one("settings.toml", "a = 1\n", null), ...one("quickmarks.toml", "", null)])), "host_outdated");
});

test("a refused batch names its failing file and the files the rollback could not put back by their config paths", async () => {
  const error = "/c/keymap.d/settings.toml changed on disk and could not be put back. Of the 2 files written before it, /c/settings.toml could not be put back";
  const { client } = client_with(async () => ({ ok: false, error, path: "/c/keymap.d/settings.toml", unrestored: ["/c/settings.toml", "/c/elsewhere.toml"] }));
  const writes = [...one("settings.toml", "a = 1\n", null), ...one("keymap.d/settings.toml", "", null), ...one("themes/nord.toml", "", null)];
  await assert.rejects(client.write_config_files(writes), (thrown: unknown) => {
    assert.ok(thrown instanceof NativeHostError);
    assert.equal(thrown.failure, "file_changed");
    assert.deepEqual(thrown.refused_files, { path: "keymap.d/settings.toml", unrestored: ["settings.toml"] });
    return true;
  });
  // A refusal before the batch check names no file.
  const bad = client_with(async () => ({ ok: false, error: "write_config_files needs files: a list of at least one file" }));
  await assert.rejects(bad.client.write_config_files(writes), (thrown: unknown) => thrown instanceof NativeHostError && thrown.refused_files.path === undefined && thrown.refused_files.unrestored.length === 0);
});

test("an error that only holds the words of an unknown verb, such as a folder named so, stays the host's error and is not sent again", async () => {
  const error = "cannot write /home/u/unknown cmd: 'write_config_files'/settings.toml: the config folder /home/u/unknown cmd: 'write_config_files' does not exist";
  const { client, sent } = client_with(async () => ({ ok: false, error }));
  assert.equal(await failure_of(() => client.write_config_files(one("settings.toml", "a = 1\n", null))), "host_failed");
  assert.equal(sent.length, 1);
});

test("write_config_files sends a theme by name and refuses a path the host has no kind for before sending", async () => {
  const { client, sent } = client_with(async () => ({ ok: true, files: [{ path: "/c/themes/nord_dark.toml", deleted: true }] }));
  await client.write_config_files(one("themes/nord_dark.toml", null, "0".repeat(64)));
  assert.deepEqual(sent, [{ cmd: "write_config_files", files: [{ kind: "theme", name: "nord_dark", text: null, base_sha256: "0".repeat(64) }] }]);
  for (const path of ["snippets/a.js", "themes/../settings.toml", "themes/a/b.toml", "themes/Nord.toml", "themes/.x.toml", "themes/x.css", "/etc/settings.toml"]) {
    await assert.rejects(client.write_config_files([...one("settings.toml", "a = 1\n", null), ...one(path, "a = 1\n", null)]), /writes no file/, path);
  }
  assert.equal(sent.length, 1);
});

test("host_file_of gives every config file but a snippet a kind, and a .d name only where the host takes it", () => {
  assert.deepEqual(host_file_of("keymap.toml"), { kind: "keymap" });
  assert.deepEqual(host_file_of("style.css"), { kind: "style" });
  assert.deepEqual(host_file_of("keymap.d/zz-desertfox.toml"), { kind: "search_keys" });
  assert.deepEqual(host_file_of("search_engines.d/zz-desertfox.toml"), { kind: "engines" });
  assert.deepEqual(host_file_of("settings.d/10-Work.local caf\u00e9.toml"), { kind: "settings_d", name: "10-Work.local caf\u00e9" });
  assert.deepEqual(host_file_of("style.d/10-x.css"), { kind: "style_d", name: "10-x" });
  assert.deepEqual(host_file_of("command_aliases.d/zz-desertfox.toml"), { kind: "command_aliases_d", name: "zz-desertfox" });
  for (const path of ["snippets/a.js", "autoconfig.toml", "settings.d/.hidden.toml", "settings.d/a/b.toml", "settings.d/a\\b.toml", "settings.d/a\u0001.toml", "settings.d/.toml", "style.d/x.toml", "settings.d/x.css", `settings.d/${"x".repeat(234)}.toml`, "other.d/x.toml"]) {
    assert.equal(host_file_of(path), undefined, path);
  }
  assert.deepEqual(host_file_of(`settings.d/${"x".repeat(233)}.toml`), { kind: "settings_d", name: "x".repeat(233) });
});

test("the real host writes each import path where host_file_of names it, and read_config gives it back at that path", { skip: spawnSync("python3", ["--version"]).error !== undefined }, async (t) => {
  const dir = make_tmp_dir("desertfox-host-", t);
  const client = create_native_client({ has_permission: async () => true, send: async (message) => spawn_host(message, dir) });
  const paths = ["keymap.toml", "search_engines.toml", "command_aliases.toml", "quickmarks.toml", "style.css", "settings.d/10-Work.local.toml", "keymap.d/10-a.toml", "search_engines.d/10-a.toml", "command_aliases.d/10-a.toml", "quickmarks.d/10-a.toml", "style.d/10-a.css"];
  await client.write_config_files(paths.map((path) => ({ path, text: `# ${path}\n`, base_sha256: null })));
  const files = (await client.read_config()).files;
  assert.deepEqual(Object.keys(files).filter((path) => !path.endsWith("/")).sort(), [...paths].sort());
  for (const path of paths) assert.equal(files[path], `# ${path}\n`);
});

test("the extension's digest of the text read_config sends is the one the real host checks", { skip: spawnSync("python3", ["--version"]).error !== undefined }, async (t) => {
  const dir = make_tmp_dir("desertfox-host-", t);
  const mine = "# caf\u00e9\r\ntheme = \"nord\" # dark\r\nb = 1";
  writeFileSync(join(dir, "settings.toml"), mine);
  const client = create_native_client({ has_permission: async () => true, send: async (message) => spawn_host(message, dir) });
  const read = (await client.read_config()).files["settings.toml"]!;
  assert.equal(read, mine);
  const next = mine.replace("nord", "dracula");
  const base = await text_sha256(read);
  await client.write_config_files(one("settings.toml", next, base));
  assert.equal(readFileSync(join(dir, "settings.toml"), "utf8"), next);
  // The same base again is stale: the file now holds `next`.
  assert.equal(await failure_of(() => client.write_config_files(one("settings.toml", mine, base))), "file_changed");
  assert.equal(readFileSync(join(dir, "settings.toml"), "utf8"), next);
});

test("the real host refuses a whole batch over a stale base on one file, and the client names that file by its config path", { skip: spawnSync("python3", ["--version"]).error !== undefined }, async (t) => {
  const dir = make_tmp_dir("desertfox-host-", t);
  mkdirSync(join(dir, "keymap.d"));
  writeFileSync(join(dir, "settings.toml"), "a = 1\n");
  writeFileSync(join(dir, "keymap.d/settings.toml"), "# hand\n");
  const client = create_native_client({ has_permission: async () => true, send: async (message) => spawn_host(message, dir) });
  const writes = [
    { path: "settings.toml", text: "a = 2\n", base_sha256: await text_sha256("a = 1\n") },
    { path: "keymap.d/settings.toml", text: "# mine\n", base_sha256: await text_sha256("# read before the hand edit\n") },
  ];
  await assert.rejects(client.write_config_files(writes), (thrown: unknown) => thrown instanceof NativeHostError && thrown.failure === "file_changed" && thrown.refused_files.path === "keymap.d/settings.toml" && thrown.refused_files.unrestored.length === 0);
  assert.equal(readFileSync(join(dir, "settings.toml"), "utf8"), "a = 1\n");
  assert.equal(readFileSync(join(dir, "keymap.d/settings.toml"), "utf8"), "# hand\n");
});

test("editor_start sends the text with only the fields given and answers the job", async () => {
  const { client, sent } = client_with(async () => ({ ok: true, job: "j1" }));
  assert.equal(await client.editor_start({ text: "hi", ext: "md", insert: true }), "j1");
  assert.deepEqual(sent, [{ cmd: "editor_start", text: "hi", ext: "md", insert: true }]);
  const private_call = client_with(async () => ({ ok: true, job: "j2" }));
  await private_call.client.editor_start({ text: "hi", private: true });
  assert.deepEqual(private_call.sent, [{ cmd: "editor_start", text: "hi", private: true }]);
  assert.equal(await failure_of(() => client_with(async () => ({ ok: true })).client.editor_start({ text: "" })), "bad_reply");
});

test("editor_collect tells pending, done unchanged and done with text, and a refusal throws", async () => {
  assert.deepEqual(await client_with(async () => ({ ok: true, pending: true })).client.editor_collect("j"), { pending: true });
  assert.deepEqual(await client_with(async () => ({ ok: true, done: true, changed: false })).client.editor_collect("j"), { done: true, changed: false });
  assert.deepEqual(await client_with(async () => ({ ok: true, done: true, changed: true, text: "x" })).client.editor_collect("j"), { done: true, changed: true, text: "x" });
  const { client, sent } = client_with(async () => ({ ok: false, error: "unknown job" }));
  await assert.rejects(client.editor_collect("j"), (error: unknown) => error instanceof NativeHostError && error.message.includes("unknown job"));
  assert.deepEqual(sent, [{ cmd: "editor_collect", job: "j" }]);
  assert.equal(await failure_of(() => client_with(async () => ({ ok: true, done: true, changed: true })).client.editor_collect("j")), "bad_reply");
});

test("open_firefox_page sends only the page key", async () => {
  const { client, sent } = client_with(async () => ({ ok: true, page: "settings" }));
  await client.open_firefox_page("settings");
  assert.deepEqual(sent, [{ cmd: "open_firefox_page", page: "settings" }]);
});

test("open_firefox_page on a host from before the verb says to update the host", async () => {
  const { client } = client_with(async () => ({ ok: false, error: "unknown cmd: 'open_firefox_page'" }));
  await assert.rejects(client.open_firefox_page("settings"), (error: unknown) => error instanceof NativeHostError && error.failure === "host_outdated" && /unknown cmd/.test(error.message) && /:native\.update/.test(error.message));
});

test("open_firefox_page keeps the host's own refusal", async () => {
  const { client } = client_with(async () => ({ ok: false, error: "Firefox did not take the request within 10 s" }));
  await assert.rejects(client.open_firefox_page("settings"), (error: unknown) => error instanceof NativeHostError && error.failure === "host_failed" && /did not take the request/.test(error.message));
});

test("open_firefox_page without the host names the install page", async () => {
  const { client } = client_with(async () => Promise.reject(new Error("No such native application desertfox_host")));
  await assert.rejects(client.open_firefox_page("settings"), (error: unknown) => error instanceof NativeHostError && error.failure === "host_missing" && /:native\.install/.test(error.message));
});

test("list_fonts sends the bare verb and returns the names", async () => {
  const { client, sent } = client_with(async () => ({ ok: true, fonts: ["Cantarell", "DejaVu Sans"] }));
  assert.deepEqual(await client.list_fonts(), ["Cantarell", "DejaVu Sans"]);
  assert.deepEqual(sent, [{ cmd: "list_fonts" }]);
});

test("list_fonts refuses a reply with no list of names", async () => {
  for (const fonts of [undefined, "Cantarell", [1]]) {
    const { client } = client_with(async () => ({ ok: true, fonts }));
    assert.equal(await failure_of(() => client.list_fonts()), "bad_reply", JSON.stringify(fonts));
  }
});

test("list_fonts on a host from before the verb is a host failure the caller can swallow", async () => {
  const { client } = client_with(async () => ({ ok: false, error: "unknown cmd: 'list_fonts'" }));
  assert.equal(await failure_of(() => client.list_fonts()), "host_failed");
});

test("a missing host reads as undefined for the font list and any other failure goes on", async () => {
  for (const reply of [() => Promise.reject(new Error("No such native application x")), async () => ({ ok: false, error: "unknown cmd: 'list_fonts'" })]) {
    const { client } = client_with(reply);
    assert.equal(await client.list_fonts().catch(missing_host_as_undefined), undefined);
  }
  const { client: no_permission } = client_with(async () => ({ ok: true, fonts: [] }), false);
  assert.equal(await no_permission.list_fonts().catch(missing_host_as_undefined), undefined);
  const { client: failing } = client_with(async () => ({ ok: false, error: "fc-list did not finish within 5 s" }));
  await assert.rejects(failing.list_fonts().catch(missing_host_as_undefined), /did not finish/);
});
