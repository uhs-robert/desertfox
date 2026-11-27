import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";
import { release_options } from "../support/metafile.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION as V, MAX_KIND_BYTES } from "../../src/shared/browser_module_protocol.ts";
import type { SnapshotPart } from "../../src/shared/browser_module_protocol.ts";
import { CONFIG_STATUS_STORAGE_KEY } from "../../src/shared/storage_watch.ts";
import { THEME_STORAGE_KEY } from "../../src/shared/theme/apply.ts";

// The shipped bundle, run as the browser module runs it: in a fresh global that holds only the transport.
const bundle = (await build(release_options({ locked_shim: "src/content/locked_shim.ts" }))).outputFiles[0]!.text;

type Shimmed = {
  runtime: {
    id: string | undefined;
    getURL: (path: string) => string;
    getFrameId: () => number;
    sendMessage: (message: unknown) => Promise<unknown>;
    onMessage: { addListener: (listener: (...args: never[]) => unknown) => void; removeListener: (listener: (...args: never[]) => unknown) => void };
  };
  storage: { local: { get: (keys: unknown) => Promise<Record<string, unknown>> }; onChanged: { addListener: (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => void } };
};

function load(snapshots: Partial<Record<SnapshotPart, unknown>> = {}) {
  const state = { alive: true, calls: [] as string[], bundles: [] as string[], answer: (_text: string): Promise<string> => Promise.resolve(JSON.stringify({ value: "ok" })) };
  let push: ((message: string) => Promise<string>) | undefined;
  let snapshot_changed: ((part: SnapshotPart) => void) | undefined;
  const transport = {
    extension_id: "desertfox@uhs-robert",
    base_url: "moz-extension://abc/",
    alive: () => state.alive,
    call: (text: string) => {
      state.calls.push(text);
      return state.answer(text);
    },
    load_bundle: async (name: string) => {
      state.bundles.push(name);
      return { ok: true };
    },
    snapshot: (part: SnapshotPart) => snapshots[part],
    on_snapshot: (listener: (part: SnapshotPart) => void) => void (snapshot_changed = listener),
    on_push: (listener: (message: string) => Promise<string>) => void (push = listener),
  };
  const context = vm.createContext({ desertfox_locked_transport: transport, TextEncoder });
  vm.runInContext(bundle, context);
  const scope = context as { browser?: Shimmed; desertfox_locked_transport?: unknown };
  assert.equal(scope.desertfox_locked_transport, undefined, "the shim takes the transport off the global");
  return { browser: scope.browser!, state, snapshots, push: (text: string) => push!(text), changed: (part: SnapshotPart) => snapshot_changed!(part) };
}

const snap = (value: unknown) => ({ v: V, value });
// Values made in the shim's global have that global's prototypes.
const plain = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

test("a background message goes out as JSON text and its answer comes back", async () => {
  const { browser, state } = load();
  state.answer = async (text) => JSON.stringify({ value: { echoed: JSON.parse(text) as unknown } });
  assert.deepEqual(plain(await browser.runtime.sendMessage({ type: "register_read", name: "a" })), { echoed: { type: "register_read", name: "a" } });
  assert.deepEqual(state.calls, ['{"type":"register_read","name":"a"}']);
  state.answer = async () => JSON.stringify({});
  assert.equal(await browser.runtime.sendMessage({ type: "record_timing", name: "x", ms: 1 }), undefined, "no answer");
  state.answer = async () => JSON.stringify({ error: "handler failed" });
  await assert.rejects(browser.runtime.sendMessage({ type: "run", invocations: [], mode: "normal" }), /handler failed/);
  state.answer = async () => "not json";
  await assert.rejects(browser.runtime.sendMessage({ type: "run", invocations: [], mode: "normal" }), /not JSON/);
  state.answer = async () => "[1]";
  await assert.rejects(browser.runtime.sendMessage({ type: "run", invocations: [], mode: "normal" }), /not a table/);
  state.answer = () => Promise.reject(new Error("the module lost the call"));
  await assert.rejects(browser.runtime.sendMessage({ type: "run", invocations: [], mode: "normal" }), /lost the call/);
});

test("a refused, unknown, page-only or junk type never reaches the transport", async () => {
  const { browser, state } = load();
  for (const message of [{ type: "snippet_run", name: "x" }, { type: "inspect_pick" }, { type: "quality_probe", address: "x" }, { type: "change_setting" }, { type: "eval" }, { type: "__proto__" }, { type: 5 }, {}, null, "run", [{ type: "run" }]]) {
    await assert.rejects(browser.runtime.sendMessage(message), /not sent from a locked page/, JSON.stringify(message));
  }
  assert.deepEqual(state.calls, []);
});

test("a message too large for its kind is refused here, before the transport", async () => {
  const { browser, state } = load();
  await assert.rejects(browser.runtime.sendMessage({ type: "hint_frames_start", texts: ["t".repeat(MAX_KIND_BYTES)] }), /too large/);
  assert.deepEqual(state.calls, []);
});

test("read_keymap and the root which-key panel come from their snapshots, a bundle load from the module", async () => {
  const panel = { title: [], rows: [{ keys: "j", command: "scroll", description: "", more: false }], border: "square" };
  const { browser, state, snapshots } = load({ keymap: snap('{"keymap":{}}'), which_key: snap(panel) });
  assert.equal(await browser.runtime.sendMessage({ type: "read_keymap", join: true, url: "about:addons" }), '{"keymap":{}}');
  assert.deepEqual(await browser.runtime.sendMessage({ type: "list_keys", mode: "normal", prefix: [], url: "about:addons" }), panel);
  assert.deepEqual(state.calls, []);
  await browser.runtime.sendMessage({ type: "list_keys", mode: "normal", prefix: ["g"], url: "about:addons" });
  assert.equal(state.calls.length, 1, "a prefix panel is a call");
  assert.deepEqual(await browser.runtime.sendMessage({ type: "load_bundle", name: "hints" }), { ok: true });
  assert.deepEqual(state.bundles, ["hints"]);
  // A snapshot that fails its check serves nothing.
  snapshots.keymap = { v: V + 1, value: '{"keymap":{}}' };
  assert.equal(await browser.runtime.sendMessage({ type: "read_keymap", join: true, url: "" }), undefined);
  snapshots.keymap = { v: V, value: { not: "text" } };
  assert.equal(await browser.runtime.sendMessage({ type: "read_keymap", join: true, url: "" }), undefined);
  snapshots.which_key = undefined;
  await browser.runtime.sendMessage({ type: "list_keys", mode: "normal", prefix: [], url: "" });
  assert.equal(state.calls.length, 2, "no root snapshot, so the panel is a call");
});

test("storage.local serves the config status and the theme from snapshots and refuses every other key", async () => {
  const status = { settings: { hint_chars: "asdf" } };
  const theme = { dark: { bg: "#000" }, light: { bg: "#fff" } };
  const { browser, snapshots } = load({ config: snap(status), theme: snap(theme) });
  assert.deepEqual(plain(await browser.storage.local.get(CONFIG_STATUS_STORAGE_KEY)), { [CONFIG_STATUS_STORAGE_KEY]: status });
  assert.deepEqual(plain(await browser.storage.local.get([CONFIG_STATUS_STORAGE_KEY, THEME_STORAGE_KEY])), { [CONFIG_STATUS_STORAGE_KEY]: status, [THEME_STORAGE_KEY]: theme });
  for (const keys of ["desertfox_saved_settings", [CONFIG_STATUS_STORAGE_KEY, "desertfox_marks"], null, undefined, {}, [5]]) {
    await assert.rejects(browser.storage.local.get(keys), /reads only/, JSON.stringify(keys));
  }
  snapshots.theme = { v: V, value: { dark: {} } };
  assert.deepEqual(plain(await browser.storage.local.get(THEME_STORAGE_KEY)), {}, "a theme that fails its check reads as absent");
});

test("a snapshot change reaches storage.onChanged, and a keymap change reaches the page as tree_updated", async () => {
  const { browser, snapshots, changed } = load({ config: snap({ settings: {} }) });
  const changes: unknown[] = [];
  const messages: unknown[] = [];
  browser.storage.onChanged.addListener((change, area) => void changes.push([change, area]));
  browser.runtime.onMessage.addListener(((message: unknown) => void messages.push(message)) as never);
  snapshots.config = snap({ settings: { a: 1 } });
  changed("config");
  changed("keymap");
  changed("which_key");
  assert.deepEqual(plain(changes), [[{ [CONFIG_STATUS_STORAGE_KEY]: { newValue: { settings: { a: 1 } } } }, "local"]]);
  assert.deepEqual(plain(messages), [{ type: "tree_updated" }]);
});

test("a push reaches the listeners, and the first that answers gives the answer text", async () => {
  const { browser, push } = load();
  const skipped = (() => undefined) as never;
  const answers = ((message: { type: string }) => (message.type === "get_selection" ? Promise.resolve("picked") : undefined)) as never;
  const responds = ((message: { type: string }, _sender: unknown, respond: (value: unknown) => void) => {
    if (message.type !== "ping") return undefined;
    respond(true);
    return true;
  }) as never;
  browser.runtime.onMessage.addListener(skipped);
  browser.runtime.onMessage.addListener(answers);
  browser.runtime.onMessage.addListener(responds);
  assert.deepEqual(JSON.parse(await push('{"type":"get_selection"}')), { value: "picked" });
  assert.deepEqual(JSON.parse(await push('{"type":"ping"}')), { value: true });
  assert.deepEqual(JSON.parse(await push('{"type":"frame_mode"}')), {});
  browser.runtime.onMessage.removeListener(answers);
  assert.deepEqual(JSON.parse(await push('{"type":"get_selection"}')), {});
  for (const junk of ["not json", "[]", '{"type":5}', "null"]) assert.ok((JSON.parse(await push(junk)) as { error?: string }).error, junk);
  assert.match((JSON.parse(await push(JSON.stringify({ type: "refusal", pad: "p".repeat(MAX_KIND_BYTES) }))) as { error: string }).error, /too large/);
  const thrower = ((message: { type: string }) => (message.type === "boom" ? Promise.reject(new Error("listener failed")) : undefined)) as never;
  browser.runtime.onMessage.addListener(thrower);
  assert.deepEqual(JSON.parse(await push('{"type":"boom"}')), { error: "listener failed" });
});

test("an answer too large to send back becomes an error", async () => {
  const { browser, push } = load();
  browser.runtime.onMessage.addListener((() => Promise.resolve("a".repeat(MAX_KIND_BYTES))) as never);
  assert.deepEqual(JSON.parse(await push('{"type":"get_selection"}')), { error: "the answer is too large" });
});

test("the runtime facts: id, extension URLs and frame 0", () => {
  const { browser } = load();
  assert.equal(browser.runtime.id, "desertfox@uhs-robert");
  assert.equal(browser.runtime.getURL("hints.js"), "moz-extension://abc/hints.js");
  assert.equal(browser.runtime.getURL("/commands.json"), "moz-extension://abc/commands.json");
  assert.equal(browser.runtime.getFrameId(), 0);
});

test("after the extension unloads the id is gone and every call, read and push is refused", async () => {
  const { browser, state, push, changed } = load({ config: snap({ settings: {} }) });
  const changes: unknown[] = [];
  browser.storage.onChanged.addListener((change) => void changes.push(change));
  state.alive = false;
  assert.equal(browser.runtime.id, undefined);
  await assert.rejects(browser.runtime.sendMessage({ type: "run", invocations: [], mode: "normal" }), /invalidated/);
  await assert.rejects(browser.runtime.sendMessage({ type: "read_keymap", join: true, url: "" }), /invalidated/);
  await assert.rejects(browser.storage.local.get(CONFIG_STATUS_STORAGE_KEY), /invalidated/);
  assert.match((JSON.parse(await push('{"type":"ping"}')) as { error: string }).error, /invalidated/);
  changed("config");
  assert.deepEqual(changes, []);
  assert.deepEqual(state.calls, []);
});

test("without a transport the shim defines nothing", () => {
  const context = vm.createContext({});
  vm.runInContext(bundle, context);
  assert.equal((context as { browser?: unknown }).browser, undefined);
});
